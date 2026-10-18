// US$ per million tokens, Anthropic first-party list prices (claude-api skill, cached 2026-09-25).
// Cache writes are 1.25x input (5 min) and 2x input (1 h); cache reads are 0.1x input except
// where a model sets its own rate.
import type { Family } from '../types'

type Rate = { input: number; output: number; cacheRead: number }

const RATES: [prefix: string, rate: Rate][] = [
  ['claude-fable-5-1', { input: 10, output: 50, cacheRead: 0.25 }],
  ['claude-mythos-5-1', { input: 10, output: 50, cacheRead: 0.25 }],
  ['claude-fable-5', { input: 10, output: 50, cacheRead: 1 }],
  ['claude-mythos-5', { input: 10, output: 50, cacheRead: 1 }],
  ['claude-opus-5-5', { input: 4, output: 20, cacheRead: 0.2 }],
  ['claude-opus-5', { input: 5, output: 25, cacheRead: 0.5 }],
  ['claude-opus-4-8', { input: 5, output: 25, cacheRead: 0.5 }],
  ['claude-opus-4-7', { input: 5, output: 25, cacheRead: 0.5 }],
  ['claude-opus-4-6', { input: 5, output: 25, cacheRead: 0.5 }],
  ['claude-sonnet-5-5', { input: 2, output: 10, cacheRead: 0.2 }],
  ['claude-sonnet-5', { input: 2, output: 10, cacheRead: 0.2 }],
  ['claude-sonnet-4-6', { input: 3, output: 15, cacheRead: 0.3 }],
  ['claude-haiku-4-5', { input: 1, output: 5, cacheRead: 0.1 }],
]

// Display order of the per-family cost lines; anything else falls under 'other'.
export const FAMILIES: Family[] = ['fable', 'opus', 'sonnet', 'haiku', 'other']

export const familyOf = (model: string): Family =>
  FAMILIES.find(f => f !== 'other' && model.startsWith(`claude-${f}`)) ?? 'other'

// Longest prefix first, so claude-opus-5-5 never matches claude-opus-5.
const BY_LENGTH = [...RATES].sort((a, b) => b[0].length - a[0].length)

export const rateOf = (model: string): Rate | undefined =>
  BY_LENGTH.find(([prefix]) => model.startsWith(prefix))?.[1]

export type ModelUsage = {
  model: string
  fast: boolean
  input: number
  cacheRead: number
  cacheWrite: number
  cacheWrite1h: number
  output: number
  responses: number
}

// Estimated cost of one model's usage; undefined when the model has no known price.
export function costOf(u: ModelUsage): number | undefined {
  const r = rateOf(u.model)
  if (!r) return undefined
  const write5m = Math.max(0, u.cacheWrite - u.cacheWrite1h)
  const usd =
    (u.input * r.input +
      u.cacheRead * r.cacheRead +
      write5m * r.input * 1.25 +
      u.cacheWrite1h * r.input * 2 +
      u.output * r.output) /
    1_000_000

  return u.fast ? usd * 2 : usd
}
