import { atom, memberOf, read, update } from 'claude-code'
import type { Register, Timer } from 'claude-code'

import type { Activity } from '../types'
import { clip, commandLine, preview, took } from './bash'
import { describe, elapsed, summarize } from './label'
import { FRAME_MS, GLYPH, ROLE, isFading, motionOn, plural, remember, spin } from './style'

const activity = atom({ plugin: 'pulse', key: 'activity' } as const, null)
const durations = atom({ plugin: 'pulse', key: 'durations' } as const, null)
// Drawn on the terminal, desktop and VS Code; mobile keeps the engine's look.
const SURFACES = new Set(['terminal', 'desktop', 'vscode'])

type TurnStats = { tools: number; files: Set<string> }

export const register: Register = (on, options) => {
  let tick: Timer | undefined
  // Read again at each turn: Reduce motion may change mid-session. Stilled, the
  // tick runs once a second for the elapsed time and nothing spins.
  let isMoving = motionOn(options.motion)
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
    isMoving = motionOn(options.motion, await Promise.resolve().then(() => $.config.list()).catch(() => []))
    const startedAt = await $.clock.now()
    await update($, activity, (): Activity => ({ label: 'thinking', tools: 0, frames: 0, startedAt, labelAt: startedAt }))
    // One tick for the whole mod: the band's spinner and the Bash rows' share it.
    tick = $.clock.every(isMoving ? FRAME_MS : 1000, () => {
      void update($, activity, a => (a ? { ...a, frames: a.frames + 1 } : a))
    })
    return next(e)
  })

  // Never awaited: a failed band update must not hold up the tool call.
  on('tool.call', ($, e, next) => {
    turn.tools += 1
    const path = (e as { file_path?: unknown }).file_path
    if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(e.tool) && typeof path === 'string') turn.files.add(path)
    const label = describe(e)
    $.clock
      .now()
      .then(at => update($, activity, a => (a ? { ...a, label, tools: a.tools + 1, ...(a.label === label ? {} : { labelAt: at }) } : a)))
      .catch(() => {})
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
    // Raised on the terminal only.
    if (e.surface !== 'terminal') return next(e)
    if (!footers.has(e.requestId) && finished) {
      remember(footers, e.requestId, finished)
      finished = null
    }
    const stats = footers.get(e.requestId)
    if (!stats || stats.tools === 0) return next(e)

    const { Text } = $.ui.resolve(e)
    const parts = [
      `${e.props.word} for ${elapsed(Math.round(e.props.durationMs / 1000))}`,
      plural(stats.tools, 'tool'),
      ...(stats.files.size ? [`${plural(stats.files.size, 'file')} edited`] : []),
    ]
    return <Text dimColor>{`✻ ${parts.join('  ·  ')}`}</Text>
  })

  // `◇ 3 reads  ·  ⌕ 2 searches`, dim, so the replies stand out.
  on('ui.render', { component: 'ToolGroup' }, ($, e, next) => {
    if (!SURFACES.has(e.surface)) return next(e)
    if (e.props.isExpanded || e.props.calls.length === 0) return next(e)
    const { Text } = $.ui.resolve(e)
    const { text, failed } = summarize(e.props.calls)
    const isRunning = e.props.calls.some(c => c.isRunning)
    return (
      <Text>
        <Text dimColor>{`  ${text}${isRunning ? `  ${GLYPH.more}` : ''}`}</Text>
        {failed ? <Text color={ROLE.error}>{`  ${GLYPH.dot}  ${GLYPH.fail} ${failed} failed`}</Text> : null}
      </Text>
    )
  })

  // ● Rebase the vfx branch onto main            ✓ 1.4s
  //   $ cd ~/…/repo && git rebase main
  //   └ Successfully rebased and updated…  +3 lines
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    // ctrl+o and --verbose show the engine's full drawing.
    if (!SURFACES.has(e.surface) || e.props.tool !== 'Bash' || e.props.isExpanded) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const { isRunning, isErrored, isInterrupted, output } = e.props
    const input = (e.props.input ?? {}) as { command?: unknown; description?: unknown }
    const command = String(input.command ?? '')
    const width = (e.viewport?.columns ?? 80) - 2
    const headline = describe({ tool: 'Bash', command, description: input.description })

    let status: string
    let color: 'warning' | 'error' | 'inactive' | 'success'
    if (isInterrupted) [status, color] = [`${GLYPH.stop} interrupted`, ROLE.warning]
    else if (isErrored) [status, color] = [GLYPH.fail, ROLE.error]
    else if (isRunning) {
      // The band's own tick turns the spinner; between turns, or stilled, it stands.
      const a = await read($, activity)
      ;[status, color] = [a && isMoving ? spin(a.frames) : GLYPH.more, ROLE.muted]
    } else {
      const ms = await read($, memberOf(durations, e))
      ;[status, color] = [ms === null ? GLYPH.ok : `${GLYPH.ok} ${took(ms)}`, ROLE.success]
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
    if (!SURFACES.has(e.surface) || e.props.tool !== 'Bash' || e.props.isExpanded || e.props.isErrored) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  // The band is shared: other mods' rows come from `next(e)` and stay under
  // ours, in a column Box given no width, height or position of its own.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Raised on the terminal and desktop.
    if (!SURFACES.has(e.surface)) return next(e)
    const a = await read($, activity)
    if (e.props.hasSurvey || !e.props.isWorking || a === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    // From the clock, not the frame count: each tick lands a little late, so
    // frames fall behind the real time over a long turn. A value stored before
    // startedAt existed falls back to frames.
    const now = await $.clock.now()
    const ms = a.startedAt ? now - a.startedAt : a.frames * FRAME_MS
    // A new action draws dim for its first moment, then normal: it fades in.
    const isNew = isMoving && a.labelAt !== undefined && isFading(now - a.labelAt)

    const mine = (
      <Box flexDirection="row">
        <Text color={ROLE.accent}>{isMoving ? spin(a.frames) : GLYPH.live} </Text>
        <Text wrap="truncate-end">
          <Text dimColor={isNew}>{a.label}</Text>
          <Text dimColor>{`  ${GLYPH.dot}  ${plural(a.tools, 'tool')}  ${GLYPH.dot}  ${elapsed(Math.floor(ms / 1000))}`}</Text>
        </Text>
      </Box>
    )
    return (
      <Box flexDirection="column">
        {mine}
        {await next(e)}
      </Box>
    )
  })
}
