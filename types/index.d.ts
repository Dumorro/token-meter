export type Family = 'fable' | 'opus' | 'sonnet' | 'haiku' | 'other'

// Tokens and estimated cost of one model family; only families with tokens appear, in a fixed order.
export type FamilyCost = { family: Family; tokens: number; usd: number; responses: number }

export type Totals = {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  turns: number
  usd: number
  byFamily: FamilyCost[]
  unpricedModels: string[]
}

export type Week = { since: number; at: number; totals: Totals }

// Every transcript still on disk, across all projects; `oldest` is the earliest file's mtime.
export type Account = { oldest: number | null; at: number; totals: Totals }

export type Source = 'transcript' | 'saved' | 'live'

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Window = { tokens: number | null; size: number; percent: number | null }

declare module 'claude-code' {
  interface PluginState {
    'token-meter': {
      totals: Totals
      week: Week | null
      account: Account | null
      source: Source
      window: Window | null
      usd: number | null
      limits: Limit[]
    }
  }
}
