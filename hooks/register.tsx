import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, SessionContextUsage } from 'claude-code'

import type { Limit, Source, Totals, Week, Window } from '../types'

import { costOf } from './pricing'
import type { ModelUsage } from './pricing'
import { AGGREGATE, EMPTY, summarize } from './usage'

const PANE = 'token-meter'
const WEEK_MS = 7 * 86_400_000
const WEEK_EVERY_MS = 10 * 60_000

const totals = atom({ plugin: 'token-meter', key: 'totals' } as const, EMPTY)
const week = atom({ plugin: 'token-meter', key: 'week' } as const, null as Week | null)
const source = atom({ plugin: 'token-meter', key: 'source' } as const, 'live' as Source)
const window = atom({ plugin: 'token-meter', key: 'window' } as const, null)
const usd = atom({ plugin: 'token-meter', key: 'usd' } as const, null)
const limits = atom({ plugin: 'token-meter', key: 'limits' } as const, [] as Limit[])

const STORE_PREFIX = 'session:'
const STORE_WEEK = 'week'
const STORE_KEEP = 200

const projectKey = (dir: string) => dir.replace(/[^A-Za-z0-9]/g, '-')
const projectsDir = async ($: EngineInterface) => `${(await $.env.get('HOME')) ?? ''}/.claude/projects`

// Saved totals from before usd existed lack it; treat them as tokens without a price.
const withDefaults = (t: Partial<Totals>): Totals => ({ ...EMPTY, ...t, unpricedModels: t.unpricedModels ?? [] })

async function transcriptFiles($: EngineInterface, sessionId: string): Promise<string[]> {
  const projects = await projectsDir($)
  const hasTranscript = (name: string) => $.fs.exists(`${projects}/${name}/${sessionId}.jsonl`)
  // The transcript lives under the launch directory's key; search every project only when it moved.
  let name: string | undefined
  for (const guess of [projectKey(await $.session.root()), projectKey(await $.session.cwd())]) {
    if (await hasTranscript(guess)) {
      name = guess
      break
    }
  }
  if (name === undefined) {
    for (const entry of await $.fs.list(projects)) {
      if (entry.kind === 'dir' && (await hasTranscript(entry.name))) {
        name = entry.name
        break
      }
    }
  }
  if (name === undefined) return []
  const dir = `${projects}/${name}`
  const files = [`${dir}/${sessionId}.jsonl`]
  const subagents = `${dir}/${sessionId}/subagents`
  if (await $.fs.exists(subagents)) {
    for (const f of await $.fs.list(subagents)) {
      if (f.kind === 'file' && f.name.endsWith('.jsonl')) files.push(`${subagents}/${f.name}`)
    }
  }

  return files
}

async function scanSession($: EngineInterface): Promise<Totals | null> {
  const files = await transcriptFiles($, await $.session.id())
  if (files.length === 0) return null
  const r = await $.process.run(['jq', '-ncR', '--arg', 'since', '', AGGREGATE, ...files], { timeoutMs: 60_000 })
  if (r.exitCode !== 0) return null

  return summarize(JSON.parse(r.stdout) as ModelUsage[])
}

// Every session of every project since the start of the weekly limit window: files touched in the
// window, assistant lines only (grep), then the same aggregate filtered by timestamp.
async function scanWeek($: EngineInterface, since: number, now: number): Promise<Totals | null> {
  const minutes = String(Math.ceil((now - since) / 60_000) + 60)
  const script =
    'find "$1" -name "*.jsonl" -mmin "-$2" -print0 | xargs -0 grep -h -F \'"type":"assistant"\' | jq -ncR --arg since "$3" "$4"'
  const r = await $.process.run(
    ['sh', '-c', script, 'sh', await projectsDir($), minutes, new Date(since).toISOString(), AGGREGATE],
    { timeoutMs: 120_000 },
  )
  if (r.exitCode !== 0) return null

  return summarize(JSON.parse(r.stdout) as ModelUsage[])
}

