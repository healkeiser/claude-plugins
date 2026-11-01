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

declare module 'claude-code' {
  interface PluginState {
    'postcard': { version: PromptsVersion; sent: PromptsSent; query: PromptsQuery; sentAt: PromptsSentAt; cursor: PromptsCursor }
  }
}
