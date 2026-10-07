export type Totals = {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  turns: number
  usd: number
  unpricedModels: string[]
}

export type Week = { since: number; at: number; totals: Totals }

export type Source = 'transcript' | 'saved' | 'live'

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Window = { tokens: number | null; size: number; percent: number | null }

declare module 'claude-code' {
  interface PluginState {
    'token-meter': {
      totals: Totals
      week: Week | null
      source: Source
      window: Window | null
      usd: number | null
      limits: Limit[]
    }
  }
}
