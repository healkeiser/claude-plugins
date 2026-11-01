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

/** A changed file of the work tree: its porcelain status letter, path and line counts (null for a binary file). */
export type RepoFile = { path: string; status: string; add: number | null; del: number | null }

/**
 * The session folder's git state, read after edits and turns, never on a draw.
 * `upstream` is '' with no tracking branch; `ahead`/`behind` against it. `staged`,
 * `unstaged`, `untracked`, `conflicted` count files; `add`/`del` count lines
 * against HEAD; `files` are the most changed, at most 6. `last`: HEAD's commit,
 * `at` in ms. `op`: a rebase, merge, cherry-pick, revert or bisect under way,
 * '' otherwise. `startOid`: HEAD when the session first read it, so `session`
 * lists the commits made since, oldest first (at most 50; `commits` counts
 * them all). `worktrees`: the repo's work trees, this one included.
 * `fetchedAt`: when the repo last fetched (FETCH_HEAD's time, ms), null if never.
 */
export type Repo = {
  isRepo: boolean
  branch: string
  oid: string
  upstream: string
  ahead: number
  behind: number
  stash: number
  staged: number
  unstaged: number
  untracked: number
  conflicted: number
  add: number
  del: number
  files: RepoFile[]
  last: { hash: string; subject: string; at: number } | null
  op: string
  startOid: string
  commits: number
  session: { hash: string; subject: string }[]
  worktrees: number
  fetchedAt: number | null
}

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
      /** Tagged `repo-3`: a value stored before its fields grew reads as absent. */
      repo: Shaped<Repo | null>
      view: View
      second: number
    }
  }
}
