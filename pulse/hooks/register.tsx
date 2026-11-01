import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Activity, Call } from '../types'
import { afterTool, afterTurn, registerBand } from './band'
import { clip, commandLine, preview, took } from './bash'
import { cacheLeft, cacheTtl } from './glance'
import { describe, elapsed, summarize } from './label'
import { FRAME_MS, GLYPH, ROLE, motionOn, plural, remember, spin } from './style'

const activity = atom({ plugin: 'pulse', key: 'activity' } as const, null)
const durations = atom({ plugin: 'pulse', key: 'durations' } as const, null)
const calls = atom({ plugin: 'pulse', key: 'calls' } as const, [])
const last = atom({ plugin: 'pulse', key: 'last' } as const, null)
const cache = atom({ plugin: 'pulse', key: 'cache' } as const, null)
const second = atom({ plugin: 'pulse', key: 'second' } as const, 0)

// Tool rows are the terminal's: desktop, VS Code and mobile draw them well
// already, so they stay native (DESIGN.md).
const ROWS = new Set(['terminal'])
const EDITS = /^(Edit|MultiEdit|Write|NotebookEdit)$/

const costNow = ($: EngineInterface) =>
  $.session.usage().then(u => u.cost?.usd ?? null, () => null)

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
  // The session's cost when the main turn started, for the turn's own cost.
  let costAtStart: number | null = null

  registerBand(on, options, () => isMoving)

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    turn = { tools: 0, files: new Set() }
    tick?.cancel()
    isMoving = motionOn(options.motion, await Promise.resolve().then(() => $.config.list()).catch(() => []))
    costAtStart = await costNow($)
    const startedAt = await $.clock.now()
    await update($, calls, () => [])
    await update($, activity, (): Activity => ({ label: 'thinking', tools: 0, frames: 0, startedAt, labelAt: startedAt }))
    // One tick for the whole mod: the band's spinner and the Bash rows' share it.
    tick = $.clock.every(isMoving ? FRAME_MS : 1000, () => {
      void update($, activity, a => (a ? { ...a, frames: a.frames + 1 } : a))
    })
    return next(e)
  })

  // The band's writes are never awaited: a failed one must not hold up the
  // call. Chained, so a call's end never lands before its start.
  // Counts, files and the call list are the main loop's alone: a subagent's or a
  // background agent's calls (still running after the turn ends) would make the
  // turn's tool count and its breakdown describe different sets.
  on('tool.call', async ($, e, next) => {
    const isMain = e.agentId === undefined
    const path = (e as { file_path?: unknown }).file_path
    const file = EDITS.test(e.tool) && typeof path === 'string' ? path : undefined
    if (isMain) {
      turn.tools += 1
      if (file) turn.files.add(file)
    }
    const label = describe(e)
    const id = e.tool_use_id
    const started = $.clock
      .now()
      .then(async at => {
        await update($, activity, a => (a ? { ...a, label, tools: a.tools + (isMain ? 1 : 0), ...(a.label === label ? {} : { labelAt: at }) } : a))
        if (isMain) {
          const call: Call = { id, tool: e.tool, label, state: 'running', startedAt: at, ...(file ? { file } : {}) }
          await update($, calls, list => [...(list ?? []), call].slice(-200))
        }
        return at
      })
      .catch(() => 0)
    const ran = await next(e)
    afterTool($, e.tool)
    const state: Call['state'] = ran.deny !== undefined || ran.isError ? 'fail' : 'ok'
    void started
      .then(async at => {
        const end = await $.clock.now()
        await update($, calls, list => (list ?? []).map(c => (c.id === id ? { ...c, state, ms: end - at } : c)))
      })
      .catch(() => {})
    return ran
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
      const [now, cost, usage] = await Promise.all([$.clock.now(), costNow($), $.session.usage().catch(() => null)])
      const tools = turn.tools
      await update($, last, () => ({
        durationMs: e.durationMs,
        tools,
        isAborted: e.isAborted,
        costUsd: cost !== null && costAtStart !== null && cost >= costAtStart ? cost - costAtStart : null,
        endedAt: now,
      }))
      await update($, activity, () => null)
      afterTurn($)
      // The turn's last request used the cache, which keeps the prefix a TTL
      // from then. shortcut: timed from the turn's end, so it runs late by the
      // last response's length; time each request from turn.step if that shows.
      const used = e.usage ? e.usage.cache_read_input_tokens + e.usage.cache_creation_input_tokens > 0 : true
      const [disable, force5m, enable1h] = await Promise.all([
        $.env.get('DISABLE_PROMPT_CACHING').catch(() => undefined),
        $.env.get('FORCE_PROMPT_CACHING_5M').catch(() => undefined),
        $.env.get('ENABLE_PROMPT_CACHING_1H').catch(() => undefined),
      ])
      const ttlMs = used
        ? cacheTtl({ disable: disable ?? undefined, force5m: force5m ?? undefined, enable1h: enable1h ?? undefined }, (usage?.rateLimits.length ?? 0) > 0)
        : null
      const kept = ttlMs === null ? null : { at: now, ttlMs }
      await update($, cache, () => kept)
      // The countdown redraws once a second until the prefix lapses; nothing
      // else moves while idle. It is the mod's one timer: a turn cancels it.
      if (kept) {
        await update($, second, () => now)
        const timer = $.clock.every(1000, () => {
          void $.clock
            .now()
            .then(async t => {
              await update($, second, () => t)
              if (cacheLeft(kept, t) === 0 && tick === timer) {
                timer.cancel()
                tick = undefined
              }
            })
            .catch(() => {})
        })
        tick = timer
      }
    }
    return next(e)
  })

  // /clear starts a new conversation: no cached prefix, no last turn.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      tick?.cancel()
      tick = undefined
      await update($, cache, () => null)
      await update($, last, () => null)
      await update($, calls, () => [])
    }
    return next(e)
  }).catch(($, e, next) => next(e))

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
    if (!ROWS.has(e.surface)) return next(e)
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
    if (!ROWS.has(e.surface) || e.props.tool !== 'Bash' || e.props.isExpanded) return next(e)
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
    if (!ROWS.has(e.surface) || e.props.tool !== 'Bash' || e.props.isExpanded || e.props.isErrored) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
}
