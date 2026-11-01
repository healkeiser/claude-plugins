import { atom, memberOf, read, update } from 'claude-code'
import type { Register, Timer } from 'claude-code'

import type { Activity } from '../types'
import { clip, commandLine, preview, took } from './bash'
import { describe, elapsed, summarize } from './label'

const activity = atom({ plugin: 'pulse', key: 'activity' } as const, null)
const durations = atom({ plugin: 'pulse', key: 'durations' } as const, null)
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

  // A Bash call's wall time, for its row. shortcut: it includes any wait on a
  // permission prompt; time from the tool.check verdict if that misleads.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const startedAt = await $.clock.now()
    const ran = await next(e)
    // Written before the result goes back, so the finished row draws with it;
    // a failed write costs the row its time, never the call its result.
    try {
      const end = await $.clock.now()
      await update($, memberOf(durations, { requestId: e.tool_use_id }), () => end - startedAt)
    } catch {}
    return ran
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

  // ● Rebase the vfx branch onto main            ✔ 1.4s
  //   $ cd ~/…/repo && git rebase main
  //   └ Successfully rebased and updated…  +3 lines
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    // ctrl+o and --verbose show the engine's full drawing.
    if (e.surface !== 'terminal' || e.props.tool !== 'Bash' || e.props.isExpanded) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const { isRunning, isErrored, isInterrupted, output } = e.props
    const input = (e.props.input ?? {}) as { command?: unknown; description?: unknown }
    const command = String(input.command ?? '')
    const width = (e.viewport?.columns ?? 80) - 2
    const headline = describe({ tool: 'Bash', command, description: input.description })

    let status: string
    let color: 'warning' | 'error' | 'inactive' | 'success'
    if (isInterrupted) [status, color] = ['⏸ interrupted', 'warning']
    else if (isErrored) [status, color] = ['✕', 'error']
    else if (isRunning) {
      // The band's own tick turns the spinner; between turns it stands still.
      const a = await read($, activity)
      ;[status, color] = [a ? SPINNER[a.frames % SPINNER.length]! : '…', 'inactive']
    } else {
      const ms = await read($, memberOf(durations, e))
      ;[status, color] = [ms === null ? '✔' : `✔ ${took(ms)}`, 'success']
    }

    // An errored call's text stays in the engine's ToolResult row below.
    const shown = isRunning || isErrored || isInterrupted ? null : preview(output)
    const more = shown?.more ? `  +${shown.more} ${shown.more === 1 ? 'line' : 'lines'}` : ''

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text wrap="truncate-end">
            <Text color={color}>● </Text>
            {headline}
          </Text>
          <Box flexShrink={0}>
            <Text color={color}>{`  ${status}`}</Text>
          </Box>
        </Box>
        <Text dimColor>{`  ${commandLine(command, width)}`}</Text>
        {shown ? (
          <Text>
            <Text dimColor>{'  └ '}</Text>
            <Text {...(shown.isStderr ? { color: 'error' as const } : { dimColor: true })}>
              {clip(shown.first, width - 2 - more.length)}
            </Text>
            <Text dimColor>{more}</Text>
          </Text>
        ) : null}
      </Box>
    )
  })

  // The compact Bash row above previews the output, so its result block would
  // say it twice; an error keeps the engine's block, its full text.
  on('ui.render', { component: 'ToolResult' }, ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.tool !== 'Bash' || e.props.isExpanded || e.props.isErrored) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
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
