/** Bumped after each turn so an open /prompts pane redraws with the new prompt. */
export type PromptsVersion = number

/** The sent rows' ids, the running turn, and the prompt that opened it (never a queued one). */
export type PromptsSent = { ids: readonly string[]; turnId: string | null; opener: string }

/** What the /prompts pane's search field holds; the list shows only prompts that contain it. */
export type PromptsQuery = string

/** When each sent prompt was stored, in `$.clock.now()` milliseconds, by row id: the newest 500. */
export type PromptsSentAt = Readonly<Record<string, number>>

/** The prompt the last jump landed on, which the /prompts pane marks; null is the bottom of the transcript. */
export type PromptsCursor = string | null

/**
 * A shell command Claude ran (Bash or PowerShell, in the main loop): `at` when it started and `ms` how
 * long it took, in `$.clock.now()` milliseconds; `state` running, ok, failed or denied. The newest 200.
 */
export type PromptsShellRun = { id: string; command: string; at: number; ms: number | null; state: 'running' | 'ok' | 'fail' | 'denied' }
export type PromptsShell = readonly PromptsShellRun[]

/** The /prompts pane's open tab: the prompts you sent, the ones waiting in the queue, or the shell commands Claude ran. */
export type PromptsTab = 'prompts' | 'queue' | 'shell'

/** A prompt you typed while Claude worked, waiting for the turn to end: `at` when you typed it (ms). */
export type QueuedPrompt = { id: string; text: string; at: number }

/** The queue, first to be sent first; `isHeld` stops it sending (set after an interrupt, or by you). */
export type PromptsQueue = { items: readonly QueuedPrompt[]; isHeld: boolean }

declare module 'claude-code' {
  interface PluginState {
    'postcard': { version: PromptsVersion; sent: PromptsSent; query: PromptsQuery; sentAt: PromptsSentAt; cursor: PromptsCursor; shell: PromptsShell; tab: PromptsTab; queue: PromptsQueue }
  }
}
