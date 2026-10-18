import { describe, expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-06T12:00:00Z')

const usage = (input: number, read: number, write: number, output: number, model = 'claude-opus-5-5') => ({
  input_tokens: input,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
  output_tokens: output,
  model,
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
    await $.turn.complete(turn('t2', usage(50, 3_000, 0, 200, 'claude-sonnet-5-5')))
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
      expect((await ui.find({ type: 'Text', text: /^ {2}Read/ }))?.text).toContain('5.7k')
      expect((await ui.find({ type: 'Text', text: /^ {2}Written/ }))?.text).toContain('500')
      expect((await ui.find({ type: 'Text', text: /^ {2}Total/ }))?.text).toContain('6.2k')
      expect((await ui.find({ type: 'Text', text: /%\)$/ }))?.text).toContain('25%')
      expect((await ui.find({ type: 'Text', text: /^ {2}Cost/ }))?.text).toContain('$0.01')
      // Each turn lands under its own model family; families with no tokens do not appear.
      expect((await ui.find({ type: 'Text', text: /^ {4}opus/ }))?.text).toContain('$0.01 · 2.9k tok · 1 resp')
      expect((await ui.find({ type: 'Text', text: /^ {4}sonnet/ }))?.text).toContain('$0.00 · 3.3k tok · 1 resp')
      expect(await ui.find({ type: 'Text', text: /^ {4}(fable|haiku)/ })).toBeUndefined()
      const five = (await ui.find({ type: 'Text', text: /^ {2}5h window/ }))?.text ?? ''
      expect(five).toContain('76.5% free')
      expect(five).toContain('23.5% used')
      expect(five).toContain('resets in 2h13')
      const week = (await ui.find({ type: 'Text', text: /^ {2}Weekly/ }))?.text ?? ''
      expect(week).toContain('39% free')
      expect(week).toContain('resets in 3d 4h')
      // bodyColumns 40 leaves a 36-cell bar: 23.5% → 8 filled, 61% → 22 filled.
      const filled = (await ui.findAll({ type: 'Text', text: /^█+$/ })).map(t => t.text)
      const empty = (await ui.findAll({ type: 'Text', text: /^░+$/ })).map(t => t.text.length)
      expect(filled.map(f => f.length)).toEqual([8, 22])
      expect(empty).toEqual([28, 14])
      await ui.unmount()
    }
  })
})
