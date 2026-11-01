// The band above the prompt: one row, folded by default, that reads the turn
// while Claude works and the session's gauges while it waits; unfolded, a card
// with four tabs. Drawn on the terminal and desktop, the two that raise it.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, PluginOptions, RenderChildren } from 'claude-code'

import type { Call, Repo, Tab, View } from '../types'
import { took } from './bash'
import { cacheLeft, cacheUsed, countdown, fit, parseGitStatus, svgMeter } from './glance'
import type { Piece } from './glance'
import { elapsed, summarize } from './label'
import {
  GLYPH, ROLE, asciiTree, canRamp, cellWidth, clip, count, heat, heatHex, heatRuns, isAsciiGlyphs, isFading, meter, padCells,
  plural, span, spin, usd, wholePct,
} from './style'

const activity = atom({ plugin: 'pulse', key: 'activity' } as const, null)
const calls = atom({ plugin: 'pulse', key: 'calls' } as const, [])
const last = atom({ plugin: 'pulse', key: 'last' } as const, null)
const cache = atom({ plugin: 'pulse', key: 'cache' } as const, null)
const repo = atom({ plugin: 'pulse', key: 'repo' } as const, null)
const DEFAULT_VIEW: View = { isOpen: false, tab: 'activity' }
const view = atom({ plugin: 'pulse', key: 'view' } as const, DEFAULT_VIEW)
const second = atom({ plugin: 'pulse', key: 'second' } as const, 0)
/** Where the open tab and the folded state are kept across sessions. */
const STORE_KEY = 'band'

