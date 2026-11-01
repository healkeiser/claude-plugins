// The band above the prompt: one row, folded by default, that reads the turn
// while Claude works and the session's gauges while it waits; unfolded, a card
// with four tabs. Drawn on the terminal and desktop, the two that raise it.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, PluginOptions, RenderChildren } from 'claude-code'

import type { Call, CheckKind, Checks, Plan, Repo, Tab, View } from '../types'
import { nextPlan, planProgress } from './plan'
import { readCi, runState } from './checks'
import { took } from './bash'
import { cacheLeft, cacheUsed, countdown, countWorktrees, fit, parseCommits, parseGitStatus, parseLastCommit, parseNumstat, statusLetters, svgMeter } from './glance'
import type { Piece } from './glance'
import { elapsed, summarize } from './label'
import { SPACE, bar as kitBar, cardFrame, progress, header as kitHeader, kit, pctColor as kitPct, tabs as kitTabs, tabsWidth } from './kit'
import {
  GLYPH, LIMIT_WINDOW_MS, ROLE, asciiTree, canRamp, cellWidth, clip, count, forecast, forecastLabel, isAsciiGlyphs, isFading, padCells,
  plural, span, spin, usd, wholePct,
} from './style'

const activity = atom({ plugin: 'pulse', key: 'activity' } as const, null)
const calls = atom({ plugin: 'pulse', key: 'calls' } as const, [])
const last = atom({ plugin: 'pulse', key: 'last' } as const, null)
const cache = atom({ plugin: 'pulse', key: 'cache' } as const, null)
// Tagged: a Repo stored before its fields grew reads as absent, then is read again.
const repo = atom({ plugin: 'pulse', key: 'repo' } as const, null as Repo | null, { shape: 'repo-3' })
const NO_REPO: Repo = {
  isRepo: false, branch: '', oid: '', upstream: '', ahead: 0, behind: 0, stash: 0, staged: 0, unstaged: 0, untracked: 0, conflicted: 0,
  add: 0, del: 0, files: [], last: null, op: '', startOid: '', commits: 0, session: [], worktrees: 1, fetchedAt: null,
}
const DEFAULT_VIEW: View = { isOpen: false, tab: 'activity' }
const view = atom({ plugin: 'pulse', key: 'view' } as const, DEFAULT_VIEW)
const second = atom({ plugin: 'pulse', key: 'second' } as const, 0)
const NO_CHECKS: Checks = { local: [], runs: [], pr: null, gh: 'unread', readAt: 0 }
const checks = atom({ plugin: 'pulse', key: 'checks' } as const, NO_CHECKS)
const plan = atom({ plugin: 'pulse', key: 'plan' } as const, null as Plan | null)
// While a CI run is going, GitHub is read again this often; never while none is.
const CI_POLL_MS = 60_000
// After a push or a `gh` command, GitHub is read this long after, so the new run is listed.
const CI_SOON_MS = 5_000
/** Where the open tab and the folded state are kept across sessions. */
const STORE_KEY = 'band'

