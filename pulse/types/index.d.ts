/**
 * `startedAt`: the turn's start, in `$.clock.now()` ms; `frames` drives the
 * spinner; `labelAt`: when `label` last changed, for its fade-in (absent in a
 * value stored by an older version).
 */
export type Activity = { label: string; tools: number; frames: number; startedAt: number; labelAt?: number }

declare module 'claude-code' {
  interface PluginState {
    /** `durations`: each Bash call's wall time in ms, by tool_use_id; null until it ends. */
    'pulse': { activity: Activity | null; durations: StateFamily<number | null> }
  }
}
