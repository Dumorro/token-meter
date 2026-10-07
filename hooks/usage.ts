import type { Totals } from '../types'

import { costOf } from './pricing'
import type { ModelUsage } from './pricing'

// Every assistant record carries its API response's usage, repeated once per content block:
// dedupe by message id, keep records at or after $since, and sum per model and speed.
// Lines a writer left half-written are skipped.
export const AGGREGATE = [
  '[inputs | fromjson? | select(.type == "assistant" and .message.usage != null and (.timestamp // "") >= $since)',
  '| .message as $m | $m.usage as $u',
  '| {k: ($m.id // .requestId // ""), m: ($m.model // "?"), f: (($u.speed // "standard") == "fast"),',
  'in: ($u.input_tokens // 0), cr: ($u.cache_read_input_tokens // 0),',
  'w1: ($u.cache_creation.ephemeral_1h_input_tokens // 0), w: ($u.cache_creation_input_tokens // 0),',
  'out: ($u.output_tokens // 0)}]',
  '| unique_by(.k) | group_by([.m, .f])',
  '| map({model: .[0].m, fast: .[0].f, input: (map(.in) | add), cacheRead: (map(.cr) | add),',
  'cacheWrite: (map(.w) | add), cacheWrite1h: (map(.w1) | add), output: (map(.out) | add), responses: length})',
].join(' ')

export const EMPTY: Totals = {
  input: 0,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
  turns: 0,
  usd: 0,
  unpricedModels: [],
}

export function summarize(rows: readonly ModelUsage[]): Totals {
  const t: Totals = { ...EMPTY, unpricedModels: [] }
  for (const r of rows) {
    t.input += r.input
    t.cacheRead += r.cacheRead
    t.cacheWrite += r.cacheWrite
    t.output += r.output
    t.turns += r.responses
    const usd = costOf(r)
    if (usd !== undefined) t.usd += usd
    else if (r.input + r.cacheRead + r.cacheWrite + r.output > 0) t.unpricedModels.push(r.model)
  }

  return t
}
