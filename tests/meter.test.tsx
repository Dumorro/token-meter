import { describe, expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-06T12:00:00Z')

const usage = (input: number, read: number, write: number, output: number) => ({
  input_tokens: input,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
  output_tokens: output,
  model: 'claude-opus-5-5',
})

const turn = (id: string, u: ReturnType<typeof usage>) => ({
  answer: '',
  durationMs: 10,
  isAborted: false,
  turnId: id,
  reason: 'answer' as const,
  usage: u,
})

describe('token-meter', () => {
  test('sums read and written tokens and shows the window fill', async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.store(on)
    on('session.id', async () => ({ value: 'sess-1' }))
    on('session.root', async () => ({ value: '/nowhere' }))
    on('session.cwd', async () => ({ value: '/nowhere' }))
    on('fs.exists', async () => ({ value: false }))
    on('fs.list', async () => ({ value: [] }))
    on('turn.complete', async () => ({ text: '' }))
    on('session.measure', async (_, e) => ({ changed: e.changed }))
    await $.turn.complete(turn('t1', usage(100, 2_000, 500, 300)))
    await $.turn.complete(turn('t2', usage(50, 3_000, 0, 200)))
    await $.session.measure({
      context: { tokens: 50_000, window: 200_000, percent: 25 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 23.5, resetsAt: new Date(NOW + 133 * 60_000).toISOString() },
        { kind: 'seven_day', percentUsed: 61, resetsAt: new Date(NOW + (3 * 24 + 4) * 3_600_000 + 60_000).toISOString() },
      ],
      changed: ['context', 'rateLimits'],
    })

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'token-meter',
        surface,
        component: 'Pane',
        requestId: 'token-meter',
        props: {
          title: 'Tokens',
          isFocused: false,
          bodyColumns: 40,
          placement: 'dock',
          scroll: { offset: 0, bodyRows: 30 },
          view: {},
        },
      })
      expect((await ui.find({ type: 'Text', text: /^ {2}Lidos/ }))?.text).toContain('5.7k')
      expect((await ui.find({ type: 'Text', text: /^ {2}Escritos/ }))?.text).toContain('500')
      expect((await ui.find({ type: 'Text', text: /^ {2}Total/ }))?.text).toContain('6.2k')
      expect((await ui.find({ type: 'Text', text: /%\)$/ }))?.text).toContain('25%')
      expect((await ui.find({ type: 'Text', text: /^ {2}Custo/ }))?.text).toContain('$0.01')
      const five = (await ui.find({ type: 'Text', text: /^ {2}Janela 5h/ }))?.text ?? ''
      expect(five).toContain('76.5% livre')
      expect(five).toContain('23.5% usado')
      expect(five).toContain('reseta em 2h13')
      const week = (await ui.find({ type: 'Text', text: /^ {2}Semanal/ }))?.text ?? ''
      expect(week).toContain('39% livre')
      expect(week).toContain('reseta em 3d 4h')
      await ui.unmount()
    }
  })
})
