// The prompt queue's rules: which prompts postcard keeps for after the turn,
// and how the list is reordered. Pure. register.tsx holds the queue and sends.
import type { QueuedPrompt } from '../types'

/**
 * Whether postcard queues a prompt typed while Claude works. Slash commands
 * stay with the engine, and so does a prompt that names a file (`@src/a.ts`)
 * or holds a pasted image: a plugin's prompt does not expand those, so
 * queuing it here would lose them.
 */
export function isQueueable(text: string): boolean {
  const t = text.trim()
  if (!t || t.startsWith('/')) return false
  if (/(^|\s)@[\w./\\~-]/.test(t)) return false
  if (/\[Image #\d+\]/.test(t)) return false
  return true
}

/** The queue with the prompt `id` moved one place: -1 earlier, 1 later. At an end, unchanged. */
export function moveQueued(queue: readonly QueuedPrompt[], id: string, by: -1 | 1): QueuedPrompt[] {
  const i = queue.findIndex(q => q.id === id)
  const j = i + by
  if (i < 0 || j < 0 || j >= queue.length) return [...queue]
  const out = [...queue]
  ;[out[i], out[j]] = [out[j]!, out[i]!]
  return out
}