async function saveSession($: EngineInterface, t: Totals) {
  await $.store.set(`${STORE_PREFIX}${await $.session.id()}`, t)
  const keys = (await $.store.keys()).filter(k => k.startsWith(STORE_PREFIX))
  for (const old of keys.slice(0, Math.max(0, keys.length - STORE_KEEP))) await $.store.delete(old)
}

let isScanning = false
let isScanningWeek = false

async function refreshSession($: EngineInterface) {
  if (isScanning) return
  isScanning = true
  try {
    const t = await scanSession($)
    if (t) {
      await update($, totals, () => t)
      await update($, source, () => 'transcript' as Source)
      await saveSession($, t)
    }
  } catch {
    // keep what is shown; the next turn retries
  } finally {
    isScanning = false
  }
}

// The weekly limit's own window when the API reported one, else the last seven days.
async function weekStart($: EngineInterface, now: number) {
  const resetsAt = (await read($, limits)).find(l => l.kind === 'seven_day')?.resetsAt
  const reset = resetsAt === undefined ? NaN : Date.parse(resetsAt)

  return Number.isNaN(reset) ? now - WEEK_MS : reset - WEEK_MS
}

async function refreshWeek($: EngineInterface) {
  if (isScanningWeek) return
  isScanningWeek = true
  try {
    const now = await $.clock.now()
    const since = await weekStart($, now)
    const t = await scanWeek($, since, now)
    if (t) {
      const w: Week = { since, at: now, totals: t }
      await update($, week, () => w)
      await $.store.set(STORE_WEEK, w)
    }
  } catch {
    // keep what is shown; the next period retries
  } finally {
    isScanningWeek = false
  }
}

const fmt = (n: number) =>
  n >= 1_000_000_000
    ? `${(n / 1_000_000_000).toFixed(2)}B`
    : n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(2)}M`
      : n >= 1_000
        ? `${(n / 1_000).toFixed(1)}k`
        : `${n}`

const money = (n: number) => `$${n.toFixed(2)}`

const ddmm = (ms: number) => {
  const d = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')

  return `${two(d.getDate())}/${two(d.getMonth() + 1)} ${two(d.getHours())}:${two(d.getMinutes())}`
}

const LIMIT_LABEL: Record<string, string> = {
  five_hour: '5h window',
  seven_day: 'Weekly',
  spend_limit: 'Spend',
}

const until = (resetsAt: string | undefined, now: number) => {
  const at = resetsAt === undefined ? NaN : Date.parse(resetsAt)
  if (Number.isNaN(at)) return ''
  const min = Math.max(0, Math.round((at - now) / 60_000))
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60

  return ` · resets in ${d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`}`
}

const limitColor = (used: number) => (used >= 85 ? 'red' : used >= 60 ? 'yellow' : 'green')

