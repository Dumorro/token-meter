import type { FamilyCost, Totals } from '../types'

import { costOf, familyOf, FAMILIES } from './pricing'
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
  byFamily: [],
  unpricedModels: [],
}

// Adds one model's tokens and cost to its family's line; never mutates the list it is given.
export function addFamily(
  list: readonly FamilyCost[],
  model: string,
  tokens: number,
  usd: number,
  responses: number,
): FamilyCost[] {
  if (tokens === 0) return [...list]
  const family = familyOf(model)
  const next = list.some(f => f.family === family)
    ? list.map(f =>
        f.family === family
          ? { ...f, tokens: f.tokens + tokens, usd: f.usd + usd, responses: f.responses + responses }
          : f,
      )
    : [...list, { family, tokens, usd, responses }]

  return next.sort((a, b) => FAMILIES.indexOf(a.family) - FAMILIES.indexOf(b.family))
}

export function summarize(rows: readonly ModelUsage[]): Totals {
  const t: Totals = { ...EMPTY, byFamily: [], unpricedModels: [] }
  for (const r of rows) {
    t.input += r.input
    t.cacheRead += r.cacheRead
    t.cacheWrite += r.cacheWrite
    t.output += r.output
    t.turns += r.responses
    const tokens = r.input + r.cacheRead + r.cacheWrite + r.output
    const usd = costOf(r)
    if (usd !== undefined) t.usd += usd
    else if (tokens > 0) t.unpricedModels.push(r.model)
    t.byFamily = addFamily(t.byFamily, r.model, tokens, usd ?? 0, r.responses)
  }

  return t
}
