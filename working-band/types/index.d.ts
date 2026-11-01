/** `startedAt`: the turn's start, in `$.clock.now()` ms; `frames` drives the spinner. */
export type Activity = { label: string; tools: number; frames: number; startedAt: number }

declare module 'claude-code' {
  interface PluginState {
    'working-band': { activity: Activity | null }
  }
}
