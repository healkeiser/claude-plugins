import { atom, read, update } from 'claude-code'
import type { Register, Timer } from 'claude-code'

import type { Activity } from '../types'
import { describe, elapsed, summarize } from './label'

const activity = atom({ plugin: 'working-band', key: 'activity' } as const, null)
const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
// 8 frames a second: smooth enough for a braille spinner, light on redraws.
const FRAME_MS = 125

type TurnStats = { tools: number; files: Set<string> }

export const register: Register = on => {
  let tick: Timer | undefined
  // This turn's counts, the last finished turn's waiting for its footer, and
  // each footer's once drawn. Module memory: after a reload, older footers
  // draw as the engine's.
  let turn: TurnStats = { tools: 0, files: new Set() }
  let finished: TurnStats | null = null
  const footers = new Map<string, TurnStats>()

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    turn = { tools: 0, files: new Set() }
    tick?.cancel()
    const startedAt = await $.clock.now()
    await update($, activity, (): Activity => ({ label: 'thinking', tools: 0, frames: 0, startedAt }))
    tick = $.clock.every(FRAME_MS, () => {
      void update($, activity, a => (a ? { ...a, frames: a.frames + 1 } : a))
    })
    return next(e)
  })

  // Never awaited: a failed band update must not hold up the tool call.
  on('tool.call', ($, e, next) => {
    turn.tools += 1
    const path = (e as { file_path?: unknown }).file_path
    if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(e.tool) && typeof path === 'string') turn.files.add(path)
    update($, activity, a => (a ? { ...a, label: describe(e), tools: a.tools + 1 } : a)).catch(() => {})
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      finished = turn
      tick?.cancel()
      tick = undefined
      await update($, activity, () => null)
    }
    return next(e)
  })

  // `✻ Baked for 29s · 6 tools · 2 files edited`
  on('ui.render', { component: 'TurnDuration' }, ($, e, next) => {
    // Drawn for a fixed-width terminal; other surfaces keep their own look.
    if (e.surface !== 'terminal') return next(e)
    if (!footers.has(e.requestId) && finished) {
      footers.set(e.requestId, finished)
      finished = null
    }
    const stats = footers.get(e.requestId)
    if (!stats || stats.tools === 0) return next(e)

    const { Text } = $.ui.resolve(e)
    const parts = [
      `${e.props.word} for ${elapsed(Math.round(e.props.durationMs / 1000))}`,
      stats.tools === 1 ? '1 tool' : `${stats.tools} tools`,
      ...(stats.files.size ? [`${stats.files.size} ${stats.files.size === 1 ? 'file' : 'files'} edited`] : []),
    ]
    return <Text dimColor>{`✻ ${parts.join('  ·  ')}`}</Text>
  })

  // `◇ 3 reads  ·  ⌕ 2 searches`, dim, so the replies stand out.
  on('ui.render', { component: 'ToolGroup' }, ($, e, next) => {
    // Drawn for a fixed-width terminal; other surfaces keep their own look.
    if (e.surface !== 'terminal') return next(e)
    if (e.props.isExpanded || e.props.calls.length === 0) return next(e)
    const { Text } = $.ui.resolve(e)
    const { text, failed } = summarize(e.props.calls)
    const isRunning = e.props.calls.some(c => c.isRunning)
    return (
      <Text>
        <Text dimColor>{`  ${text}${isRunning ? '  …' : ''}`}</Text>
        {failed ? <Text color="error">{`  ·  ✕ ${failed} failed`}</Text> : null}
      </Text>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Drawn for a fixed-width terminal; other surfaces keep their own look.
    if (e.surface !== 'terminal') return next(e)
    const a = await read($, activity)
    if (e.props.hasSurvey || !e.props.isWorking || a === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const tools = a.tools === 1 ? '1 tool' : `${a.tools} tools`
    // From the clock, not the frame count: each tick lands a little late, so
    // frames fall behind the real time over a long turn. A value stored before
    // startedAt existed falls back to frames.
    const ms = a.startedAt ? (await $.clock.now()) - a.startedAt : a.frames * FRAME_MS

    return (
      <Box flexDirection="row">
        <Text color="claude">{SPINNER[a.frames % SPINNER.length]} </Text>
        <Text wrap="truncate-end">
          {a.label}
          <Text dimColor>{`  ·  ${tools}  ·  ${elapsed(Math.floor(ms / 1000))}`}</Text>
        </Text>
      </Box>
    )
  })
}
