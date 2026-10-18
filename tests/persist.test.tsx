import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const HOME = '/h'
const ROOT = '/work/proj'
const DIR = `${HOME}/.claude/projects/-work-proj`
const SID = 'sess-1'
const NOW = Date.parse('2026-10-07T12:00:00Z')
const WEEK_RESET = Date.parse('2026-10-10T09:00:00Z')

const PANE = {
  plugin: 'token-meter',
  component: 'Pane' as const,
  requestId: 'token-meter',
  props: {
    title: 'Tokens',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
}

const row = (model: string, input: number, cacheRead: number, cacheWrite: number, cacheWrite1h: number, output: number, responses: number) => ({
  model, fast: false, input, cacheRead, cacheWrite, cacheWrite1h, output, responses,
})

const SESSION_ROWS = [row('claude-opus-5-5', 172, 14_490_748, 441_163, 441_163, 68_801, 86)]
const WEEK_ROWS = [
  row('claude-opus-5-5', 25_954, 2_875_308_228, 59_722_585, 23_512_493, 5_341_003, 12_928),
  row('claude-sonnet-5-5', 3_030, 181_875_897, 10_729_807, 109_849, 214_034, 1_514),
  row('<synthetic>', 0, 0, 0, 0, 0, 7),
]
const ACCOUNT_ROWS = [
  row('claude-opus-5-5', 90_000, 9_000_000_000, 100_000_000, 40_000_000, 20_000_000, 40_000),
  row('claude-sonnet-5-5', 1_000, 5_000_000, 0, 0, 100_000, 300),
]
const OLDEST = Date.parse('2026-09-17T20:11:21Z')

const result = (exitCode: number, stdout: string) => ({
  exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false,
})

type Opts = { tools: boolean; store?: Record<string, unknown> }

const engine = (on: On, opts: Opts) => {
  const argvs: (readonly string[])[] = []
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME })
  const store = new Map<string, unknown>(Object.entries(opts.store ?? {}))
  on('store.get', async (_, e) => ({ value: store.get(e.key) }))
  on('store.set', async (_, e) => (store.set(e.key, e.value), { value: undefined }))
  on('store.delete', async (_, e) => (store.delete(e.key), { value: undefined }))
  on('store.keys', async () => ({ value: [...store.keys()] }))
  on('session.id', async () => ({ value: SID }))
  on('session.root', async () => ({ value: ROOT }))
  on('session.cwd', async () => ({ value: ROOT }))
  on('session.usage', async () => ({
    value: {
      startedAt: 0,
      context: { window: 1_000_000 },
      rateLimits: [{ kind: 'seven_day', percentUsed: 40, resetsAt: new Date(WEEK_RESET).toISOString() }],
    },
  }))
  on('command.register', async () => ({ value: { command: 'tokens' } }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('fs.exists', async (_, e) => ({
    value: e.path === `${DIR}/${SID}.jsonl` || e.path === `${DIR}/${SID}/subagents`,
  }))
  on('fs.list', async () => ({
    value: [
      { name: 'agent-a.jsonl', kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false },
      { name: 'agent-a.meta.json', kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false },
    ],
  }))
  on('process.run', async (_, e) => {
    argvs.push(e.argv)
    if (!opts.tools) return { value: result(127, '') }

    if (e.argv[0] === 'jq') return { value: result(0, JSON.stringify(SESSION_ROWS)) }
    if (e.argv[2]?.includes('stat -f')) return { value: result(0, `${OLDEST / 1000}\n${JSON.stringify(ACCOUNT_ROWS)}`) }

    return { value: result(0, JSON.stringify(WEEK_ROWS)) }
  })
  on('session.start', async (_, e) => ({ cwd: e.cwd }))

  return { argvs, clock, store }
}

const shown = async ($: Engine) => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
  await ui.unmount()

  return text
}

const start = ($: Engine) => $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

