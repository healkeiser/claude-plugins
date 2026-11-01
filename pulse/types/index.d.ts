/**
 * `startedAt`: the turn's start, in `$.clock.now()` ms; `frames` drives the
 * spinner; `labelAt`: when `label` last changed, for its fade-in (absent in a
 * value stored by an older version).
 */
export type Activity = { label: string; tools: number; frames: number; startedAt: number; labelAt?: number }

/** One tool call of the current or last turn, for the band's Activity tab. `file`: an edited file. */
export type Call = { id: string; tool: string; label: string; state: 'running' | 'ok' | 'fail'; startedAt: number; ms?: number; file?: string }

/** The last finished main turn. `costUsd`: what it cost, null where the host keeps no ledger. */
export type Last = { durationMs: number; tools: number; isAborted: boolean; costUsd: number | null; endedAt: number }

/** When a main-thread request last used the prompt cache, and how long the API keeps it. */
export type Cache = { at: number; ttlMs: number }

/** The session folder's git state, read after edits and turns, never on a draw. */
export type Repo = { isRepo: boolean; branch: string; added: number; modified: number; deleted: number }

export type Tab = 'activity' | 'context' | 'turn' | 'git'

/** `isOpen` and `tab` are kept in `$.store` too; `band` is `/pulse band`'s choice for this session. */
export type View = { isOpen: boolean; tab: Tab; band?: 'on' | 'off' }

declare module 'claude-code' {
  interface PluginState {
    /**
     * `durations`: each Bash call's wall time in ms, by tool_use_id; null until it ends.
     * `second`: the clock as the cache countdown last ticked, to redraw it once a second.
     */
    'pulse': {
      activity: Activity | null
      durations: StateFamily<number | null>
      calls: Call[]
      last: Last | null
      cache: Cache | null
      repo: Repo | null
      view: View
      second: number
    }
  }
}