const toWindow = (c: SessionContextUsage): Window => ({
  tokens: c.tokens ?? null,
  size: c.window,
  percent: c.percent ?? null,
})

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tokens',
      description: 'Open the token meter pane',
    })
    const saved = (await $.store.get(`${STORE_PREFIX}${await $.session.id()}`)) as Partial<Totals> | undefined
    if (saved) {
      await update($, totals, () => withDefaults(saved))
      await update($, source, () => 'saved' as Source)
    }
    const savedWeek = (await $.store.get(STORE_WEEK)) as Week | undefined
    if (savedWeek) await update($, week, () => ({ ...savedWeek, totals: withDefaults(savedWeek.totals) }))
    const usage = await $.session.usage()
    await update($, window, () => toWindow(usage.context))
    await update($, usd, () => usage.cost?.usd ?? null)
    await update($, limits, () => usage.rateLimits)
    void refreshSession($)
    void refreshWeek($)
    $.clock.every(WEEK_EVERY_MS, () => void refreshWeek($))
    void $.ui.open({ id: PANE, title: 'Tokens' })

    return next(e)
  })

  on('command.run', { command: 'tokens' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Tokens' })

    return { text: 'Token meter pane opened.' }
  })

  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    if (u) {
      const turnUsd =
        costOf({
          model: u.model,
          fast: false,
          input: u.input_tokens,
          cacheRead: u.cache_read_input_tokens,
          cacheWrite: u.cache_creation_input_tokens,
          cacheWrite1h: 0,
          output: u.output_tokens,
          responses: 1,
        }) ?? 0
      const t = await update($, totals, t => ({
        ...t,
        input: t.input + u.input_tokens,
        cacheRead: t.cacheRead + u.cache_read_input_tokens,
        cacheWrite: t.cacheWrite + u.cache_creation_input_tokens,
        output: t.output + u.output_tokens,
        turns: t.turns + 1,
        usd: t.usd + turnUsd,
      }))
      await saveSession($, t)
    }
    const ran = await next(e)
    if (e.agentId === undefined) void refreshSession($)

    return ran
  })

  on('session.measure', async ($, e, next) => {
    await update($, window, () => toWindow(e.context))
    await update($, usd, () => e.cost?.usd ?? null)
    await update($, limits, () => e.rateLimits)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, totals, () => EMPTY)
      await update($, source, () => 'live' as Source)
      await update($, window, () => null)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const t = await read($, totals)
    const wk = await read($, week)
    const from = await read($, source)
    const w = await read($, window)
    const cost = await read($, usd)
    const rate = await read($, limits)
    const now = await $.clock.now()

    const block = (x: Totals, note: RenderChildren) => {
      const readTotal = x.input + x.cacheRead + x.cacheWrite

      return (
        <Box flexDirection="column">
          <Text>  Read     {fmt(readTotal)}</Text>
          <Text dimColor>    uncached    {fmt(x.input)}</Text>
          <Text dimColor>    cache read  {fmt(x.cacheRead)}</Text>
          <Text dimColor>    cache write {fmt(x.cacheWrite)}</Text>
          <Text>  Written  {fmt(x.output)}</Text>
          <Text>  Total    {fmt(readTotal + x.output)}</Text>
          <Text color="cyan">  Cost     {money(x.usd)} (estimated, API pricing)</Text>
          {x.unpricedModels.length > 0 && (
            <Text dimColor>    unpriced: {x.unpricedModels.join(', ')}</Text>
          )}
          <Text dimColor>
            {'  '}
            {x.turns} API responses · {note}
          </Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text bold>Current session</Text>
        {block(
          t,
          `includes subagents · ${from === 'transcript' ? 'transcript' : from === 'saved' ? 'saved' : 'since the mod loaded'}`,
        )}
        <Text> </Text>
        <Text bold>Weekly{wk ? ` (since ${ddmm(wk.since)})` : ''}</Text>
        {wk ? (
          block(wk.totals, `all projects · updated ${ddmm(wk.at)}`)
        ) : (
          <Text dimColor>  calculating…</Text>
        )}
        <Text> </Text>
        <Text bold>Context window</Text>
        {w === null || w.tokens === null ? (
          <Text dimColor>  waiting for first response</Text>
        ) : (
          <Text color={(w.percent ?? 0) >= 85 ? 'red' : (w.percent ?? 0) >= 60 ? 'yellow' : 'green'}>
            {'  '}
            {fmt(w.tokens)} / {fmt(w.size)} ({w.percent ?? 0}%)
          </Text>
        )}
        {cost !== null && <Text dimColor>  /cost for this process {money(cost)}</Text>}
        <Text> </Text>
        <Text bold>Limits</Text>
        {rate.length === 0 && <Text dimColor>  no reading yet</Text>}
        {rate.map(l => (
          <Text color={limitColor(l.percentUsed)}>
            {'  '}
            {LIMIT_LABEL[l.kind] ?? l.kind}: {Math.max(0, Math.round((100 - l.percentUsed) * 10) / 10)}% free (
            {l.percentUsed}% used){until(l.resetsAt, now)}
          </Text>
        ))}
      </Box>
    )
  })
}