describe('token-meter persistence', () => {
  test('a restart shows session and weekly tokens and cost, and saves both', async ($, on) => {
    const { argvs, clock, store } = engine(on, { tools: true })
    await start($)
    await clock.settle()

    const text = await shown($)
    const [session, weekly] = text.split('Weekly (since ')
    expect(session).toContain('Read     14.93M')
    expect(session).toContain('Written  68.8k')
    expect(session).toContain('Cost     $7.80 (estimated, API pricing)')
    expect(session).toContain('86 API responses · includes subagents · transcript')
    expect(session).toContain('opus        $7.80 · 15.00M tok · 86 resp')
    expect(session).not.toContain('sonnet')
    expect(weekly).toContain('Read     3.13B')
    expect(weekly).toContain('Total    3.13B')
    expect(weekly).toContain('Cost     $1116.65')
    expect(weekly).toContain('14449 API responses · all projects')
    expect(weekly).not.toContain('unpriced')
    expect(weekly).toContain('opus     $1051.14 · 2.94B tok · 12928 resp')
    expect(weekly).toContain('sonnet     $65.51 · 192.82M tok · 1514 resp')
    // The zero-token <synthetic> row is not a family line.
    expect(weekly).not.toContain('other')

    const jq = argvs.find(a => a[0] === 'jq')
    expect(jq?.slice(-2)).toEqual([`${DIR}/${SID}.jsonl`, `${DIR}/${SID}/subagents/agent-a.jsonl`])
    const sh = argvs.find(a => a[0] === 'sh')
    // The weekly window starts seven days before the weekly limit resets.
    expect(sh?.[6]).toBe(new Date(WEEK_RESET - 7 * 86_400_000).toISOString())
    expect(sh?.[5]).toBe(String(Math.ceil((NOW - (WEEK_RESET - 7 * 86_400_000)) / 60_000) + 60))
    expect((store.get(`session:${SID}`) as { usd: number }).usd.toFixed(4)).toBe('7.8042')
    expect((store.get('week') as { totals: { usd: number } }).totals.usd.toFixed(2)).toBe('1116.65')
  })

  test('the account total sums every transcript on disk, with no time filter, and is saved', async ($, on) => {
    const { argvs, clock, store } = engine(on, { tools: true })
    await start($)
    await clock.settle()

    const account = (await shown($)).split('Account total')[1] ?? ''
    expect(account).toContain(' (since ')
    expect(account).toContain('Read     9.11B')
    expect(account).toContain('Written  20.10M')
    expect(account).toContain('40300 API responses · all projects · transcripts on disk')
    expect(account).toContain('sonnet ')
    expect(account).not.toContain('calculating')

    const sh = argvs.find(a => a[0] === 'sh' && a[2]?.includes('stat -f'))
    expect(sh?.[2]).not.toContain('-mmin')
    expect(sh?.[4]).toBe(`${HOME}/.claude/projects`)
    const saved = store.get('account') as { oldest: number; totals: { turns: number } }
    expect(saved.oldest).toBe(OLDEST)
    expect(saved.totals.turns).toBe(40_300)
  })

  test('without jq a restart falls back to the saved totals', async ($, on) => {
    const { clock } = engine(on, {
      tools: false,
      store: {
        [`session:${SID}`]: { input: 10, cacheRead: 2_000, cacheWrite: 500, output: 300, turns: 4 },
        week: {
          since: WEEK_RESET - 7 * 86_400_000,
          at: NOW - 60_000,
          totals: { input: 1, cacheRead: 9_000, cacheWrite: 0, output: 1_000, turns: 9, usd: 0.5, unpricedModels: [] },
        },
      },
    })
    await start($)
    await clock.settle()

    const text = await shown($)
    const [session, weekly] = text.split('Weekly (since ')
    expect(session).toContain('Read     2.5k')
    expect(session).toContain('Written  300')
    // Totals saved before cost existed show $0.00 rather than failing.
    expect(session).toContain('Cost     $0.00')
    expect(session).toContain('4 API responses · includes subagents · saved')
    expect(weekly).toContain('Read     9.0k')
    expect(weekly).toContain('Cost     $0.50')
    // Saved totals from before the split have no family lines, and still render.
    expect(weekly).not.toContain(' tok · ')
  })

  test('a model without a price is named instead of counted as free', async ($, on) => {
    const { clock } = engine(on, { tools: true })
    WEEK_ROWS.push(row('claude-unknown-9', 10, 0, 0, 0, 10, 1))
    try {
      await start($)
      await clock.settle()
      const weekly = (await shown($)).split('Weekly (since ')[1] ?? ''
      expect(weekly).toContain('unpriced: claude-unknown-9')
      expect(weekly).toContain('other       $0.00 · 20 tok · 1 resp')
    } finally {
      WEEK_ROWS.pop()
    }
  })
})