const BAND = new Set(['terminal', 'desktop'])
const TABS: readonly { id: Tab; key: string; short: string; long: string; title: string }[] = [
  { id: 'activity', key: '1', short: 'act', long: 'activity', title: 'Activity' },
  { id: 'context', key: '2', short: 'ctx', long: 'context', title: 'Context & cache' },
  { id: 'turn', key: '3', short: 'turn', long: 'turn', title: 'Turn' },
  { id: 'git', key: '4', short: 'git', long: 'git', title: 'Git' },
]
// Calls that may change the session folder's files: git is read again a second after the last.
const REPO_TOOLS = new Set(['Bash', 'PowerShell', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
// Single-line bands put two spaces either side of `·` (DESIGN.md, Spacing).
const DOT = `  ${GLYPH.dot}  `
const ACTIVITY_ROWS = 6

const isTab = (x: unknown): x is Tab => TABS.some(t => t.id === x)
const base = (path: string) => path.split(/[\\/]/).pop() || path
const limitName = (kind: string) =>
  kind.replace(/five[_ -]?hours?/i, '5h').replace(/seven[_ -]?days?/i, '7d').replace(/[_-]+/g, ' ').trim()

/** The session folder's git state, by argument vector, no shell, never on a draw; unchanged, no write. */
async function readRepo($: EngineInterface) {
  const dir = await $.session.cwd().catch(() => '')
  if (!dir) return
  const st = await $.process
    .run(['git', '-C', dir, '--no-optional-locks', 'status', '--porcelain=v2', '--branch'], { cwd: dir, timeoutMs: 3000 })
    .catch(() => null)
  const isRepo = st !== null && st.exitCode === 0
  const found: Repo = { isRepo, ...(st && isRepo ? parseGitStatus(st.stdout) : { branch: '', added: 0, modified: 0, deleted: 0 }) }
  if (JSON.stringify(await read($, repo)) !== JSON.stringify(found)) await update($, repo, () => found)
}

// A newer call within the second supersedes an older one.
let repoTick = 0
/** After a call that may change files (register's `tool.call` hook): git is read a second after the last. */
export function afterTool($: EngineInterface, tool: string) {
  if (!REPO_TOOLS.has(tool)) return
  const mine = (repoTick += 1)
  void $.clock
    .sleep(1000)
    .then(() => (mine === repoTick ? readRepo($) : undefined))
    .catch(() => undefined)
}
/** At the end of a main turn (register's `turn.complete` hook). */
export function afterTurn($: EngineInterface) {
  void readRepo($).catch(() => {})
}

/** Whether the band is hidden: `/pulse band` this session, else the `band` option. */
const hiddenBy = (v: View, option: unknown) => (v.band ?? (option === 'off' ? 'off' : 'on')) === 'off'

async function setView($: EngineInterface, fn: (v: View) => View) {
  const v = await update($, view, x => fn({ ...DEFAULT_VIEW, ...x }))
  await $.store.set(STORE_KEY, { isOpen: v.isOpen, tab: v.tab }).catch(() => {})
}
/** A tab's key opens it; the open tab's own key folds the band again. */
function pressTab($: EngineInterface, tab: Tab) {
  return setView($, v => (v.isOpen && v.tab === tab ? { ...v, isOpen: false } : { ...v, isOpen: true, tab }))
}
function pressFold($: EngineInterface) {
  return setView($, v => ({ ...v, isOpen: !v.isOpen }))
}

export function registerBand(on: On, options: PluginOptions, isMoving: () => boolean) {
  // The terminal draws the status line's colour ramp when it has 256 colours
  // or more (read at session start); else meters take the three role colours.
  let ramp = true
  // Each graphical meter's lit width as last drawn, so a new reading glides from there.
  const widths = new Map<string, number>()
  const isHidden = (v: View) => hiddenBy(v, options.band)

  on('session.start', async ($, e, next) => {
    await $.command
      .register({ name: 'pulse', description: 'Show, hide or toggle the pulse band above the prompt', argumentHint: 'band on|off|toggle' })
      .catch(() => {})
    const saved = (await $.store.get(STORE_KEY).catch(() => undefined)) as Partial<View> | undefined
    if (saved && typeof saved === 'object') {
      await update($, view, v => ({ ...DEFAULT_VIEW, ...v, isOpen: saved.isOpen === true, tab: isTab(saved.tab) ? saved.tab : 'activity' }))
    }
    const [COLORTERM, TERM, WT_SESSION] = await Promise.all([
      $.env.get('COLORTERM').catch(() => undefined),
      $.env.get('TERM').catch(() => undefined),
      $.env.get('WT_SESSION').catch(() => undefined),
    ])
    ramp = canRamp({ COLORTERM: COLORTERM ?? undefined, TERM: TERM ?? undefined, WT_SESSION: WT_SESSION ?? undefined })
    void readRepo($).catch(() => {})
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'pulse' }, async ($, e) => {
    const [what, how = 'toggle'] = e.args.trim().split(/\s+/)
    if (what !== 'band' || !['on', 'off', 'toggle'].includes(how)) return { text: 'Usage: /pulse band on|off|toggle' }
    const v = await update($, view, x => {
      const now = { ...DEFAULT_VIEW, ...x }
      const band: 'on' | 'off' = how === 'toggle' ? (isHidden(now) ? 'on' : 'off') : (how as 'on' | 'off')
      return { ...now, band }
    })
    return { text: isHidden(v) ? 'pulse band hidden. /pulse band on shows it again.' : 'pulse band shown.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!BAND.has(e.surface) || e.props.hasSurvey) return next(e)
    const v: View = { ...DEFAULT_VIEW, ...(await read($, view)) }
    if (isHidden(v)) return next(e)

    // The band is shared: other mods' rows come from `next(e)` and stay under
    // ours, in a column Box given no width, height or position of its own.
    // It rejects only where nothing answers beneath (a test): ours still draws.
    const below = await next(e).catch(() => undefined)

    const [a, list, l, c, r, now, u] = await Promise.all([
      read($, activity),
      read($, calls),
      read($, last),
      read($, cache),
      read($, repo),
      $.clock.now(),
      $.session.usage().catch(() => null),
      // Read so the countdown's once-a-second write redraws the band.
      read($, second),
    ])
    const { Box, Text, Button } = $.ui.resolve(e)
    const isTerm = e.surface === 'terminal'
    const moving = isMoving()
    const isWorking = e.props.isWorking && a !== null
    const turnCalls: readonly Call[] = list ?? []
    const width = e.props.bodyColumns || 80
    const ctxPct = u?.context.percent
    const limits = (u?.rateLimits ?? []).map(x => {
      const at = x.resetsAt ? Date.parse(x.resetsAt) : NaN
      return { name: limitName(x.kind), pct: x.percentUsed, left: Number.isFinite(at) ? at - now : null }
    })
    const cacheLeftMs = c ? cacheLeft(c, now) : null
    const cachePct = c ? cacheUsed(c, now) : 0
    const isCacheWarm = cacheLeftMs !== null && cacheLeftMs > 0
    const pctColor = (pct: number) => (ramp || !isTerm ? heatHex(pct) : heat(pct))

    // ---- pieces shared by both forms

    // A meter: the ramp per cell on the terminal, a gliding SVG gradient on desktop; the number beside it says it.
    const bar = (key: string, pct: number, cells: number, title: string) => {
      if (e.surface !== 'terminal') {
        const { Svg } = $.ui.resolve(e)
        const drawn = svgMeter(pct, cells, widths.get(key), !moving, title)
        widths.set(key, drawn.width)
        return <Svg source={drawn.source} alt={title} isInteractive />
      }
      if (ramp) return <Text>{heatRuns(pct, cells).map(run => <Text color={run.color}>{run.text}</Text>)}</Text>
      const m = meter(pct, cells)
      return (
        <Text>
          <Text color={heat(pct)}>{m.fill}</Text>
          <Text color={ROLE.chrome}>{m.track}</Text>
        </Text>
      )
    }
    const spinner = isWorking && moving ? spin(a.frames) : GLYPH.live
    const runMs = a ? (a.startedAt ? now - a.startedAt : a.frames * 100) : 0
    const lastMark = l ? (l.isAborted ? { glyph: GLYPH.stop, color: ROLE.warning } : { glyph: GLYPH.ok, color: ROLE.success }) : null
    const lastText = l ? `${l.isAborted ? 'interrupted ' : ''}${elapsed(Math.round(l.durationMs / 1000))}` : ''
    const cacheText = isCacheWarm ? `${GLYPH.reset} ${countdown(cacheLeftMs)}` : `${GLYPH.idle} expired`

    const tabButton = (t: (typeof TABS)[number], label: string) => {
      const isActive = v.isOpen && v.tab === t.id
      if (!isTerm) {
        return (
          <Button key={`tab-${t.id}`} label={t.title} hotkey={t.key} {...(isActive ? { variant: 'primary' as const } : { dimColor: true })} onPress={() => pressTab($, t.id)} />
        )
      }
      return (
        <Button key={`tab-${t.id}`} plain hotkey={t.key} {...(isActive ? {} : { dimColor: true })} onPress={() => pressTab($, t.id)}>
          {isActive ? <Text color={ROLE.accent}>{label}</Text> : label}
        </Button>
      )
    }
    const fold = isTerm ? (
      <Button key="fold" plain label={v.isOpen ? '▾' : '▴'} dimColor onPress={() => pressFold($)} />
    ) : (
      <Button key="fold" label={v.isOpen ? 'Collapse' : 'Expand'} onPress={() => pressFold($)} />
    )

    // ---- folded: one row, never wrapped; the least important pieces leave first

    const folded = () => {
      const tabCells = TABS.reduce((n, t) => n + 2 + cellWidth(`${t.key}: ${t.short}`), 0)
      const left: (Piece & { node: () => RenderChildren })[] = []
      if (isWorking) {
        left.push({ id: 'tools', cells: cellWidth(DOT + plural(a.tools, 'tool')), drop: 3, node: () => <Text dimColor>{DOT + plural(a.tools, 'tool')}</Text> })
        left.push({ id: 'time', cells: cellWidth(DOT + elapsed(Math.floor(runMs / 1000))), drop: 2, node: () => <Text dimColor>{DOT + elapsed(Math.floor(runMs / 1000))}</Text> })
      } else {
        if (l) {
          const tools = DOT + plural(l.tools, 'tool')
          left.push({ id: 'tools', cells: cellWidth(tools), drop: 3, node: () => <Text dimColor>{tools}</Text> })
          if (l.costUsd !== null) left.push({ id: 'cost', cells: cellWidth(DOT + usd(l.costUsd)), drop: 2, node: () => <Text dimColor>{DOT + usd(l.costUsd!)}</Text> })
        }
        if (ctxPct !== undefined) {
          const cells = 6
          left.push({
            id: 'ctx',
            cells: cellWidth(`${DOT}ctx `) + cells + cellWidth(` ${wholePct(ctxPct)}%`),
            drop: 5,
            node: () => (
              <Box flexDirection="row" alignItems="center">
                <Text dimColor>{`${DOT}ctx `}</Text>
                {bar('mini-ctx', ctxPct, cells, `context ${wholePct(ctxPct)}% used`)}
                <Text color={pctColor(ctxPct)}>{` ${wholePct(ctxPct)}%`}</Text>
              </Box>
            ),
          })
        }
        if (c) {
          left.push({
            id: 'cache',
            cells: cellWidth(`${DOT}cache ${cacheText}`),
            drop: 4,
            node: () => (
              <Text>
                <Text dimColor>{`${DOT}cache `}</Text>
                <Text {...(isCacheWarm ? { color: pctColor(cachePct) } : { dimColor: true })}>{cacheText}</Text>
              </Text>
            ),
          })
        }
      }
      const lead = isWorking ? a.label : l ? lastText : 'idle'
      const leadMin = 2 + Math.min(cellWidth(lead), 12)
      const pieces: Piece[] = [{ id: 'lead', cells: leadMin, drop: 0 }, ...left, { id: 'tabs', cells: tabCells, drop: 1 }, { id: 'fold', cells: 3, drop: 0 }]
      const kept = isTerm ? fit(pieces, width) : new Set(pieces.map(p => p.id))
      const used = pieces.filter(p => kept.has(p.id) && p.id !== 'lead').reduce((n, p) => n + p.cells, 0)
      const leadText = isTerm ? clip(lead, Math.max(1, width - used - 2)) : lead
      const isNew = isWorking && moving && a.labelAt !== undefined && isFading(now - a.labelAt)

      return (
        <Box flexDirection="row" alignItems="center" {...(isTerm ? { width } : { gap: 1 })}>
          {isWorking ? (
            <Text>
              <Text color={ROLE.accent}>{`${spinner} `}</Text>
              <Text dimColor={isNew}>{leadText}</Text>
            </Text>
          ) : (
            <Text>
              {lastMark ? <Text color={lastMark.color}>{`${lastMark.glyph} `}</Text> : <Text dimColor>{`${GLYPH.idle} `}</Text>}
              <Text dimColor={!l}>{leadText}</Text>
            </Text>
          )}
          {left.filter(p => kept.has(p.id)).map(p => p.node())}
          <Box flexGrow={1} />
          {kept.has('tabs') ? (
            <Box flexDirection="row" gap={isTerm ? 2 : 1}>
              {TABS.map(t => tabButton(t, t.short))}
            </Box>
          ) : null}
          <Box marginLeft={isTerm ? 2 : 1}>{fold}</Box>
        </Box>
      )
    }

    // ---- unfolded: a rounded card, the header, the tabs, then the open tab

    const inner = Math.max(10, width - 4)
    const dim = (s: string) => <Text dimColor>{s}</Text>
    // A labelled row of the card: the label dim in a fixed column, then the rest.
    const labelled = (key: string, label: string, col: number, rest: RenderChildren) => (
      <Box key={key} flexDirection="row">
        <Text dimColor mono={!isTerm}>{padCells(label, col)}</Text>
        {rest}
      </Box>
    )
    // Details secondary: dim at rest; on desktop the row lights them under the pointer.
    const detail = (s: string, color?: string) => (
      <Text {...(color ? { color } : { dimColor: true })} {...(isTerm ? {} : { hover: { dimColor: false } })} wrap="truncate-end">
        {s}
      </Text>
    )

    const activityRows = () => {
      if (turnCalls.length === 0) return [dim(`${GLYPH.idle} ${isWorking ? 'no tool calls yet' : 'no tool calls in the last turn'}`)]
      const shown = turnCalls.slice(-ACTIVITY_ROWS)
      const earlier = turnCalls.length - shown.length
      const rows = shown.map(call => {
        const [glyph, color] =
          call.state === 'running'
            ? [isWorking && moving ? spin(a.frames) : GLYPH.live, ROLE.accent]
            : call.state === 'fail'
              ? [GLYPH.fail, ROLE.error]
              : [GLYPH.ok, ROLE.success]
        const right = call.state === 'ok' && call.ms !== undefined ? took(call.ms) : call.state === 'fail' ? 'failed' : ''
        const room = inner - 2 - (right ? cellWidth(right) + 2 : 0)
        return (
          <Box key={`call-${call.id}`} flexDirection="row">
            <Text color={color}>{`${glyph} `}</Text>
            <Text wrap="truncate-end">{isTerm ? clip(call.label, room) : call.label}</Text>
            <Box flexGrow={1} />
            {right ? <Text color={call.state === 'fail' ? ROLE.error : undefined} dimColor={call.state !== 'fail'}>{`  ${right}`}</Text> : null}
          </Box>
        )
      })
      return earlier > 0 ? [dim(`${GLYPH.more} ${plural(earlier, 'earlier call')}`), ...rows] : rows
    }

    const contextRows = () => {
      type Row = { key: string; label: string; pct: number; num: string; numColor?: string; detail: string; detailColor?: string; title: string }
      const rows: Row[] = []
      if (ctxPct !== undefined && u) {
        const t = u.context.tokens
        const d = t !== undefined ? `${count(t)}/${count(u.context.window)}` : ''
        rows.push({ key: 'ctx', label: 'ctx', pct: ctxPct, num: `${wholePct(ctxPct)}%`, numColor: pctColor(ctxPct), detail: d, title: `context ${wholePct(ctxPct)}% used${d ? `, ${d} tokens` : ''}` })
      }
      for (const x of limits) {
        const d = span(x.left)
        rows.push({ key: `limit-${x.name}`, label: x.name, pct: x.pct, num: `${wholePct(x.pct)}%`, numColor: pctColor(x.pct), detail: d ? `${GLYPH.reset} ${d}` : '', title: `${x.name} limit ${wholePct(x.pct)}% used${d ? `, resets in ${d}` : ''}` })
      }
      if (c) {
        const ttl = c.ttlMs >= 3_600_000 ? '1h' : `${Math.round(c.ttlMs / 60_000)}m`
        rows.push({
          key: 'cache',
          label: 'cache',
          pct: isCacheWarm ? cachePct : 0,
          num: ttl,
          detail: cacheText,
          ...(isCacheWarm ? { detailColor: pctColor(cachePct) } : {}),
          title: isCacheWarm ? `prompt cache: ${countdown(cacheLeftMs)} left of ${ttl}` : `prompt cache expired: the next prompt writes it again`,
        })
      }
      if (rows.length === 0) return [dim(`${GLYPH.idle} no readings yet: they come with the first reply`)]
      const detailW = Math.max(...rows.map(x => cellWidth(x.detail)))
      const roomFor = (d: number) => inner - 6 - 2 - 4 - (d ? d + 3 : 0)
      const showDetail = roomFor(detailW) >= 6
      const cells = Math.max(4, Math.min(20, roomFor(showDetail ? detailW : 0)))
      return rows.map(x =>
        labelled(
          x.key,
          x.label,
          6,
          <Box flexDirection="row" alignItems="center">
            {bar(x.key, x.pct, cells, x.title)}
            <Text tabular={!isTerm} {...(x.numColor ? { color: x.numColor } : { dimColor: true })}>{`  ${padCells(x.num, 4, 'right')}`}</Text>
            {showDetail && x.detail ? <Text>{'   '}</Text> : null}
            {showDetail && x.detail ? detail(x.detail, x.detailColor) : null}
          </Box>,
        ),
      )
    }

    const turnRows = () => {
      const head = isWorking ? (
        <Text>
          <Text color={ROLE.accent}>{`${spinner} `}</Text>
          {`this turn  ${elapsed(Math.floor(runMs / 1000))}`}
        </Text>
      ) : l && lastMark ? (
        <Text>
          <Text color={lastMark.color}>{`${lastMark.glyph} `}</Text>
          {`last turn  ${lastText}`}
        </Text>
      ) : (
        dim(`${GLYPH.idle} no turn yet`)
      )
      if (!isWorking && !l) return [head]
      // Edits have their own row below; the kinds read the rest.
      const kinds = summarize(turnCalls.filter(x => !x.file).map(x => ({ tool: x.tool, isErrored: false })))
      const failed = turnCalls.filter(x => x.state === 'fail').length
      const files = [...new Set(turnCalls.flatMap(x => (x.file ? [x.file] : [])))]
      const n = isWorking ? a.tools : (l?.tools ?? 0)
      const value = (s: string, color?: string) => <Text tabular={!isTerm} {...(color ? { color } : {})}>{padCells(s, 6, 'right')}</Text>
      const rows = [
        head,
        labelled('tools', 'tools', 7, <Box flexDirection="row">{value(String(n))}{kinds.text ? <Text>{'   '}</Text> : null}{kinds.text ? detail(kinds.text) : null}</Box>),
        labelled('edits', 'edits', 7, <Box flexDirection="row">{value(String(files.length))}{files.length ? <Text>{'   '}</Text> : null}{files.length ? detail(files.map(base).join(', ')) : null}</Box>),
        labelled('errors', 'errors', 7, value(failed ? `${GLYPH.fail} ${failed}` : '0', failed ? ROLE.error : undefined)),
      ]
      const session = u?.cost?.usd
      if (!isWorking && l && l.costUsd !== null) {
        rows.push(labelled('cost', 'cost', 7, <Box flexDirection="row">{value(usd(l.costUsd))}{session !== undefined ? <Text>{'   '}</Text> : null}{session !== undefined ? detail(`session ${usd(session)}`) : null}</Box>))
      } else if (session !== undefined) {
        rows.push(labelled('cost', 'cost', 7, <Box flexDirection="row">{value(usd(session))}<Text>{'   '}</Text>{detail('session so far')}</Box>))
      }
      return rows
    }

    const gitRows = () => {
      if (!r) return [dim(`${GLYPH.idle} reading git status`)]
      if (!r.isRepo) return [dim(`${GLYPH.idle} not a git repository`)]
      const changes = r.added + r.modified + r.deleted
      return [
        labelled('branch', 'branch', 9, <Text wrap="truncate-end">{r.branch || '(no branch)'}</Text>),
        labelled(
          'changes',
          'changes',
          9,
          changes === 0 ? (
            <Text color={ROLE.success}>{`${GLYPH.ok} clean`}</Text>
          ) : (
            <Box flexDirection="row" gap={1}>
              {r.added ? <Text color={ROLE.success}>{`+${r.added}`}</Text> : null}
              {r.modified ? <Text color={ROLE.warning}>{`~${r.modified}`}</Text> : null}
              {r.deleted ? <Text color={ROLE.error}>{`-${r.deleted}`}</Text> : null}
            </Box>
          ),
        ),
      ]
    }

    const unfolded = () => {
      const tab = TABS.find(t => t.id === v.tab) ?? TABS[0]!
      const meta = isWorking ? `${elapsed(Math.floor(runMs / 1000))} ${GLYPH.dot} ${plural(a.tools, 'tool')}` : l ? lastText : 'idle'
      const label = 'pulse'
      const detailText = ` ${GLYPH.dot} ${isTerm ? tab.long : tab.title} `
      const ruleCells = inner - cellWidth(label + detailText) - cellWidth(meta) - 3
      const hasMeta = ruleCells >= 2
      const metaGlyph = isWorking ? (
        <Text color={ROLE.accent}>{`${spinner} `}</Text>
      ) : lastMark ? (
        <Text color={lastMark.color}>{`${lastMark.glyph} `}</Text>
      ) : (
        <Text dimColor>{`${GLYPH.idle} `}</Text>
      )
      const header = (
        <Box flexDirection="row">
          <Text bold color={ROLE.accent} {...(isTerm ? {} : { weight: 'semibold' as const })}>{label}</Text>
          <Text>{detailText}</Text>
          {isTerm ? <Text color={ROLE.chrome}>{GLYPH.track.repeat(Math.max(0, hasMeta ? ruleCells : inner - cellWidth(label + detailText)))}</Text> : <Box flexGrow={1} />}
          {hasMeta || !isTerm ? (
            <Text>
              <Text>{' '}</Text>
              {metaGlyph}
              <Text color={ROLE.chrome}>{meta}</Text>
            </Text>
          ) : null}
        </Box>
      )
      const longCells = TABS.reduce((n, t) => n + 2 + cellWidth(`${t.key}: ${t.long}`), 0)
      const tabLabel = (t: (typeof TABS)[number]) => (longCells + 3 <= inner ? t.long : t.short)
      const tabs = (
        <Box flexDirection="row" alignItems="center">
          <Box flexDirection="row" gap={isTerm ? 2 : 1}>
            {TABS.map(t => tabButton(t, tabLabel(t)))}
          </Box>
          <Box flexGrow={1} />
          {fold}
        </Box>
      )
      const body = tab.id === 'activity' ? activityRows() : tab.id === 'context' ? contextRows() : tab.id === 'turn' ? turnRows() : gitRows()
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={ROLE.chrome} paddingX={1} {...(isTerm ? { width } : {})}>
          {header}
          {tabs}
          <Box flexDirection="column" marginTop={1}>
            {body}
          </Box>
        </Box>
      )
    }

    const drawn = v.isOpen ? unfolded() : folded()
    // `glyphs: text` draws ASCII stand-ins and a classic border.
    const mine = isAsciiGlyphs(options.glyphs) ? asciiTree(drawn) : drawn
    return (
      <Box flexDirection="column">
        {mine}
        {below ?? null}
      </Box>
    )
  }).catch(($, e, next) => next(e))

}
