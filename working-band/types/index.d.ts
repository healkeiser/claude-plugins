/** `startedAt`: the turn's start, in `$.clock.now()` ms; `frames` drives the spinner. */
export type Activity = { label: string; tools: number; frames: number; startedAt: number }

declare module 'claude-code' {
  interface PluginState {
    /** `durations`: each Bash call's wall time in ms, by tool_use_id; null until it ends. */
    'working-band': { activity: Activity | null; durations: StateFamily<number | null> }
  }
}