const BAND = new Set(['terminal', 'desktop'])
const TABS: readonly { id: Tab; key: string; short: string; long: string; title: string }[] = [
  { id: 'activity', key: '1', short: 'Act', long: 'Activity', title: 'Activity' },
  { id: 'context', key: '2', short: 'Ctx', long: 'Context', title: 'Context & cache' },
  { id: 'turn', key: '3', short: 'Turn', long: 'Turn', title: 'Turn' },
  { id: 'git', key: '4', short: 'Git', long: 'Git', title: 'Git' },
  { id: 'checks', key: '5', short: 'Chk', long: 'Checks', title: 'Checks' },
]
// Calls that may change the session folder's files: git is read again a second after the last.
const REPO_TOOLS = new Set(['Bash', 'PowerShell', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
// Single-line bands put two spaces either side of `·` (DESIGN.md, Spacing).
const DOT = `  ${GLYPH.dot}  `
const ACTIVITY_ROWS = 6
// From this many cells inside the card, the Git tab lays its files in a column of their own.
const GIT_WIDE = 100

const isTab = (x: unknown): x is Tab => TABS.some(t => t.id === x)
const base = (path: string) => path.split(/[\\/]/).pop() || path
const limitName = (kind: string) =>
  kind.replace(/five[_ -]?hours?/i, '5h').replace(/seven[_ -]?days?/i, '7d').replace(/[_-]+/g, ' ').trim()

/** A rebase, merge, cherry-pick, revert or bisect under way, by the marker files git leaves: `rebasing 3/10`, `merging`. */
async function gitOp($: EngineInterface, dir: string): Promise<string> {
  // shortcut: a linked worktree keeps these under its own git dir, not `.git/`; read `git rev-parse --git-dir` if that matters.
  const git = `${dir}/.git`
  const has = (p: string) => $.fs.exists(`${git}/${p}`).catch(() => false)
  for (const d of ['rebase-merge', 'rebase-apply']) {
    if (await has(d)) {
      const n = await $.fs.read(`${git}/${d}/${d === 'rebase-merge' ? 'msgnum' : 'next'}`).catch(() => '')
      const of = await $.fs.read(`${git}/${d}/${d === 'rebase-merge' ? 'end' : 'last'}`).catch(() => '')
      return n.trim() && of.trim() ? `rebasing ${n.trim()}/${of.trim()}` : 'rebasing'
    }
  }
  if (await has('MERGE_HEAD')) return 'merging'
  if (await has('CHERRY_PICK_HEAD')) return 'cherry-picking'
  if (await has('REVERT_HEAD')) return 'reverting'
  if (await has('BISECT_LOG')) return 'bisecting'
  return ''
}

/** The session folder's git state, by argument vector, no shell, never on a draw; unchanged, no write. */
async function readRepo($: EngineInterface) {
  const dir = await $.session.cwd().catch(() => '')
  if (!dir) return
  const git = (...args: string[]) =>
    $.process.run(['git', '-C', dir, '--no-optional-locks', ...args], { cwd: dir, timeoutMs: 3000 }).catch(() => null)
  const st = await git('status', '--porcelain=v2', '--branch', '--show-stash')
  const before = await read($, repo)
  let found: Repo | null
  if (st === null || st.exitCode !== 0) found = null
  else {
    const s = parseGitStatus(st.stdout)
    // Lines and the last commit need a commit: a fresh repo has none.
    const [diff, log] = s.oid ? await Promise.all([git('diff', 'HEAD', '--numstat'), git('log', '-1', '--format=%h%x00%s%x00%ct')]) : [null, null]
    const n = parseNumstat(diff?.exitCode === 0 ? diff.stdout : '')
    const letters = statusLetters(st.stdout)
    const startOid = before?.isRepo && before.startOid ? before.startOid : s.oid
    const since = startOid && s.oid && startOid !== s.oid
    const [count, log50, trees, fetched] = await Promise.all([
      since ? git('rev-list', '--count', `${startOid}..${s.oid}`) : null,
      since ? git('log', '--reverse', '--max-count=50', '--format=%h%x00%s', `${startOid}..${s.oid}`) : null,
      git('worktree', 'list', '--porcelain'),
      // shortcut: a linked worktree's FETCH_HEAD is in the main repo's git dir; read `git rev-parse --git-common-dir` if that matters.
      $.fs.stat(`${dir}/.git/FETCH_HEAD`).catch(() => null),
    ])
    // Untracked files have no line counts; they follow the changed ones.
    const untracked = [...letters].filter(([, l]) => l === '?').map(([path]) => ({ path, add: null, del: null, status: '?' }))
    found = {
      isRepo: true,
      ...s,
      add: n.add,
      del: n.del,
      // The most changed first; a binary file counts one line.
      files: n.files
        .map(f => ({ ...f, status: letters.get(f.path) ?? 'M' }))
        .sort((a, b) => (b.add ?? 1) + (b.del ?? 1) - ((a.add ?? 1) + (a.del ?? 1)))
        .concat(untracked)
        .slice(0, 6),
      last: log?.exitCode === 0 ? parseLastCommit(log.stdout) : null,
      op: await gitOp($, dir),
      startOid,
      commits: count?.exitCode === 0 ? Number(count.stdout.trim()) || 0 : 0,
      session: log50?.exitCode === 0 ? parseCommits(log50.stdout) : [],
      worktrees: trees?.exitCode === 0 ? Math.max(1, countWorktrees(trees.stdout)) : 1,
      fetchedAt: fetched && fetched.mtimeMs > 0 ? fetched.mtimeMs : null,
    }
  }
  const value: Repo = found ?? { ...NO_REPO }
  if (JSON.stringify(before) !== JSON.stringify(value)) await update($, repo, () => value)
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
  void readRepo($)
    .then(() => readChecks($))
    .catch(() => {})
}

// ---------------------------------------------------------------- plan

/** After one of Claude's task tools ran in the main loop (register's `tool.call` hook): the plan it left. */
export async function notePlan($: EngineInterface, tool: string, input: Record<string, unknown>, result: unknown) {
  await update($, plan, p => {
    const next = nextPlan(p ?? { items: [] }, tool, input, result)
    return next.items.length ? next : null
  })
}

// ---------------------------------------------------------------- checks

/** A check Claude starts (register's `tool.call` hook): the last of its kind, running. Resolves to its start. */
export async function startCheck($: EngineInterface, kind: CheckKind, command: string): Promise<number> {
  const at = await $.clock.now()
  await update($, checks, c => ({ ...c, local: [...c.local.filter(x => x.kind !== kind), { kind, command, state: 'running' as const, at, ms: null }] }))
  return at
}

/** The check started at `at` ended: passed or failed, and how long it took. A newer one of its kind stays. */
export async function endCheck($: EngineInterface, kind: CheckKind, at: number, isOk: boolean) {
  const end = await $.clock.now()
  await update($, checks, c => ({
    ...c,
    local: c.local.map(x => (x.kind === kind && x.at === at ? { ...x, state: isOk ? ('ok' as const) : ('fail' as const), ms: end - at } : x)),
  }))
}

// A newer schedule supersedes an older one.
let ciTick = 0
/** GitHub is read again in `ms` (after a push, or while a run is going). */
export function checksSoon($: EngineInterface, ms = CI_SOON_MS) {
  const mine = (ciTick += 1)
  void $.clock
    .sleep(ms)
    .then(() => (mine === ciTick ? readChecks($) : undefined))
    .catch(() => undefined)
}

/**
 * What GitHub says about the branch: its CI runs and pull request, by `gh`, never on a draw. A run that
 * finished since the last read raises a toast; while one is going, it is read again in a minute.
 */
async function readChecks($: EngineInterface) {
  const r = await read($, repo)
  if (!r?.isRepo || !r.branch || r.branch.startsWith('(')) return
  const dir = await $.session.cwd().catch(() => '')
  if (!dir) return
  const ci = await readCi($, dir, r.branch)
  const before = await read($, checks)
  for (const run of ci.runs) {
    const was = before.runs.find(x => x.id === run.id)
    const now = runState(run)
    if (was && runState(was) === 'running' && now !== 'running') {
      $.ui.toast(`CI ${run.workflow} ${now === 'ok' ? `${GLYPH.ok} passed` : `${GLYPH.fail} ${run.conclusion || 'failed'}`} on ${r.branch}`)
    }
  }
  const at = await $.clock.now()
  await update($, checks, c => ({ ...c, runs: ci.runs, pr: ci.pr, gh: ci.problem, readAt: at }))
  if (ci.runs.some(x => runState(x) === 'running')) checksSoon($, CI_POLL_MS)
}

/** Whether the band is hidden: the last `/pulse band` (remembered across sessions), else the `band` option. */
const hiddenBy = (v: View, option: unknown) => (v.band ?? (option === 'off' ? 'off' : 'on')) === 'off'

async function setView($: EngineInterface, fn: (v: View) => View) {
  const v = await update($, view, x => fn({ ...DEFAULT_VIEW, ...x }))
  await $.store.set(STORE_KEY, { isOpen: v.isOpen, tab: v.tab, band: v.band }).catch(() => {})
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
      await update($, view, v => ({
        ...DEFAULT_VIEW,
        ...v,
        isOpen: saved.isOpen === true,
        tab: isTab(saved.tab) ? saved.tab : 'activity',
        ...(saved.band === 'on' || saved.band === 'off' ? { band: saved.band } : {}),
      }))
    }
    const [COLORTERM, TERM, WT_SESSION] = await Promise.all([
      $.env.get('COLORTERM').catch(() => undefined),
      $.env.get('TERM').catch(() => undefined),
      $.env.get('WT_SESSION').catch(() => undefined),
    ])
    ramp = canRamp({ COLORTERM: COLORTERM ?? undefined, TERM: TERM ?? undefined, WT_SESSION: WT_SESSION ?? undefined })
    void readRepo($)
      .then(() => readChecks($))
      .catch(() => {})
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'pulse' }, async ($, e) => {
    const [what, how = 'toggle'] = e.args.trim().split(/\s+/)
    if (what !== 'band' || !['on', 'off', 'toggle'].includes(how)) return { text: 'Usage: /pulse band on|off|toggle' }
    let v: View = DEFAULT_VIEW
    await setView($, now => {
      const band: 'on' | 'off' = how === 'toggle' ? (isHidden(now) ? 'on' : 'off') : (how as 'on' | 'off')
      return (v = { ...now, band })
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

    const [a, list, l, c, r, now, u, ck, pl] = await Promise.all([
      read($, activity),
      read($, calls),
      read($, last),
      read($, cache),
      read($, repo),
      $.clock.now(),
      $.session.usage().catch(() => null),
      // Read so the countdown's once-a-second write redraws the band.
      read($, second).then(() => read($, checks)),
      read($, plan),
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
      const resetsAt = Number.isFinite(at) ? at : null
      // When it fills at its pace so far, if before the reset (style.ts forecast, as the status line).
      const full = forecast(x.percentUsed, resetsAt, LIMIT_WINDOW_MS[x.kind], now)
      return { name: limitName(x.kind), pct: x.percentUsed, left: resetsAt === null ? null : resetsAt - now, full }
    })
    const cacheLeftMs = c ? cacheLeft(c, now) : null
    const cachePct = c ? cacheUsed(c, now) : 0
    const isCacheWarm = cacheLeftMs !== null && cacheLeftMs > 0
    const k = kit($.ui.resolve(e), e.surface, { ramp, ascii: isAsciiGlyphs(options.glyphs) })
    const pctColor = (pct: number) => kitPct(k, pct)

    // ---- pieces shared by both forms

    // A meter: the ramp per cell on the terminal, a gliding SVG gradient on desktop; the number beside it says it.
    const bar = (key: string, pct: number, cells: number, title: string) => {
      if (e.surface !== 'terminal') {
        const { Svg } = $.ui.resolve(e)
        const drawn = svgMeter(pct, cells, widths.get(key), !moving, title)
        widths.set(key, drawn.width)
        return <Svg source={drawn.source} alt={title} isInteractive />
      }
      return kitBar(k, pct, cells)
    }
    const spinner = isWorking && moving ? spin(a.frames) : GLYPH.live
    const runMs = a ? (a.startedAt ? now - a.startedAt : a.frames * 100) : 0
    const lastMark = l ? (l.isAborted ? { glyph: GLYPH.stop, color: ROLE.warning } : { glyph: GLYPH.ok, color: ROLE.success }) : null
    const lastText = l ? `${l.isAborted ? 'interrupted ' : ''}${elapsed(Math.round(l.durationMs / 1000))}` : ''
    const cacheText = isCacheWarm ? `${GLYPH.reset} ${countdown(cacheLeftMs)}` : `${GLYPH.idle} expired`

    const tabRow = (label: (t: (typeof TABS)[number]) => string) =>
      kitTabs(k, { items: TABS.map(t => ({ id: t.id, label: label(t) })), active: v.isOpen ? v.tab : null, onPick: id => void pressTab($, id as Tab) })
    const fold = isTerm ? (
      <Button key="fold" plain label={v.isOpen ? '▾' : '▴'} dimColor onPress={() => pressFold($)} />
    ) : (
      <Button key="fold" label={v.isOpen ? 'Collapse' : 'Expand'} onPress={() => pressFold($)} />
    )

    // ---- folded: one row, never wrapped; the least important pieces leave first

    const folded = () => {
      const tabCells = SPACE.keys + tabsWidth(TABS.map(t => ({ label: t.short })))
      const left: (Piece & { node: () => RenderChildren })[] = []
      if (isWorking && pp && !pp.isDone) {
        const piece = `${DOT}plan ${pp.done}/${pp.total}`
        left.push({ id: 'plan', cells: cellWidth(piece), drop: 4, node: () => <Text><Text dimColor>{`${DOT}plan `}</Text><Text color={ROLE.accent}>{`${pp.done}/${pp.total}`}</Text></Text> })
      }
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
          {kept.has('tabs') ? tabRow(t => (isTerm ? t.short : t.title)) : null}
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

    const pp = planProgress(pl)
    // Claude's plan as a progress meter, its count and the step under way: never a row of dots.
    const planRow = () => {
      if (!pp) return null
      const count = `${pp.done}/${pp.total}`
      const cells = Math.max(4, Math.min(16, Math.floor((inner - 9 - cellWidth(count) - 4) / 3)))
      return labelled(
        'plan',
        'plan',
        9,
        <Box flexDirection="row" flexGrow={1}>
          {progress(k, pp.done, pp.total, cells)}
          <Text color={pp.isDone ? ROLE.success : ROLE.accent}>{`  ${count}`}</Text>
          <Box flexGrow={1} flexShrink={1} marginLeft={2} overflow="hidden">
            {pp.isDone ? <Text color={ROLE.success}>{`${GLYPH.ok} done`}</Text> : <Text wrap="truncate-end">{pp.now}</Text>}
          </Box>
        </Box>,
      )
    }
    const activityRows = () => [...(pp ? [planRow(), <Box key="plan-gap" height={1} />] : []), ...callRows()]
    const callRows = () => {
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
      type Row = { key: string; label: string; pct: number; num: string; numColor?: string; detail: string; detailColor?: string; title: string; warn?: string }
      const rows: Row[] = []
      if (ctxPct !== undefined && u) {
        const t = u.context.tokens
        const d = t !== undefined ? `${count(t)}/${count(u.context.window)}` : ''
        rows.push({ key: 'ctx', label: 'ctx', pct: ctxPct, num: `${wholePct(ctxPct)}%`, numColor: pctColor(ctxPct), detail: d, title: `context ${wholePct(ctxPct)}% used${d ? `, ${d} tokens` : ''}` })
      }
      for (const x of limits) {
        const d = span(x.left)
        const warn = x.full === null ? undefined : forecastLabel(x.full, now)
        rows.push({
          key: `limit-${x.name}`, label: x.name, pct: x.pct, num: `${wholePct(x.pct)}%`, numColor: pctColor(x.pct), detail: d ? `${GLYPH.reset} ${d}` : '',
          title: `${x.name} limit ${wholePct(x.pct)}% used${d ? `, resets in ${d}` : ''}${warn ? `, ${warn} at this pace` : ''}`,
          ...(warn ? { warn } : {}),
        })
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
      const detailW = Math.max(...rows.map(x => cellWidth(x.detail) + (x.warn ? cellWidth(x.warn) + 3 : 0)))
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
            {showDetail && x.warn ? <Text color={ROLE.error}>{`   ${x.warn}`}</Text> : null}
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
      // The count reads the list the breakdown reads, so the two always agree.
      const n = turnCalls.length
      const value = (s: string, color?: string) => <Text tabular={!isTerm} {...(color ? { color } : {})}>{padCells(s, 6, 'right')}</Text>
      // After the label column, the value and the gap: one row, cut with `…`, never wrapped.
      const rest = (s: string) => (isTerm ? clip(s, inner - 7 - 6 - 3) : s)
      const fileList = files.map(base).join(', ')
      const rows = [
        head,
        labelled('tools', 'tools', 7, <Box flexDirection="row">{value(String(n))}{kinds.text ? <Text>{'   '}</Text> : null}{kinds.text ? detail(rest(kinds.text)) : null}</Box>),
        labelled('edits', 'edits', 7, <Box flexDirection="row">{value(String(files.length))}{files.length ? <Text>{'   '}</Text> : null}{files.length ? detail(rest(fileList)) : null}</Box>),
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

    // ---- checks: what Claude last ran to test, type-check, lint and build; then CI and the pull request
    const checksRows = () => {
      const col = 9
      const ago = (at: number) => `${span(Math.max(1000, now - at)) || 'now'} ago`
      const mark = (state: 'running' | 'ok' | 'fail') =>
        state === 'running'
          ? { glyph: isWorking && moving ? spin(a!.frames) : GLYPH.live, color: ROLE.accent }
          : state === 'ok'
            ? { glyph: GLYPH.ok, color: ROLE.success }
            : { glyph: GLYPH.fail, color: ROLE.error }
      const rows: RenderChildren[] = []
      const order: CheckKind[] = ['test', 'types', 'lint', 'build']
      const local = order.map(k => ck.local.find(x => x.kind === k)).filter(x => x !== undefined)
      if (local.length === 0) rows.push(dim(`${GLYPH.idle} no test, type check, lint or build run yet`))
      for (const x of local) {
        const m = mark(x.state)
        const right = x.state === 'running' ? 'running' : `${ago(x.at)}${x.ms !== null ? `  ${took(x.ms)}` : ''}`
        rows.push(
          labelled(
            `check-${x.kind}`,
            x.kind,
            col,
            <Box flexDirection="row" flexGrow={1}>
              <Text color={m.color}>{`${m.glyph} `}</Text>
              <Box flexGrow={1} flexShrink={1} overflow="hidden">
                <Text wrap="truncate-end">{x.command.split(/\r?\n/)[0]}</Text>
              </Box>
              <Box flexShrink={0} marginLeft={2}>
                <Text color={ROLE.chrome}>{right}</Text>
              </Box>
            </Box>,
          ),
        )
      }
      // GitHub: each workflow's newest run on the branch, then the pull request.
      const why = { missing: 'gh is not installed: install the GitHub CLI to see CI', auth: 'gh is not logged in: gh auth login to see CI', remote: 'no GitHub remote' } as const
      if (ck.gh === 'unread') rows.push(labelled('check-ci', 'ci', col, <Text color={ROLE.chrome}>reading GitHub</Text>))
      else if (ck.gh) rows.push(labelled('check-ci', 'ci', col, <Text color={ROLE.chrome} wrap="truncate-end">{why[ck.gh]}</Text>))
      else if (ck.runs.length === 0) rows.push(labelled('check-ci', 'ci', col, <Text color={ROLE.chrome}>no runs on this branch</Text>))
      else {
        rows.push(
          labelled(
            'check-ci',
            'ci',
            col,
            <Box flexDirection="row" columnGap={2} overflow="hidden">
              {ck.runs.slice(0, 4).map(run => {
                const m = mark(runState(run))
                // A run of an older commit than HEAD says which.
                const old = r?.oid && run.sha && !r.oid.startsWith(run.sha) ? ` ${run.sha}` : ''
                return (
                  <Text key={`ci-${run.workflow}`} wrap="truncate-end">
                    <Text color={m.color}>{`${m.glyph} `}</Text>
                    {run.workflow}
                    {old ? <Text color={ROLE.chrome}>{old}</Text> : null}
                  </Text>
                )
              })}
            </Box>,
          ),
        )
      }
      if (ck.pr) {
        const p = ck.pr
        const review = p.review === 'approved' ? { text: 'approved', color: ROLE.success } : p.review === 'changes_requested' ? { text: 'changes requested', color: ROLE.error } : p.review === 'review_required' ? { text: 'review required', color: ROLE.warning } : null
        const total = p.passed + p.failed + p.pending
        rows.push(
          labelled(
            'check-pr',
            'pr',
            col,
            <Box flexDirection="row" columnGap={1} overflow="hidden">
              <Text color={ROLE.accent}>{`#${p.number}`}</Text>
              <Text wrap="truncate-end">{p.title}</Text>
              {p.state !== 'open' ? <Text color={ROLE.chrome}>{p.state}</Text> : null}
              {review ? <Text color={review.color}>{review.text}</Text> : null}
              {total ? (
                <Text color={p.failed ? ROLE.error : p.pending ? ROLE.warning : ROLE.success}>
                  {p.failed ? `${p.failed} of ${total} checks failed` : p.pending ? `${p.passed}/${total} checks, ${p.pending} running` : `${total} checks passed`}
                </Text>
              ) : null}
            </Box>,
          ),
        )
      }
      return rows
    }

    const gitRows = () => {
      if (!r) return [dim(`${GLYPH.idle} reading git status`)]
      if (!r.isRepo) return [dim(`${GLYPH.idle} not a git repository`)]
      const col = 9
      // Wide, the files take a column of their own beside the state.
      const isWide = inner >= GIT_WIDE
      const leftW = isWide ? Math.floor(inner * 0.55) : inner
      const sep = (key: string) => <Text key={key} color={ROLE.chrome}>{GLYPH.dot}</Text>
      const ago = (at: number) => `${span(Math.max(1000, now - at)) || 'now'} ago`
      const left: RenderChildren[] = []
      // A rebase or merge under way, or conflicts: what needs the person, first and in warning.
      if (r.op || r.conflicted) {
        const what = [r.op, r.conflicted ? plural(r.conflicted, 'conflict') : ''].filter(Boolean).join(` ${GLYPH.dot} `)
        left.push(
          <Box key="git-alert" flexDirection="row">
            <Text color={r.conflicted ? ROLE.error : ROLE.warning} wrap="truncate-end">{`${GLYPH.warn} ${what}`}</Text>
          </Box>,
        )
      }
      // The branch, where it tracks and how far apart (⇡ to push, ⇣ to pull), as of the last fetch; stash; work trees.
      const sync = r.upstream
        ? [
            r.ahead ? <Text key="ahead" color={ROLE.success}>{`⇡${r.ahead}`}</Text> : null,
            r.behind ? <Text key="behind" color={ROLE.warning}>{`⇣${r.behind}`}</Text> : null,
            !r.ahead && !r.behind ? <Text key="even" color={ROLE.chrome}>in sync</Text> : null,
          ]
        : [<Text key="none" color={ROLE.chrome}>no upstream</Text>]
      const extras = [
        r.upstream ? (r.fetchedAt ? `fetched ${ago(r.fetchedAt)}` : 'never fetched') : '',
        r.stash ? `stash ${r.stash}` : '',
        r.worktrees > 1 ? plural(r.worktrees, 'worktree') : '',
      ].filter(Boolean)
      left.push(
        labelled(
          'git-branch',
          'branch',
          col,
          <Box flexDirection="row" columnGap={1} overflow="hidden">
            <Text wrap="truncate-end">{r.branch || '(no branch)'}</Text>
            {r.upstream ? <Text color={ROLE.chrome} wrap="truncate-end">{`→ ${r.upstream}`}</Text> : null}
            {sync}
            {extras.length ? sep('extras-sep') : null}
            {extras.length ? <Text color={ROLE.chrome} wrap="truncate-end">{extras.join(` ${GLYPH.dot} `)}</Text> : null}
          </Box>,
        ),
      )
      // Lines against HEAD, then the files by where they stand.
      const isClean = !r.staged && !r.unstaged && !r.untracked && !r.conflicted
      const counts = [
        r.staged ? `${r.staged} staged` : '',
        r.unstaged ? `${r.unstaged} unstaged` : '',
        r.untracked ? `${r.untracked} untracked` : '',
      ].filter(Boolean)
      left.push(
        labelled(
          'git-changes',
          'changes',
          col,
          isClean ? (
            <Text color={ROLE.success}>{`${GLYPH.ok} clean`}</Text>
          ) : (
            <Box flexDirection="row" columnGap={1} overflow="hidden">
              {r.add || r.del ? <Text color={ROLE.success}>{`+${count(r.add)}`}</Text> : null}
              {r.add || r.del ? <Text color={ROLE.error}>{`-${count(r.del)}`}</Text> : null}
              {(r.add || r.del) && counts.length ? sep('lines-sep') : null}
              <Text color={ROLE.chrome} wrap="truncate-end">{counts.join(` ${GLYPH.dot} `)}</Text>
            </Box>
          ),
        ),
      )
      // HEAD's commit and how long ago.
      if (r.last) {
        left.push(
          labelled(
            'git-last',
            'last',
            col,
            <Box flexDirection="row" columnGap={1} overflow="hidden">
              <Text color={ROLE.accent}>{r.last.hash}</Text>
              <Text wrap="truncate-end">{r.last.subject}</Text>
              <Text color={ROLE.chrome}>{ago(r.last.at)}</Text>
            </Box>,
          ),
        )
      }
      // The commits made since the session began, and whether work waits to be committed.
      if (r.commits) {
        left.push(
          labelled(
            'git-session',
            'session',
            col,
            <Box flexDirection="row" overflow="hidden">
              <Text color={ROLE.accent}>{plural(r.commits, 'commit')}</Text>
              <Text color={ROLE.chrome}>{' since it began'}</Text>
              {isClean ? null : <Text color={ROLE.warning} wrap="truncate-end">{', then uncommitted work'}</Text>}
            </Box>,
          ),
        )
      }
      // The most changed files: status, path cut from its start, lines.
      const color = (st: string) => (st === 'U' || st === 'D' ? ROLE.error : st === 'A' || st === '?' ? ROLE.success : ROLE.warning)
      const fileRow = (f: (typeof r.files)[number], lead: number) => (
        <Box key={`git-file-${f.path}`} flexDirection="row">
          <Box width={lead} flexShrink={0}>
            <Text color={color(f.status)}>{f.status}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1} overflow="hidden">
            <Text wrap="truncate-start">{f.path}</Text>
          </Box>
          <Box flexShrink={0} marginLeft={2}>
            <Text color={ROLE.chrome}>{f.add === null ? (f.status === '?' ? 'new' : 'bin') : `+${f.add} -${f.del}`}</Text>
          </Box>
        </Box>
      )
      if (!isWide) return [...left, ...r.files.slice(0, 3).map(f => fileRow(f, col))]
      // Two columns: the state left, as many files right as the state has rows (at least 3).
      const files = r.files.slice(0, Math.max(3, left.length))
      return [
        <Box key="git-columns" flexDirection="row" columnGap={3}>
          <Box flexDirection="column" width={leftW} flexShrink={0}>
            {left}
          </Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
            {files.length ? files.map(f => fileRow(f, 2)) : <Text color={ROLE.chrome}>no changed files</Text>}
          </Box>
        </Box>,
      ]
    }

    const unfolded = () => {
      const tab = TABS.find(t => t.id === v.tab) ?? TABS[0]!
      const meta = isWorking ? `${elapsed(Math.floor(runMs / 1000))} ${GLYPH.dot} ${plural(a.tools, 'tool')}` : l ? lastText : 'idle'
      const metaGlyph = isWorking ? (
        <Text color={ROLE.accent}>{`${spinner} `}</Text>
      ) : lastMark ? (
        <Text color={lastMark.color}>{`${lastMark.glyph} `}</Text>
      ) : (
        <Text color={ROLE.chrome}>{`${GLYPH.idle} `}</Text>
      )
      const status = (
        <Text>
          {metaGlyph}
          <Text color={ROLE.chrome}>{meta}</Text>
        </Text>
      )
      // The status goes before the tab's name when the row is short of room.
      const hasMeta = !isTerm || inner >= cellWidth(` Pulse  ${meta}`) + 4 + 3
      const header = kitHeader(k, { title: 'Pulse', ...(hasMeta ? { status } : {}), actions: [{ id: 'fold', label: isTerm ? '▾' : 'Collapse', onPress: () => pressFold($) }] })
      const longCells = tabsWidth(TABS.map(t => ({ label: t.long })))
      const tabs = tabRow(t => (!isTerm ? t.title : longCells <= inner ? t.long : t.short))
      const body =
        tab.id === 'activity' ? activityRows() : tab.id === 'context' ? contextRows() : tab.id === 'turn' ? turnRows() : tab.id === 'checks' ? checksRows() : gitRows()
      return (
        <Box {...cardFrame(ROLE.chrome, isTerm ? { width } : {})}>
          {header}
          <Box flexDirection="column" marginTop={SPACE.block}>{tabs}</Box>
          <Box flexDirection="column" marginTop={SPACE.block}>
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
