/** A code block's address: the message id, a colon, the block's index. */
export type FoldId = string

declare module 'claude-code' {
  interface PluginState {
    'gloss': { expanded: readonly FoldId[]; lastReply: string }
  }
}
