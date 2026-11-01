/** Bumped after each turn so an open /prompts pane redraws with the new prompt. */
export type PromptsVersion = number

/** The sent rows' ids, the running turn, and the prompt that opened it (never a queued one). */
export type PromptsSent = { ids: readonly string[]; turnId: string | null; opener: string }

declare module 'claude-code' {
  interface PluginState {
    'postcard': { version: PromptsVersion; sent: PromptsSent }
  }
}
