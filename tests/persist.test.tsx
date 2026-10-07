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

    return { value: result(0, JSON.stringify(e.argv[0] === 'jq' ? SESSION_ROWS : WEEK_ROWS)) }
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
    const [session, weekly] = text.split('Semanal (desde ')
    expect(session).toContain('Lidos    14.93M')
    expect(session).toContain('Escritos 68.8k')
    expect(session).toContain('Custo    $7.80 (estimado, preço de API)')
    expect(session).toContain('86 respostas da API · inclui subagentes · transcript')
    expect(weekly).toContain('Lidos    3.13B')
    expect(weekly).toContain('Total    3.13B')
    expect(weekly).toContain('Custo    $1116.65')
    expect(weekly).toContain('14449 respostas da API · todos os projetos')
    expect(weekly).not.toContain('sem preço')

    const jq = argvs.find(a => a[0] === 'jq')
    expect(jq?.slice(-2)).toEqual([`${DIR}/${SID}.jsonl`, `${DIR}/${SID}/subagents/agent-a.jsonl`])
    const sh = argvs.find(a => a[0] === 'sh')
    // The weekly window starts seven days before the weekly limit resets.
    expect(sh?.[6]).toBe(new Date(WEEK_RESET - 7 * 86_400_000).toISOString())
    expect(sh?.[5]).toBe(String(Math.ceil((NOW - (WEEK_RESET - 7 * 86_400_000)) / 60_000) + 60))
    expect((store.get(`session:${SID}`) as { usd: number }).usd.toFixed(4)).toBe('7.8042')
    expect((store.get('week') as { totals: { usd: number } }).totals.usd.toFixed(2)).toBe('1116.65')
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
    const [session, weekly] = text.split('Semanal (desde ')
    expect(session).toContain('Lidos    2.5k')
    expect(session).toContain('Escritos 300')
    // Totals saved before cost existed show $0.00 rather than failing.
    expect(session).toContain('Custo    $0.00')
    expect(session).toContain('4 respostas da API · inclui subagentes · salvo')
    expect(weekly).toContain('Lidos    9.0k')
    expect(weekly).toContain('Custo    $0.50')
  })

  test('a model without a price is named instead of counted as free', async ($, on) => {
    const { clock } = engine(on, { tools: true })
    WEEK_ROWS.push(row('claude-unknown-9', 10, 0, 0, 0, 10, 1))
    try {
      await start($)
      await clock.settle()
      const weekly = (await shown($)).split('Semanal (desde ')[1] ?? ''
      expect(weekly).toContain('sem preço: claude-unknown-9')
    } finally {
      WEEK_ROWS.pop()
    }
  })
})
