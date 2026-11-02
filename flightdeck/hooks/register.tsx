import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { AgentCard, Architect, Bucket, Check, Gate, InboxItem, Layout, LogLine, Loop, Main, Repo, Roster, Split, ToolStat, TrendPoint, Turn, Usage, View } from '../types'
import {
  DEFAULT_ARCHITECT,
  addCard,
  resumeCard,
  DEFAULT_GATE,
  DEFAULT_MAIN,
  DEFAULT_ROSTER,
  DEFAULT_TURN,
  DEFAULT_USAGE,
  DEFAULT_VIEW,
  EDIT_TOOLS,
  SCHEMA_VERSION,
  afterCall,
  applyStep,
  bucketOf,
  cellWidth,
  piecesThatFit,
  cardTitle,
  afterCompactRead,
  claimCompactRead,
  contextFill,
  faultKey,
  forgetCompactRead,
  titleLines,
  consultTimeline,
  describeInput,
  endConsult,
  fitLegend,
  heatOf,
  fileUri,
  folderOf,
  headFit,
  parseGitStatus,
  remoteUrl,
  segments,
  ruleLine,
  fmtClock,
  fmtDuration,
  fmtTimer,
  fmtUsd,
  plural,
  gateSummary,
  gauge,
  isAdvising,
  isLoopActive,
  kTokens,
  lanes,
  limitLabel,
  limitOf,
  fmtResetAt,
  fmtResetIn,
  listOf,
  logRows,
  marksIn,
  momentOf,
  normalize,
  normalizeCard,
  normalizeGate,
  normalizeLog,
  noteTool,
  PALETTES,
  SVG_COLORS,
  svgMeter,
  HEAT_FILL,
  parseConfig,
  prettyModel,
  promptLine,
  handbackOf,
  adviceLine,
  receiptOf,
  recordCheck,
  settleCheck,
  shorten,
  startConsult,
  stepSpeed,
  stepLoop,
  SPARK,
  SPARK_ASCII,
  addInbox,
  errorLine,
  inboxNewest,
  normalizeInbox,
  toolLabel,
  noteToolTime,
  normalizeTools,
  normalizeTrend,
  pushTrend,
  sparkLevels,
  splitLabel,
  splitOf,
  svgSpark,
  svgColor,
  jumpTo,
} from './core'
import type { Config, Panel } from './core'
import { APP, gBar, gChartRow, gLegend, gPane, gRow, gSection, gUsage, usageColor } from './app'
import { SPACE, cardFrame, header, kit, nerdFont, space } from './kit'
import { GLYPH, HEAT_RAMP, HEAT_UNLIT, LIMIT_WINDOW_MS, ROLE, ascii, glyphSet, glyphTree, canRamp, forecast, forecastLabel, heatHex, heatRuns, meterShare, motionOn, pace, paceLabel, percent, sentence, clockAt } from './style'

const PANE = 'flightdeck'
// Calls that may change the session folder's files: its git state is read again a second after the last.
const REPO_TOOLS = new Set(['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const TITLE = 'Flightdeck'


// ---------------------------------------------------------------- state

const meta = atom({ plugin: 'flightdeck', key: 'meta' } as const, { schemaVersion: SCHEMA_VERSION })
const main = atom({ plugin: 'flightdeck', key: 'main' } as const, DEFAULT_MAIN)
const usage = atom({ plugin: 'flightdeck', key: 'usage' } as const, DEFAULT_USAGE)
const architect = atom({ plugin: 'flightdeck', key: 'architect' } as const, DEFAULT_ARCHITECT)
const gate = atom({ plugin: 'flightdeck', key: 'gate' } as const, DEFAULT_GATE)
const agents = atom({ plugin: 'flightdeck', key: 'agents' } as const, [])
const loops = atom({ plugin: 'flightdeck', key: 'loops' } as const, [])
const log = atom({ plugin: 'flightdeck', key: 'log' } as const, [])
const turn = atom({ plugin: 'flightdeck', key: 'turn' } as const, DEFAULT_TURN)
const receipt = atom({ plugin: 'flightdeck', key: 'receipt' } as const, null)
const view = atom({ plugin: 'flightdeck', key: 'view' } as const, DEFAULT_VIEW)
const roster = atom({ plugin: 'flightdeck', key: 'roster' } as const, DEFAULT_ROSTER)
const repo = atom({ plugin: 'flightdeck', key: 'repo' } as const, null)
const trend = atom({ plugin: 'flightdeck', key: 'trend' } as const, [])
const split = atom({ plugin: 'flightdeck', key: 'split' } as const, null)
const inbox = atom({ plugin: 'flightdeck', key: 'inbox' } as const, [])
const tools = atom({ plugin: 'flightdeck', key: 'tools' } as const, [])

type ServerBlock = { type: string; id?: string; name?: string; tool_use_id?: string }

// Every read goes through these, so a value saved under an older shape still reads.
async function getMain($: EngineInterface): Promise<Main> {
  return normalize(DEFAULT_MAIN, await read($, main))
}
async function getUsage($: EngineInterface): Promise<Usage> {
  return normalize(DEFAULT_USAGE, await read($, usage))
}
async function getArchitect($: EngineInterface): Promise<Architect> {
  const a = normalize(DEFAULT_ARCHITECT, await read($, architect))
  return { ...a, consults: listOf(a.consults), ids: listOf(a.ids), seen: listOf(a.seen) }
}
async function getGate($: EngineInterface): Promise<Gate> {
  return normalizeGate(await read($, gate))
}
async function getCards($: EngineInterface): Promise<AgentCard[]> {
  return listOf<unknown>(await read($, agents)).map(normalizeCard)
}
async function getLoops($: EngineInterface): Promise<Loop[]> {
  return listOf<Loop>(await read($, loops))
}
async function getLog($: EngineInterface): Promise<LogLine[]> {
  return normalizeLog(await read($, log))
}
async function getTurn($: EngineInterface): Promise<Turn> {
  return normalize(DEFAULT_TURN, await read($, turn))
}
async function getView($: EngineInterface): Promise<View> {
  return normalize(DEFAULT_VIEW, await read($, view))
}
async function getTrend($: EngineInterface): Promise<TrendPoint[]> {
  return normalizeTrend(await read($, trend))
}
async function getTools($: EngineInterface): Promise<ToolStat[]> {
  return normalizeTools(await read($, tools))
}
async function getInbox($: EngineInterface): Promise<InboxItem[]> {
  return normalizeInbox(await read($, inbox))
}
async function getSplit($: EngineInterface): Promise<Split | null> {
  const sp = await read($, split)
  return sp && Array.isArray(sp.rows) && sp.window > 0 ? sp : null
}

/** An attention item for the inbox; one already there (by id) is not added twice. */
async function flag($: EngineInterface, item: Omit<InboxItem, 'at'>) {
  const at = await $.clock.now()
  await update($, inbox, list => addInbox(normalizeInbox(list), { ...item, at }))
}

async function getRoster($: EngineInterface): Promise<Roster> {
  const r = normalize(DEFAULT_ROSTER, await read($, roster))
  return { architectTypes: listOf(r.architectTypes) }
}

/** A stored shape older than this build's: drop what cannot be read, keep the rest. */
async function migrate($: EngineInterface) {
  const m = await read($, meta)
  if ((m?.schemaVersion ?? 0) >= SCHEMA_VERSION) return
  await update($, log, list => normalizeLog(list))
  await update($, agents, list => listOf<unknown>(list).map(normalizeCard))
  await update($, gate, g => normalizeGate(g))
  await update($, meta, () => ({ schemaVersion: SCHEMA_VERSION }))
}

async function say($: EngineInterface, who: string, text: string, kind: LogLine['kind'] = 'info', agentId: string | null = null) {
  const line: LogLine = { at: await $.clock.now(), who, text, kind, agentId }
  await update($, log, list => [...normalizeLog(list), line].slice(-60))
}

async function refreshStatus($: EngineInterface, cfg: Config) {
  if (!cfg.statusLine) return $.ui.status(undefined)
  const [u, a, g, cards] = await Promise.all([getUsage($), getArchitect($), getGate($), getCards($)])
  const running = cards.filter(c => c.status === 'running').length
  const s = gateSummary(g)
  const ctxFill = contextFill(u)
  const parts = [
    ctxFill.pct !== null ? `ctx ${percent(ctxFill.pct)}` : null,
    cards.length > 0 ? `agents ${running}/${cards.length}` : null,
    a.consults.length > 0 || a.ids.length > 0 ? `${cfg.architectLabel.toLowerCase()} ${isAdvising(a) ? 'advising' : a.consults.length}` : null,
    s.deny > 0 ? `denied ${s.deny}` : null,
  ]
  // Only fields with something to say; with none, no status entry at all.
  const shown = parts.filter(Boolean)
  const status = shown.join(' · ')
  $.ui.status(shown.length > 0 ? (cfg.ascii ? ascii(status) : status) : undefined)
}

async function whoIs($: EngineInterface, agentId: string | undefined) {
  if (!agentId) return 'main'
  const card = (await getCards($)).find(c => c.id === agentId)
  return card ? shorten(cardTitle(card), 14) : 'agent'
}

async function consultStarted($: EngineInterface, cfg: Config, id: string, via: string) {
  const t = await getTurn($)
  const moment = momentOf(t)
  const at = await $.clock.now()
  await update($, architect, a => startConsult(normalize(DEFAULT_ARCHITECT, a), { id, at, moment, via }))
  if (moment === 'before done') await update($, turn, x => ({ ...normalize(DEFAULT_TURN, x), isReviewing: true }))
  await say($, cfg.architectLabel.toLowerCase(), cfg.moments ? `${moment} · ${via}` : `consulted · ${via}`, 'consult')
  await refreshStatus($, cfg)
}

async function consultEnded($: EngineInterface, cfg: Config, advice: string | null, id?: string) {
  const at = await $.clock.now()
  const first = advice?.split('\n').find(l => l.trim()) ?? null
  const text = first ? shorten(first.replace(/^[#>*\s-]+/, ''), 160) : null
  await update($, architect, a => endConsult(normalize(DEFAULT_ARCHITECT, a), at, text, id))
  await update($, turn, t => ({ ...normalize(DEFAULT_TURN, t), isReviewing: false }))
  await say($, cfg.architectLabel.toLowerCase(), text ? `advice: ${shorten(text, 60)}` : 'advice returned', 'consult')
  await refreshStatus($, cfg)
}

async function noteAdvice($: EngineInterface, cfg: Config, advice: string) {
  await update($, architect, x => ({ ...normalize(DEFAULT_ARCHITECT, x), lastAdvice: advice }))
  await say($, cfg.architectLabel.toLowerCase(), `advice: ${shorten(advice, 60)}`, 'consult')
}

async function isArchitectType($: EngineInterface, cfg: Config, type: string) {
  return cfg.architect.test(type) || (await getRoster($)).architectTypes.includes(type)
}

async function openPane($: EngineInterface, cfg: Config) {
  // columns apply when docked beside the transcript, rows when seated inline above the prompt.
  return $.ui.open({ id: PANE, title: TITLE, columns: cfg.paneColumns, rows: 8, backgroundColor: 'transparent' })
}

async function resetAll($: EngineInterface) {
  await update($, main, m => ({ ...DEFAULT_MAIN, model: normalize(DEFAULT_MAIN, m).model, mode: normalize(DEFAULT_MAIN, m).mode }))
  await update($, architect, () => DEFAULT_ARCHITECT)
  await update($, gate, () => DEFAULT_GATE)
  await update($, agents, () => [])
  await update($, loops, () => [])
  await update($, log, () => [])
  await update($, turn, () => DEFAULT_TURN)
  await update($, receipt, () => null)
  await update($, view, () => DEFAULT_VIEW)
  await update($, trend, () => [])
  await update($, split, () => null)
  await update($, inbox, () => [])
  // The context gauge waits for the next measurement rather than showing the pre-clear fill.
  await update($, usage, x => ({ ...normalize(DEFAULT_USAGE, x), pct: null, tokens: null }))
}

/**
 * Stores the compaction window for the model window `window`. A `summary` breakdown estimates locally
 * and sends no request; until the host gives one, the gauge stays on the model's window (afterCompactRead).
 */
async function readCompactWindow($: EngineInterface, window: number) {
  const r = await $.session.usage({ breakdown: 'summary' }).catch(() => null)
  await update($, usage, x => afterCompactRead(normalize(DEFAULT_USAGE, x), window, r?.context.breakdown))
  await keepSplit($, r?.context.breakdown)
}

/** The context split from a breakdown; none (no session bound, a failed read) keeps the last one. */
async function keepSplit($: EngineInterface, b: Parameters<typeof splitOf>[0]) {
  const sp = splitOf(b, await $.clock.now())
  if (sp) await update($, split, () => sp)
}

/** The context split read afresh: a `summary` breakdown estimates locally and sends no request. */
async function readSplit($: EngineInterface) {
  const r = await $.session.usage({ breakdown: 'summary' }).catch(() => null)
  await keepSplit($, r?.context.breakdown)
}

/** The session's cost read fresh, not from the last measurement: the receipt subtracts two of these. */
async function costNow($: EngineInterface): Promise<number | null> {
  const u = await $.session.usage().catch(() => null)
  return u?.cost?.usd ?? null
}

async function noteMode($: EngineInterface, mode: string | undefined) {
  if (mode) await update($, main, m => (normalize(DEFAULT_MAIN, m).mode === mode ? normalize(DEFAULT_MAIN, m) : { ...normalize(DEFAULT_MAIN, m), mode }))
}

// ---------------------------------------------------------------- hooks

// The session folder's git state for the main block's label row, read as the statusline reads it: two
// read-only git calls by argument vector, no shell, never on a draw. Read at start, on a change of folder,
// a second after the last call that may change files, and at the end of each main turn.
async function readRepo($: EngineInterface) {
  const dir = await $.session.cwd().catch(() => '')
  if (!dir) return
  const git = (args: string[]) =>
    $.process.run(['git', '-C', dir, '--no-optional-locks', ...args], { cwd: dir, timeoutMs: 3000 }).catch(() => null)
  const st = await git(['status', '--porcelain=v2', '--branch'])
  const isRepo = st !== null && st.exitCode === 0
  const origin = isRepo ? await git(['remote', 'get-url', 'origin']) : null
  const found: Repo = {
    dir,
    isRepo,
    remote: origin && origin.exitCode === 0 ? remoteUrl(origin.stdout) : '',
    ...(st && isRepo ? parseGitStatus(st.stdout) : { branch: '', added: 0, modified: 0, deleted: 0 }),
  }
  // Unchanged, no write: a write redraws the pane.
  if (JSON.stringify(await read($, repo)) !== JSON.stringify(found)) await update($, repo, () => found)
}
// Claude Code's Reduce motion setting, read at session start and at each main turn.
let isStill = false
// Whether a Nerd Font draws here (kit's nerdFont), read at session start: `glyphs: auto` draws its icons.
let hasNerd = false
async function readMotion($: EngineInterface) {
  const rows = await Promise.resolve().then(() => $.config.list()).catch(() => [])
  isStill = !motionOn('while-active', rows)
}

// Whether this terminal draws the heat ramp (style.ts canRamp), read once; graphical surfaces always do.
let termRamp: boolean | undefined
async function readRamp($: EngineInterface): Promise<boolean> {
  if (termRamp === undefined) {
    const safe = (read: () => Promise<string | undefined>) => Promise.resolve().then(read).catch(() => undefined)
    const [COLORTERM, TERM, WT_SESSION] = await Promise.all([
      safe(() => $.env.get('COLORTERM')),
      safe(() => $.env.get('TERM')),
      safe(() => $.env.get('WT_SESSION')),
    ])
    termRamp = canRamp({ COLORTERM, TERM, WT_SESSION })
  }
  return termRamp
}

// A newer call within the second supersedes an older one.
let repoTick = 0
function readRepoSoon($: EngineInterface) {
  const mine = (repoTick += 1)
  void $.clock
    .sleep(1000)
    .then(() => (mine === repoTick ? readRepo($) : undefined))
    .catch(() => undefined)
}

export const register: Register = (on, options) => {
  const cfg = parseConfig(options)
  const C = PALETTES[cfg.palette]
  // Each graphical meter's lit widths as last drawn, so a change glides from there.
  const meterWidths = new Map<string, number[]>()
  // Each graphical sparkline's bar heights as last drawn, so a new turn glides from there.
  const sparkHeights = new Map<string, number[]>()
  // tool.check carries no loop id; the tool.call around it does, keyed by the call's id.
  const callLoop = new Map<string, string | null>()

  on('session.start', async ($, e, next) => {
    hasNerd = (await nerdFont($).catch(() => 'missing' as const)) === 'ok'
    await $.command.register({
      name: 'flightdeck',
      description: 'Flightdeck, the live agent dashboard: open, close, reset, or set the layout',
      argumentHint: '[open|close|reset|layout auto|compact|wide|mini]',
    })
    await migrate($)
    await readMotion($)
    // A host without usage (headless, an SDK host, a session not yet bound) just starts without it.
    const u = await $.session.usage().catch(() => null)
    // A resumed session has a fill to draw already: its compaction window is read now, not at its first
    // measurement. Any other start forgets the last reading (the setting may have changed) for that one to read.
    const resumedWindow = u && u.context.tokens !== undefined && u.context.window > 0 ? u.context.window : 0
    if (u) {
      await update($, usage, x => ({
        ...normalize(DEFAULT_USAGE, x),
        pct: u.context.percent ?? null,
        tokens: u.context.tokens ?? null,
        window: u.context.window,
        compactFor: resumedWindow,
        compactMisses: 0,
        costUsd: u.cost?.usd ?? null,
        limits: u.rateLimits.map(limitOf),
      }))
    }
    if (cfg.openOnStart) void openPane($, cfg).catch(() => undefined)
    await refreshStatus($, cfg)
    const done = await next(e)
    await readRepo($)
    if (resumedWindow > 0) {
      await readCompactWindow($, resumedWindow)
      await refreshStatus($, cfg)
    }
    return done
  })

  on('classic.CwdChanged', async ($, e, next) => {
    const done = await next(e)
    await readRepo($)
    return done
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await resetAll($)
      await refreshStatus($, cfg)
    }
    return next(e)
  })

  on('command.run', { command: 'flightdeck' }, async ($, e) => {
    const [verb = 'open', arg = ''] = e.args.trim().split(/\s+/)
    if (verb === 'close') {
      await $.ui.close({ id: PANE })
      return { text: 'Flightdeck closed.' }
    }
    if (verb === 'reset') {
      await resetAll($)
      await refreshStatus($, cfg)
      return { text: 'Flightdeck reset.' }
    }
    if (verb === 'layout') {
      const layout: Layout | null = arg === 'compact' || arg === 'wide' || arg === 'auto' || arg === 'mini' ? arg : null
      if (!layout) return { text: 'Usage: /flightdeck layout auto|compact|wide|mini' }
      await update($, view, v => ({ ...normalize(DEFAULT_VIEW, v), layout }))
      const opened = await openPane($, cfg)
      return { text: opened.isPlaced ? `Flightdeck layout: ${layout}.` : `Layout set to ${layout}; the pane is not shown yet: ${opened.reason}` }
    }
    const opened = await openPane($, cfg)
    if (!opened.isPlaced) return { text: `Flightdeck is not shown yet: ${opened.reason}` }
    return { text: 'Flightdeck opened. Focus it with ctrl+x tab; 1-6 expand cards, f/s/o open the gate rows, c clears the inbox.' }
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    await noteMode($, e.permission_mode)
    return next(e)
  })

  on('agent.offer', async ($, e, next) => {
    const offered = await next(e)
    if (cfg.architect.test(e.agent) || (cfg.matchDescriptions && cfg.architect.test(e.description))) {
      await update($, roster, r => {
        const x = normalize(DEFAULT_ROSTER, r)
        return x.architectTypes.includes(e.agent) ? x : { architectTypes: [...listOf<string>(x.architectTypes), e.agent].slice(-20) }
      })
    }
    return offered
  })

  on('turn.start', async ($, e, next) => {
    // A subagent's turn (its spawn, or a resume by SendMessage) is its card's, not the main turn's.
    if (e.agentId !== undefined) return next(e)
    await readMotion($)
    const [now, cost] = await Promise.all([$.clock.now(), costNow($)])
    await update($, turn, () => ({ ...DEFAULT_TURN, startedAt: now, costAtStart: cost }))
    await update($, main, m => ({ ...normalize(DEFAULT_MAIN, m), isRunning: true }))
    // A background architect's report reaches the main loop as the text opening this turn. The
    // SubagentHandback tool call (in tool.call) normally carries it first; this is the fallback.
    const back = e.text ? handbackOf(e.text) : null
    const a = back ? await getArchitect($) : null
    if (back && a && a.ids.includes(back.from)) {
      const advice = adviceLine(back.body)
      if (advice && advice !== a.lastAdvice) await noteAdvice($, cfg, advice)
    } else if (e.text) {
      const p = promptLine(e.text)
      await say($, p.who, p.text)
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    // The main loop's model is known when its request starts; a long first request shouldn't read "—".
    if (!e.agentId) {
      let isNewModel = false
      await update($, main, m => {
        const x = normalize(DEFAULT_MAIN, m)
        isNewModel = x.model !== '' && x.model !== e.model
        return { ...x, model: e.model, effort: String(e.effort ?? x.effort), steps: x.steps + 1 }
      })
      if (isNewModel) await update($, usage, x => forgetCompactRead(normalize(DEFAULT_USAGE, x)))
      // Time the response as it passes: its first piece that is neither the engine's envelope nor the
      // stop. One clock read in the stream and nothing stored until it has ended.
      const sentAt = await $.clock.now()
      let firstAt: number | null = null
      const s = next(e)
      for await (const c of s) {
        if (firstAt === null && c.kind !== 'engine' && c.kind !== 'stop') firstAt = await $.clock.now()
        yield c
      }
      const result = await s.result
      const speed = result.usage ? stepSpeed(sentAt, firstAt) : null
      if (speed) await update($, main, m => ({ ...normalize(DEFAULT_MAIN, m), speed }))
      return result
    }
    const id = e.agentId
    // A step from an agent whose card finished means it was resumed (SendMessage): it runs again.
    const before = (await getCards($)).find(c => c.id === id)
    if (before && before.status !== 'running') {
      // Flipped in the write: a resume its agent.spawn already logged is not logged again.
      let isResumed = false
      await update($, agents, list =>
        listOf<unknown>(list)
          .map(normalizeCard)
          .map(c => {
            if (c.id !== id || c.status === 'running') return c
            isResumed = true
            return resumeCard(c)
          }),
      )
      if (isResumed) {
        await say($, await whoIs($, id), 'resumed', 'info', id)
        await refreshStatus($, cfg)
      }
    }
    const result = yield* next(e)
    const [cards, a] = await Promise.all([getCards($), getArchitect($)])
    if (cards.some(c => c.id === id)) {
      const step = { model: e.model, usage: result.usage, stopReason: result.stopReason }
      await update($, agents, list => listOf<unknown>(list).map(normalizeCard).map(c => (c.id === id ? applyStep(c, step) : c)))
      if (result.stopReason === 'max_tokens') await say($, await whoIs($, id), 'hit max_tokens', 'error', id)
    } else if (!a.ids.includes(id)) {
      const now = await $.clock.now()
      await update($, loops, l => stepLoop(listOf<Loop>(l), id, now))
    }
    return result
  })

  on('session.measure', async ($, e, next) => {
    // The compaction window is read once per model window, not on every measurement (a breakdown
    // estimates every category each time): claimed here, in the same write, so no two reads overlap.
    let isStale = false
    await update($, usage, x => {
      const claim = claimCompactRead(normalize(DEFAULT_USAGE, x), e.context.window)
      isStale = claim.isClaimed
      return {
        ...claim.usage,
        pct: e.context.percent ?? null,
        tokens: e.context.tokens ?? null,
        window: e.context.window,
        costUsd: e.cost?.usd ?? null,
        limits: e.rateLimits.map(limitOf),
      }
    })
    if (e.changed.includes('context')) await refreshStatus($, cfg)
    const done = await next(e)
    if (isStale) {
      await readCompactWindow($, e.context.window)
      await refreshStatus($, cfg)
    }
    // The measurement after a main turn: that turn's trend point takes the fill it left.
    if (e.changed.includes('context') && !(await getMain($)).isRunning) {
      const pct = contextFill(await getUsage($)).pct
      const last = (await getTrend($)).slice(-1)[0]
      if (last && pct !== null && last.ctx !== pct) {
        await update($, trend, l => normalizeTrend(l).map((p, i, all) => (i === all.length - 1 ? { ...p, ctx: pct } : p)))
      }
    }
    return done
  })

  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId && e.trigger !== 'precompute') {
      const now = await $.clock.now()
      await update($, usage, x => {
        const u = normalize(DEFAULT_USAGE, x)
        return { ...u, compactions: u.compactions + 1, lastCompactAt: now }
      })
      await say($, 'main', `context compacted (${e.trigger})`)
      await readSplit($)
    }
    return done
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (e.tool_use_id) {
      const check: Check = {
        id: e.tool_use_id,
        tool: e.tool,
        bucket: bucketOf(e.tool),
        verdict: verdict.decision === 'allow' ? 'rule' : verdict.decision,
        inSubagent: Boolean(callLoop.get(e.tool_use_id)),
        detail: shorten(describeInput(e.tool, e.input), 90),
        at: await $.clock.now(),
      }
      await update($, gate, g => recordCheck(normalizeGate(g), check))
      // The status line updates when the call settles; only a refusal ends here.
      if (verdict.decision === 'deny') {
        await say($, 'gate', `denied by rule · ${check.detail}`, 'error')
        await flag($, { id: e.tool_use_id, source: 'denied', text: `denied by rule · ${check.detail}`, target: check.inSubagent ? null : e.tool_use_id })
        await refreshStatus($, cfg)
      }
    }
    return verdict
  })

  on('tool.call', async ($, e, next) => {
    callLoop.set(e.tool_use_id, e.agentId ?? null)
    const startedAt = await $.clock.now()
    const ran = await next(e).finally(() => callLoop.delete(e.tool_use_id))
    const tookMs = (await $.clock.now()) - startedAt
    if (REPO_TOOLS.has(String(e.tool))) readRepoSoon($)
    const didRun = ran.deny === undefined
    // Settle this call's pending ask, if it had one; skip the write (and the redraw) otherwise.
    const g0 = await getGate($)
    const isSettled = settleCheck(g0, e.tool_use_id, didRun) !== g0
    if (isSettled) await update($, gate, g => settleCheck(normalizeGate(g), e.tool_use_id, didRun))
    // A background agent hands its report back through this tool; an architect's report is its advice.
    if (String(e.tool) === 'SubagentHandback') {
      const message = (e as unknown as { message?: unknown }).message
      const a = e.agentId ? await getArchitect($) : null
      if (a && e.agentId && a.ids.includes(e.agentId) && typeof message === 'string') {
        const advice = adviceLine(message)
        if (advice && advice !== a.lastAdvice) await noteAdvice($, cfg, advice)
      }
      return ran
    }
    if (e.tool === 'Agent') {
      if (isSettled) await refreshStatus($, cfg)
      return ran
    }
    const hasFailed = didRun && ran.isError === true
    // Timed unless the person answered a permission prompt for it: that wait is theirs, not the tool's.
    // In auto mode the classifier answers, quickly, so those calls are timed.
    const wasAsked = isSettled && (await getMain($)).mode !== 'auto'
    if (didRun && !wasAsked) await update($, tools, l => noteToolTime(normalizeTools(l), String(e.tool), tookMs, hasFailed))
    const isEdit = !hasFailed && didRun && EDIT_TOOLS.has(e.tool)
    const t0 = await getTurn($)
    if (isEdit || hasFailed || (!e.agentId && t0.errorStreak > 0)) {
      await update($, turn, t => afterCall(normalize(DEFAULT_TURN, t), { inSubagent: Boolean(e.agentId), hasFailed, isEdit }))
    }
    const text = shorten(describeInput(e.tool, e), 64)
    if (e.agentId) {
      const id = e.agentId
      await update($, agents, list =>
        listOf<unknown>(list)
          .map(normalizeCard)
          .map(c => (c.id === id ? noteTool(c, { tool: e.tool, text, isError: hasFailed || ran.deny !== undefined }) : c)),
      )
    }
    // The log keeps what is worth a glance: refusals, errors and edits; the rest is on the cards.
    if (ran.deny !== undefined) await say($, await whoIs($, e.agentId), `${text}  denied`, 'error', e.agentId ?? null)
    else if (hasFailed) await say($, await whoIs($, e.agentId), `${text}  ${GLYPH.fail}`, 'error', e.agentId ?? null)
    // The inbox keeps refusals and failures with their reason; a subagent's call has no row of its own in the transcript.
    if (ran.deny !== undefined || hasFailed) {
      const who = e.agentId ? `${await whoIs($, e.agentId)} · ` : ''
      const why = errorLine(ran.deny ?? ran.text, 80)
      await flag($, {
        id: e.tool_use_id,
        source: hasFailed ? 'tool' : 'denied',
        text: `${who}${text}${why ? ` · ${why}` : ''}`,
        target: e.agentId ? null : e.tool_use_id,
      })
    }
    else if (isEdit) await say($, await whoIs($, e.agentId), text, 'info', e.agentId ?? null)
    if (isSettled || !didRun) await refreshStatus($, cfg)
    return ran
  })

  // A server-side review tool never reaches tool.call: it shows only in the assistant's rows.
  on('session.append', async ($, e, next) => {
    if (!e.agentId && e.message.type === 'assistant') {
      const a = await getArchitect($)
      // Consults this row opened: their result may be in the same row, after the stale read above.
      const opened = new Set<string>()
      for (const block of e.message.content as unknown as readonly ServerBlock[]) {
        if (block.type === 'server_tool_use' && block.name && block.id && cfg.architect.test(block.name)) {
          if (a.seen.includes(block.id)) continue
          const id = block.id
          await update($, architect, x => {
            const y = normalize(DEFAULT_ARCHITECT, x)
            return { ...y, seen: [...listOf<string>(y.seen), id].slice(-60) }
          })
          opened.add(id)
          await consultStarted($, cfg, id, `${block.name} tool`)
        } else if (block.type.endsWith('_tool_result') && block.tool_use_id) {
          const id = block.tool_use_id
          const isOpen = opened.has(id) || (await getArchitect($)).consults.some(c => c.id === id && c.endAt === null)
          if (isOpen) await consultEnded($, cfg, null, id)
        }
      }
    }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (!e.parentAgentId) await noteMode($, e.permissionMode)
    if (started.deny !== undefined || !started.agentId) return started
    const id = started.agentId
    if (await isArchitectType($, cfg, e.subagentType)) {
      await update($, architect, a => {
        const x = normalize(DEFAULT_ARCHITECT, a)
        return { ...x, ids: [...listOf<string>(x.ids), id].slice(-40) }
      })
      await update($, loops, l => listOf<Loop>(l).filter(x => x.id !== id))
      await consultStarted($, cfg, id, e.subagentType.split(':').pop() ?? 'agent')
      return started
    }
    const card: AgentCard = {
      ...normalizeCard({}),
      id,
      type: e.name ?? e.subagentType,
      model: started.model,
      description: e.description,
      spawnedAt: await $.clock.now(),
    }
    // Decided in the write: a resume whose first step already put its card back to running is not logged again.
    let isNew = true
    let isResumed = false
    await update($, agents, list => {
      const cards = listOf<unknown>(list).map(normalizeCard)
      const known = cards.find(c => c.id === id)
      isNew = known === undefined
      isResumed = known !== undefined && known.status !== 'running'
      return addCard(cards, card)
    })
    await update($, loops, l => listOf<Loop>(l).filter(x => x.id !== id))
    if (isNew || isResumed) await say($, shorten(cardTitle(card), 12), isNew ? `spawned · ${card.type}` : 'resumed', 'info', id)
    await refreshStatus($, cfg)
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const id = e.agentId
    const now = await $.clock.now()
    if (!id) {
      const [t, cards, cost] = await Promise.all([getTurn($), getCards($), costNow($)])
      const r = receiptOf(t, {
        durationMs: e.durationMs,
        agentsSince: cards.filter(c => c.spawnedAt >= t.startedAt).length,
        costNow: cost,
        reason: e.reason,
      })
      await update($, receipt, () => r)
      const u = await getUsage($)
      await update($, trend, l =>
        pushTrend(normalizeTrend(l), {
          at: now,
          ctx: contextFill(u).pct,
          cost: cost !== null && t.costAtStart !== null ? Math.max(0, cost - t.costAtStart) : null,
          ms: e.durationMs,
          out: e.usage?.output_tokens ?? null,
        }),
      )
      // A turn that did not answer: interrupted, refused, or ended by an API error StopFailure did not already name.
      if (e.reason === 'aborted') await flag($, { id: `turn:${e.turnId}`, source: 'turn', text: 'turn interrupted', target: null })
      else if (e.reason === 'refusal') {
        const why = errorLine(e.refusal.explanation ?? '')
        await flag($, { id: `turn:${e.turnId}`, source: 'turn', text: `refused${why ? ` · ${why}` : ''}`, target: null })
      } else if (e.reason === 'error' && !(await getInbox($)).some(x => x.source === 'api' && x.at >= t.startedAt)) {
        await flag($, { id: `turn:${e.turnId}`, source: 'api', text: 'an API error ended the turn', target: null })
      }
      await update($, main, m => ({ ...normalize(DEFAULT_MAIN, m), isRunning: false }))
      // What fills the window, once per main turn rather than at every measurement (a breakdown estimates every category).
      await readSplit($)
      await readRepo($)
      await refreshStatus($, cfg)
      return done
    }
    if ((await getArchitect($)).ids.includes(id)) {
      await consultEnded($, cfg, e.answer, id)
      return done
    }
    const cards = await getCards($)
    if (cards.some(c => c.id === id)) {
      const status = e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'stopped' : 'failed'
      await update($, agents, list =>
        listOf<unknown>(list)
          .map(normalizeCard)
          .map(c => (c.id === id ? { ...c, status, endedAt: now, answer: shorten(e.answer, 400) } : c)),
      )
      // This run's own length: a resumed agent's card clock also spans the idle time between runs.
      const took = fmtDuration(e.durationMs)
      await say($, await whoIs($, id), status === 'done' ? `done · ${took}` : status, status === 'done' ? 'done' : 'error', id)
    } else {
      await update($, loops, l => listOf<Loop>(l).map(x => (x.id === id ? { ...x, isDone: true, lastAt: now } : x)))
    }
    await refreshStatus($, cfg)
    return done
  })

  // ---------------------------------------------------------------- drawing

  // After a surface module faults on a surface, this load draws it there as plain text; the other
  // module, and other surfaces, keep theirs. Keyed by faultKey: `desktop:rail.tsx`.
  const faulted = new Set<string>()
  on('classic.StopFailure', async ($, e, next) => {
    const done = await next(e)
    const now = await $.clock.now()
    const details = errorLine(e.error_details)
    await flag($, { id: `api:${now}`, source: 'api', text: `${e.error.replace(/_/g, ' ')}${details ? ` · ${details}` : ''}`, target: null })
    return done
  })

  on('ui.fault', async ($, e, next) => {
    await flag($, { id: `mod:${e.surface}:${e.element}:${e.phase}`, source: 'mod', text: `${e.module} faulted on ${e.surface} (${e.phase}) · ${errorLine(e.reason, 80)}`, target: null })
    const key = faultKey(e.surface, e.module)
    if (e.requestId === PANE && !faulted.has(key)) {
      faulted.add(key)
      $.ui.log(`flightdeck: ${e.module} faulted on ${e.surface} (${e.phase}: ${e.reason}); drawing it without animation`)
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const hasClient = 'Client' in els
    const hasRail = hasClient && !faulted.has(faultKey(e.surface, 'rail.tsx'))
    const hasClock = hasClient && !faulted.has(faultKey(e.surface, 'elapsed.tsx'))
    const [m, u, a, g, cards, lp, lines, t, r, v, rp, tr, sp, ib, now] = await Promise.all([
      getMain($),
      getUsage($),
      getArchitect($),
      getGate($),
      getCards($),
      getLoops($),
      getLog($),
      getTurn($),
      read($, receipt),
      getView($),
      read($, repo),
      getTrend($),
      getSplit($),
      getInbox($),
      $.clock.now(),
    ])
    const ts = await getTools($)
    const isRamp = e.surface !== 'terminal' || (await readRamp($))
    const k = kit(els, e.surface, { ramp: isRamp, ascii: cfg.ascii })
    // The body's own width, down to the narrowest dock Claude Code seats (24): a wider drawing is cut off at the frame.
    const W = Math.max(24, e.props.bodyColumns)
    const layout = v.layout ?? cfg.layout
    const isWide = layout === 'wide' || (layout === 'auto' && W >= 110)
    const colW = isWide ? Math.floor((W - 2) / 2) : W
    const modelName = prettyModel(m.model)
    const viewed = e.props.view?.agentId ?? null
    const advising = isAdvising(a)
    const running = cards.filter(c => c.status === 'running')
    const showArchitect = a.consults.length > 0 || a.ids.length > 0
    const motion = cfg.motion && !isStill && hasRail
    // A panel with nothing to show yet takes no room: most sessions never spawn an agent.
    const isEmpty: Record<Panel, boolean> = {
      main: false,
      architect: !showArchitect,
      gate: g.recent.length === 0 && gateSummary(g).total === 0,
      agents: cards.length === 0,
      loops: lp.length === 0,
      receipt: !m.isRunning && !r,
      inbox: ib.length === 0,
      tools: ts.length === 0,
      trends: tr.length === 0,
      log: false,
    }
    const panels = cfg.panels.filter(p => !isEmpty[p])
    const decider = m.mode === 'auto' ? 'classifier' : 'you'

    // A connector between blocks: animated while its flow is live, a dim line otherwise.
    // `track`: the line's colour at rest, a block's border colour when the rail is drawn on its edge.
    const rail = (key: string, active: boolean, color: string, width: number, marks: number[] = [], isMerge = false, track: string = C.faint) =>
      motion ? (
        <els.Client
          key={key}
          module="./rail.tsx"
          width={width}
          height={1}
          props={{ active, width, color, dim: track, marks, isMerge, ascii: cfg.ascii }}
        />
      ) : (
        <Text color={track} mono>
          {ruleLine(width, marks, isMerge ? '┴' : '┬')}
        </Text>
      )

    // A start time of 0 is unknown (state saved before it was recorded): no clock, not decades.
    const clock = (key: string, since: number, endAt: number | null, color: string) =>
      since <= 0 ? (
        <Text color={color}>—</Text>
      ) : hasClock ? (
        <els.Client key={key} module="./elapsed.tsx" props={{ since, now, endAt, color }} />
      ) : (
        <Text color={color}>{fmtTimer((endAt ?? now) - since)}</Text>
      )

    const isTerminal = e.surface === 'terminal'
    // A row of marks (gate checks, loop dots), sized by `marksIn`. Should a surface draw them wider
    // still, the row is cut at its box rather than running past it.
    const markRow = (marks: RenderChildren, lead = 0) => (
      <Box overflow="hidden" {...(lead ? { marginLeft: lead } : {})}>
        <Text wrap="truncate-start">{marks}</Text>
      </Box>
    )
    // A terminal's border row stands apart from the text above it; a graphical surface draws the
    // border flush against it, so the legend keeps one row of air there.
    const legendGap = isTerminal ? 0 : 1

    // A line of coloured pieces, drawn as a row of boxes the way the log draws its lines. A Text nesting
    // coloured Texts truncates as one line in a terminal, but the desktop app wraps each nested piece on its
    // own, lays truncating ones out as blocks of their own, and collapses runs of spaces. So pieces sit `gap`
    // cells apart (a piece's `lead` adds more), each keeps its width, and pieces that don't fit in `room` are
    // left out from the end; or a piece marked `fill` (one span) truncates to what the others leave.
    type Span = { text: string; color?: string; dim?: boolean; bold?: boolean; href?: string }
    type Piece = { spans: Span[]; lead?: number; fill?: boolean }
    const styleOf = (s: Span) => ({ ...(s.color ? { color: s.color } : {}), ...(s.dim ? { dimColor: true } : {}), ...(s.bold ? { weight: 'bold' as const } : {}) })
    const widthOf = (p: Piece) => p.spans.reduce((n, s) => n + cellWidth(s.text), 0)
    // A span is a Text, its text a link where it has an `href`.
    const spanNode = (x: Span) => <Text {...styleOf(x)}>{x.href ? <els.Link href={x.href}>{x.text}</els.Link> : x.text}</Text>
    const spanText = (spans: Span[]) => (spans.length === 1 && spans[0] ? spanNode(spans[0]) : <Text>{spans.map(spanNode)}</Text>)
    const line = (pieces: (Piece | null)[], room: number, gap = 1, justify?: 'center') => {
      const all = pieces.filter((p): p is Piece => p !== null)
      const shown = all.some(p => p.fill) ? all : all.slice(0, piecesThatFit(all.map(p => ({ width: widthOf(p), lead: p.lead })), room, gap))
      return (
        <Box width={room} columnGap={gap} overflow="hidden" {...(justify ? { justifyContent: justify } : {})}>
          {shown.map(p => {
            const lead = p.lead ? { marginLeft: p.lead } : {}
            if (p.fill && p.spans[0]) {
              return (
                <Text {...styleOf(p.spans[0])} wrap="truncate">
                  {p.spans[0].text}
                </Text>
              )
            }
            return (
              <Box flexShrink={0} {...lead}>
                {spanText(p.spans)}
              </Box>
            )
          })}
        </Box>
      )
    }

    // A full rounded block, as postcard draws a card: the border in the block's colour, and its first row
    // the bold label with the status on the right. The label keeps what the status leaves.
    type Right = { node: RenderChildren; width: number }
    const right = (spans: Span[]): Right => ({ node: spanText(spans), width: spans.reduce((n, x) => n + cellWidth(x.text), 0) })
    const head = (w: number, title: string, color: string, r: Right | null = null, o: { dim?: boolean } = {}) => {
      // Card titles in sentence case, as every title (style.ts sentence).
      const label = sentence(title)
      const fit = headFit(w, cellWidth(label), r?.width ?? 0)
      return (
        <Box width={w} justifyContent="space-between" columnGap={1} overflow="hidden">
          <Text color={color} weight="bold" wrap="truncate" {...(o.dim ? { dimColor: true } : {})}>
            {shorten(label, fit.label)}
          </Text>
          {r && fit.showRight ? <Box flexShrink={0}>{r.node}</Box> : null}
        </Box>
      )
    }
    // A block's frame: `w` wide outside, its rows `w - 4` inside the border and padding.
    const block = (w: number, color: string, isDim = false) =>
      cardFrame(color, { width: w, isDim })
    // A fill's colour by how full it is: the statusline's ramp step, or where a terminal cannot draw
    // it, three steps in theme colours.
    const heat = (pct: number) => (isRamp ? heatHex(pct) : { calm: C.main, warm: C.amber, hot: C.warn }[heatOf(pct)])
    const sep: Span = { text: '· ', color: C.faint }

    // Status-line rows, as statusline.sh draws them: a dim label column, the bar, the value right-aligned,
    // then a detail column and the rest. Below 40 inner columns the bar takes 5 cells and the gaps one, and
    // what does not fit is left out.
    type Meter = { key: string; label: string; bar: Span[]; value: Span; pct?: number; d1?: Span; d2?: (Piece | null)[] }
    const barWOf = (iw: number) => (iw >= 40 ? 10 : 5)
    const meterRoom = (iw: number, labelW: number) => (iw >= 40 ? iw - (labelW + 2 + 10 + 2 + 4) - 3 : iw - (labelW + 1 + 5 + 1 + 4) - 2)
    const meters = (rows: Meter[], iw: number) => {
      const labelW = Math.max(3, ...rows.map(x => cellWidth(x.label)))
      const isFull = iw >= 40
      const gap = isFull ? 2 : 1
      const room = meterRoom(iw, labelW)
      // The detail column is as wide as its widest value, so a number is never cut: where it does not
      // fit, the column goes instead, and the rest after it only shows the pieces that fit whole.
      const d1W = Math.max(0, ...rows.map(x => (x.d1 ? cellWidth(x.d1.text) : 0)))
      const hasD1 = d1W > 0 && room >= d1W
      const d2Room = hasD1 ? room - d1W - 2 : room
      return rows.map(x => (
        <Box key={x.key} width={iw}>
          <Box width={labelW} flexShrink={0}>
            <Text dimColor>{x.label}</Text>
          </Box>
          <Box width={barWOf(iw)} marginLeft={gap} flexShrink={0}>
            {e.surface !== 'terminal' ? svgBar(x.key, x.bar, barWOf(iw), `${x.label} ${x.value.text}`, x.pct) : spanText(x.bar.filter(b => b.text))}
          </Box>
          <Box width={4} marginLeft={gap} flexShrink={0} justifyContent="flex-end">
            <Text {...styleOf(x.value)} wrap="truncate">
              {x.value.text}
            </Text>
          </Box>
          {hasD1 ? (
            <Box width={d1W} marginLeft={isFull ? 3 : 2} flexShrink={0}>
              {x.d1 ? <Text {...styleOf(x.d1)}>{x.d1.text}</Text> : null}
            </Box>
          ) : null}
          {x.d2 && d2Room >= 4 ? <Box marginLeft={hasD1 ? 2 : isFull ? 3 : 2}>{line(x.d2, d2Room)}</Box> : null}
        </Box>
      ))
    }
    // On a graphical surface a meter is SVG, not box-drawing: a rounded track and fill in the role colours
    // that glides to a new reading (DESIGN.md, Graphical surfaces). The number beside it still says it.
    const svgBar = (key: string, bar: Span[], cells: number, alt: string, pct?: number) => {
      if (e.surface === 'terminal') return null
      const { Svg } = $.ui.resolve(e)
      const isTrack = (b: Span) => b.color === C.faint || b.color === HEAT_UNLIT
      // A heat fill (its lit runs ramp steps) as one gradient run across the meter, as the status line's
      // cells step along it; the gate's verdict runs keep their roles.
      const isHeat = bar.some(b => !isTrack(b)) && bar.every(b => isTrack(b) || (HEAT_RAMP as readonly string[]).includes(b.color ?? ''))
      // Its width is the reading's own share, not the cells': above zero, at least half a cell.
      const runs = isHeat
        ? [{ cells: pct !== undefined ? meterShare(pct, cells) * cells : bar.filter(b => !isTrack(b)).reduce((n, b) => n + cellWidth(b.text), 0), color: HEAT_FILL }]
        : bar.map(b => ({ cells: cellWidth(b.text), color: b.color, isTrack: isTrack(b) }))
      const drawn = svgMeter(runs, cells, meterWidths.get(key) ?? [], !motion)
      meterWidths.set(key, drawn.widths)
      return <Svg source={drawn.source} alt={alt} />
    }
    // A fill drawn as the statusline draws it: ━ in its heat, ─ for the rest.
    const fillBar = (pct: number, cells: number): Span[] => {
      if (isRamp) return heatRuns(pct, cells)
      const gg = gauge(pct, cells)
      return [
        { text: gg.on, color: heat(pct) },
        { text: gg.off, color: C.faint },
      ]
    }
    const pctOf = (pct: number): Span => ({ text: percent(pct), color: heat(pct) })

    // ---- context split: what fills the window, by /context's categories (estimated)
    const splitUsed = sp ? sp.rows.reduce((n, x) => n + x.tokens, 0) : 0
    const splitRow = (iw: number): Meter | null => {
      if (!sp || sp.rows.length === 0) return null
      const pct = (splitUsed / sp.window) * 100
      return {
        key: 'meter-split',
        label: 'mix',
        // A fill meter like ctx: the heat ramp, so every meter reads alike; the legend names what fills it.
        bar: fillBar(pct, barWOf(iw)),
        pct,
        value: pctOf(pct),
        d1: { text: 'est.', dim: true },
      }
    }
    // The split's legend, largest first: what does not fit is left out from the end.
    const splitLegend = (iw: number) =>
      sp && sp.rows.length > 0
        ? line(
            sp.rows.map(x => ({ spans: [{ text: `${splitLabel(x.name)} ${kTokens(x.tokens)}`, dim: true }] })),
            iw,
            2,
          )
        : null

    // ---- main: the statusline's card, with the session's own figures folded in below its meters
    const ctxFill = contextFill(u)
    const mainState = m.isRunning ? right([{ text: '● working', color: C.main }]) : right([{ text: '○ idle', color: C.dim }])
    const mainRows = (iw: number): Meter[] => [
      ...(ctxFill.pct !== null
        ? [
            {
              key: 'meter-ctx',
              label: 'ctx',
              bar: fillBar(ctxFill.pct, barWOf(iw)),
              value: pctOf(ctxFill.pct),
              pct: ctxFill.pct,
              ...(u.tokens !== null ? { d1: { text: `${kTokens(u.tokens)}/${kTokens(ctxFill.window)}`, dim: true } } : {}),
              d2: [u.compactions > 0 ? { spans: [{ text: `⟲ ${u.compactions}`, color: C.amber }] } : null],
            },
          ]
        : []),
      ...(splitRow(iw) ? [splitRow(iw)!] : []),
      ...u.limits.slice(0, 2).map((l): Meter => {
        const resetIn = fmtResetIn(l.resetsAt, now)
        const resetAt = fmtResetAt(l.resetsAt, now)
        return {
          key: `meter-${l.kind}`,
          label: limitLabel(l.kind),
          bar: fillBar(l.pct, barWOf(iw)),
          value: pctOf(l.pct),
          pct: l.pct,
          ...(resetIn ? { d1: { text: `↻ ${resetIn}`, dim: true } } : {}),
          // As the status line: the reset's wall clock, the pace, and when 100% comes if before the reset.
          d2: [
            resetAt ? { spans: [{ text: resetAt, dim: true }] } : null,
            (p => (p === null ? null : { spans: [paceLabel(p).role === ROLE.chrome ? { text: paceLabel(p).text, dim: true } : { text: paceLabel(p).text, color: paceLabel(p).role }] }))(
              pace(l.pct, l.resetsAt, LIMIT_WINDOW_MS[l.kind], now),
            ),
            (at => (at === null ? null : { spans: [{ text: forecastLabel(at, now), color: C.warn }] }))(forecast(l.pct, l.resetsAt, LIMIT_WINDOW_MS[l.kind], now)),
          ],
        }
      }),
    ]
    // The label row as the statusline's header: model, folder, the ↗︎ link (the folder and origin as links), branch and
    // its changes, zeros left out. Narrower, the link and the changes go first, then the branch, then the folder.
    const headVariants = (): Piece[][] => {
      const model: Piece = { spans: [{ text: modelName, color: C.main, bold: true }] }
      if (!rp) return [[model, { spans: [sep, { text: 'main', dim: true }] }], [model]]
      const folder = (withLink: boolean): Piece => ({
        spans: [sep, { text: folderOf(rp.dir), href: fileUri(rp.dir) }, ...(withLink && rp.remote ? [{ text: ` ${GLYPH.external}`, dim: true, href: rp.remote }] : [])],
      })
      const changes: Span[] = [
        ...(rp.added > 0 ? [{ text: ` +${rp.added}`, color: C.ok }] : []),
        ...(rp.modified > 0 ? [{ text: ` ~${rp.modified}`, color: C.amber }] : []),
        ...(rp.deleted > 0 ? [{ text: ` -${rp.deleted}`, color: C.warn }] : []),
      ]
      // The branch in plain text: colour is kept for its changes, + ~ - in success, warning, error.
      const branch = (withChanges: boolean): Piece => ({ spans: [sep, { text: rp.branch }, ...(withChanges ? changes : [])] })
      return rp.isRepo && rp.branch
        ? [[model, folder(true), branch(true)], [model, folder(false), branch(true)], [model, folder(false), branch(false)], [model, folder(false)], [model]]
        : [[model, folder(true)], [model, folder(false)], [model]]
    }
    const mainPanel = (w: number) => {
      const iw = w - 4
      const variants = headVariants()
      const widthOfAll = (ps: Piece[]) => ps.reduce((n, x) => n + widthOf(x), 0) + ps.length - 1
      // The status keeps its place while the model and folder fit beside it.
      const fit = headFit(iw, widthOfAll(variants[Math.max(0, variants.length - 2)] ?? []), mainState.width)
      const room = fit.showRight ? iw - 1 - mainState.width : iw
      const label = variants.find(ps => widthOfAll(ps) <= room) ?? variants[variants.length - 1] ?? []
      return (
        <Box {...block(w, C.main)}>
          <Box key="main-head" width={iw} justifyContent="space-between" overflow="hidden">
            {line(label, room)}
            {fit.showRight ? <Box flexShrink={0}>{mainState.node}</Box> : null}
          </Box>
          {meters(mainRows(iw), iw)}
          {splitLegend(iw)}
          {line(
            [
              { spans: [{ text: 'effort ', dim: true }, { text: m.effort || '—', color: C.main }] },
              m.mode ? { spans: [sep, { text: 'mode ', dim: true }, { text: m.mode }] } : null,
              { spans: [sep, { text: String(m.steps) }, { text: ' req', dim: true }] },
              u.costUsd !== null ? { spans: [sep, { text: fmtUsd(u.costUsd) }] } : null,
              m.speed ? { spans: [sep, { text: 'ttft ', dim: true }, { text: `${(m.speed.ttftMs / 1000).toFixed(1)}s` }] } : null,
            ],
            iw,
          )}
        </Box>
      )
    }

    // ---- architect
    const lastConsult = a.consults[a.consults.length - 1]
    const architectPanel = (w: number) => {
      // Both ends are anchors (the first consult, now): should it run past its box, it asks to lose the middle.
      const tl = consultTimeline(a, now, Math.max(8, w - 4))
      return (
        <Box {...block(w, C.arch)}>
          {head(
            w - 4,
            `${cfg.architectLabel} · ${advising ? 'advising' : 'on call'}`,
            C.arch,
            right([
              { text: 'consults ', dim: true },
              { text: String(a.consults.length), color: C.arch, bold: true },
            ]),
          )}
          <Box key="timeline">
            <Text color={C.arch} wrap="truncate-middle">
              {tl}
            </Text>
          </Box>
          {lastConsult ? (
            <Text dimColor wrap="truncate">
              {advising
                ? `consulting since ${fmtClock(lastConsult.at)}`
                : `last ${fmtDuration(now - (lastConsult.endAt ?? lastConsult.at))} ago · took ${fmtDuration((lastConsult.endAt ?? now) - lastConsult.at)}`}
            </Text>
          ) : (
            <Text color={C.faint}>not consulted yet</Text>
          )}
          {cfg.moments ? (
            <Box flexWrap="wrap" columnGap={2}>
              {(['before a plan', 'error repeats', 'before done'] as const).map(mo => {
                const isOn = lastConsult?.moment === mo
                return (
                  <Text color={isOn ? C.arch : C.dim} weight={isOn ? 'bold' : undefined}>
                    {isOn ? '◆' : '◇'} {mo}
                  </Text>
                )
              })}
              <Text color={C.faint} italic>
                (inferred)
              </Text>
            </Box>
          ) : null}
          {a.lastAdvice ? (
            <Text color={C.arch} wrap="truncate">
              » {a.lastAdvice}
            </Text>
          ) : null}
        </Box>
      )
    }

    // ---- gate: one status-line meter split by verdict, the counts beside it, then a row per family
    const s = gateSummary(g)
    const verdictColor = (c: Check) =>
      c.verdict === 'rule' ? C.ok : c.verdict === 'cleared' ? C.cleared : c.verdict === 'ask' ? C.amber : C.warn
    // ■ ran (by a rule, or once you or the classifier cleared it), ○ waiting on the decider, ✕ refused.
    const markOf = (c: Check) => (c.verdict === 'deny' ? '✕' : c.verdict === 'ask' ? '○' : '■')
    const verdicts = [
      { n: s.rule, color: C.ok, word: 'allowed' },
      { n: s.cleared, color: C.cleared, word: decider },
      { n: s.ask, color: C.amber, word: 'pending' },
      { n: s.deny, color: C.warn, word: 'denied' },
    ]
    const gateBar = (cells: number): Span[] => {
      const seg = segments(
        verdicts.map(x => x.n),
        cells,
      )
      const lit = verdicts.map((x, i) => ({ text: '━'.repeat(seg[i] ?? 0), color: x.color }))
      const rest = cells - seg.reduce((a, b) => a + b, 0)
      return [...lit, { text: '─'.repeat(Math.max(0, rest)), color: C.faint }].filter(x => x.text)
    }
    // The counts in words where they fit, in numbers alone where they don't: the colours say which is which.
    // Pending shows only while something waits; denied always, in the error colour once there is one.
    const gateCounts = (isShort: boolean): Piece[] =>
      verdicts
        .filter(x => x.word !== 'pending' || x.n > 0)
        .map((x, i) => ({
          spans: [
            ...(i > 0 ? [sep] : []),
            { text: String(x.n), color: x.word === 'denied' && x.n === 0 ? C.dim : x.color },
            ...(isShort ? [] : [{ text: ` ${x.word}`, dim: true }]),
          ],
        }))
    const gatePanel = (w: number) => {
      const iw = w - 4
      const open = v.gateOpen
      const fits = (ps: Piece[], room: number) => piecesThatFit(ps.map(x => ({ width: widthOf(x) })), room, 1) === ps.length
      const room = meterRoom(iw, 3)
      // In words beside the meter, else in words on a row of their own, else in numbers alone.
      const beside = fits(gateCounts(false), room) ? gateCounts(false) : null
      const below = beside ? null : fits(gateCounts(false), iw) ? gateCounts(false) : gateCounts(true)
      return (
        <Box {...block(w, C.gate)}>
          {head(iw, `${cfg.gateLabel} · permissions`, C.gate, right([{ text: `${s.total} checks`, dim: true }]))}
          {meters([{ key: 'meter-gate', label: 'all', bar: gateBar(barWOf(iw)), value: { text: String(s.total), bold: true }, ...(beside ? { d2: beside } : {}) }], iw)}
          {below ? line(below, iw) : null}
          {/* Below about 44 columns the three rows' buttons take two lines rather than run past the block. */}
          <Box columnGap={2} flexWrap="wrap">
            {(['file', 'shell', 'other'] as const).map((b: Bucket) => {
              const tl = g.totals[b]
              const n = tl.rule + tl.ask + tl.cleared + tl.deny
              return (
                <Button
                  key={`gate-${b}`}
                  plain
                  hotkey={b[0]}
                  label={`${b} ${n}${open === b ? ' ▾' : ''}`}
                  dimColor={n === 0}
                  onPress={() => update($, view, x => ({ ...normalize(DEFAULT_VIEW, x), gateOpen: normalize(DEFAULT_VIEW, x).gateOpen === b ? null : b }))}
                />
              )
            })}
          </Box>
          {open
            ? g.recent
                .filter(c => c.bucket === open)
                .slice(-5)
                .map(c => (
                  // The verdict sits in a box of its own width, not padded with spaces, which a graphical surface collapses.
                  <Box width={iw} columnGap={1} overflow="hidden">
                    <Box width={12} flexShrink={0}>
                      <Text>
                        <Text color={verdictColor(c)}>{`${markOf(c)} `}</Text>
                        <Text color={C.dim}>{c.verdict === 'rule' ? 'allowed' : c.verdict === 'cleared' ? decider : c.verdict === 'ask' ? 'pending' : 'denied'}</Text>
                      </Text>
                    </Box>
                    <Text dimColor={c.inSubagent} wrap="truncate">
                      {shorten(c.detail, Math.max(10, iw - 14))}
                    </Text>
                  </Box>
                ))
            : null}
        </Box>
      )
    }

    // ---- agents: cards up to the limit, swimlanes beyond it
    const statusColor = (c: AgentCard) => (c.status === 'failed' ? C.warn : c.status === 'done' ? C.ok : c.status === 'running' ? C.agent : C.amber)
    const glyph = (c: AgentCard) => (c.status === 'running' ? '●' : c.status === 'done' ? '✓' : c.status === 'failed' ? '✕' : '■')
    const expandOnPress = (id: string) => () =>
      update($, view, x => ({ ...normalize(DEFAULT_VIEW, x), expanded: normalize(DEFAULT_VIEW, x).expanded === id ? null : id }))

    const agentsPanel = (w: number) => {
      const iw = w - 4
      // Cards need 26 columns each inside the block, room for their status in words; when the block can't
      // hold them all, lanes take over. A lone card takes what there is, from 20 columns.
      const fit = Math.max(1, Math.min(cfg.maxCards, Math.floor((iw + 1) / 27)))
      const useLanes = cards.length > fit
      const isNarrow = w < 40
      const label = isNarrow ? `agents · ${running.length}/${cards.length}` : `agents · ${running.length} running · ${cards.length} total`
      const hint = cards.length > 0 ? right([{ text: `1-${Math.min(cards.length, useLanes ? 6 : fit)}${isNarrow ? '' : ' expand'}`, color: C.faint }]) : null
      if (cards.length === 0) {
        return (
          <Box {...block(w, C.agent)}>
            {head(iw, label, C.agent)}
            <Text color={C.faint}>no subagents yet</Text>
          </Box>
        )
      }
      if (useLanes) {
        const shown = cards.slice(-6)
        // A lane is its glyph, a label, the bar and a clock: below 34 columns the label narrows, below
        // 36 the bar, so a 24-column pane still holds it.
        const labelW = Math.min(17, Math.max(7, iw - 17))
        const barW = Math.max(4, iw - 11 - labelW)
        const geo = lanes(shown, now, barW)
        return (
          <Box {...block(w, C.agent)}>
            {head(iw, label, C.agent, hint)}
            {cards.length > shown.length ? <Text color={C.faint}>{`+${cards.length - shown.length} earlier`}</Text> : null}
            {shown.map((c, i) => {
              const gm = geo[i]
              const isViewed = viewed === c.id
              return (
                <Box columnGap={1}>
                  <Text color={statusColor(c)} weight={isViewed ? 'bold' : undefined}>
                    {isViewed ? '▸' : glyph(c)}
                  </Text>
                  <Box width={labelW} flexShrink={0}>
                    <Button key={`card-${c.id}`} plain hotkey={String(i + 1)} label={shorten(cardTitle(c), labelW - 3)} onPress={expandOnPress(c.id)} />
                  </Box>
                  <Box flexShrink={0}>
                    <Text>
                      <Text color={C.faint}>{'─'.repeat(gm?.before ?? 0)}</Text>
                      <Text color={statusColor(c)}>{'━'.repeat(gm?.bar ?? 1)}</Text>
                      <Text color={C.faint}>{'─'.repeat(gm?.after ?? 0)}</Text>
                    </Text>
                  </Box>
                  {clock(`lane-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}
                </Box>
              )
            })}
          </Box>
        )
      }
      // Each card is a rounded box inside the block; a connector fans out to them from the label row.
      const shown = cards.slice(-fit)
      const cardW = Math.floor((iw - (shown.length - 1)) / shown.length)
      const centers = shown.map((_, i) => i * (cardW + 1) + Math.floor(cardW / 2))
      return (
        <Box {...block(w, C.agent)}>
          {head(iw, label, C.agent, hint)}
          {rail('fan-out', running.length > 0, C.agent, iw, centers)}
          <Box columnGap={1}>
            {shown.map((c, i) => {
              const isViewed = viewed === c.id
              const sameModel = !c.model || prettyModel(c.model) === modelName
              const [first, rest] = titleLines(cardTitle(c), cardW - 7, cardW - 4)
              const isMax = c.lastStop === 'max_tokens'
              return (
                <Box {...cardFrame(isMax ? C.warn : C.agent, { width: cardW, isBold: isViewed, isDim: c.status !== 'running' && !isViewed })}>
                  <Button key={`card-${c.id}`} plain hotkey={String(i + 1)} label={first} onPress={expandOnPress(c.id)} />
                  <Text weight="bold" wrap="truncate">
                    {rest}
                  </Text>
                  <Text color={C.dim} wrap="truncate">
                    {sameModel ? c.type : `${c.type} · ${prettyModel(c.model)}`}
                  </Text>
                  <Text dimColor wrap="truncate">
                    {c.steps > 0 ? `ctx ${kTokens(c.ctx)} · out ${kTokens(c.out)} · ${c.steps} st` : 'starting…'}
                  </Text>
                  <Box columnGap={1}>
                    <Text color={isMax ? C.warn : statusColor(c)}>{cardW >= 26 ? `${glyph(c)} ${isMax ? 'max_tokens' : c.status}` : glyph(c)}</Text>
                    <Box flexShrink={0}>{clock(`card-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}</Box>
                  </Box>
                </Box>
              )
            })}
          </Box>
        </Box>
      )
    }

    const expandedCard = cards.find(c => c.id === v.expanded)
    const expandedPanel = (w: number) =>
      expandedCard ? (
        <Box {...block(w, C.agent)}>
          {head(w - 4, `${expandedCard.type} · ${prettyModel(expandedCard.model)} · ${expandedCard.status} · ${plural(expandedCard.steps, 'step')}`, C.agent)}
          <Text weight="bold" wrap="wrap">
            {expandedCard.description || expandedCard.type}
          </Text>
          {expandedCard.tools.length === 0 ? <Text color={C.faint}>no tool calls yet</Text> : null}
          {expandedCard.tools.map(n => (
            <Box columnGap={1}>
              <Text color={n.isError ? C.warn : C.agent}>{n.isError ? '✕' : '•'}</Text>
              <Text color={n.isError ? C.warn : C.text} wrap="truncate">
                {n.text}
              </Text>
            </Box>
          ))}
          {expandedCard.answer ? (
            <Text dimColor wrap="wrap">
              {`» ${shorten(expandedCard.answer, 240)}`}
            </Text>
          ) : null}
        </Box>
      ) : null

    // ---- other loops (workflow agents, forks): ids that match no card
    const loopsPanel = (w: number) => {
      if (lp.length === 0) return null
      const iw = w - 4
      const active = lp.filter(l => isLoopActive(l, now)).length
      const dots = lp.slice(-Math.max(4, marksIn(iw, isTerminal)))
      const isNarrow = w < 40
      return (
        <Box {...block(w, C.agent)}>
          {head(iw, isNarrow ? 'loops' : 'other loops', C.agent, right([{ text: isNarrow ? `${lp.length} · ${active} active` : `${lp.length} seen · ${active} active`, dim: true }]))}
          {markRow(
            dots.map(l => (
              <Text color={isLoopActive(l, now) ? C.agent : l.isDone ? C.ok : C.faint}>{isLoopActive(l, now) ? '●' : l.isDone ? '✓' : '○'}</Text>
            )),
          )}
        </Box>
      )
    }

    // ---- receipt: the turn now, or the last one, timed on the right as pulse times a shell row
    const receiptPanel = (w: number) => {
      const isReview = t.isReviewing
      const state: Right | null = m.isRunning
        ? {
            node: (
              <Box columnGap={1}>
                <Text color={C.main}>●</Text>
                {clock('turn-clock', t.startedAt, null, C.main)}
              </Box>
            ),
            // The clock ticks on its own: room for one more digit than it shows now.
            width: 2 + Math.max(5, cellWidth(fmtTimer(Math.max(0, now - t.startedAt))) + 1),
          }
        : r
          ? right([{ text: `${r.reason === 'answer' ? '✓' : '✕'} ${fmtDuration(r.durationMs)}`, color: r.reason === 'answer' ? C.ok : C.warn }])
          : null
      return (
        <Box {...block(w, C.main, !m.isRunning && !isReview)}>
          {head(w - 4, m.isRunning ? 'turn' : 'last turn', C.main, state, { dim: !m.isRunning && !isReview })}
          {m.isRunning ? (
            <Text dimColor wrap="truncate">{`${modelName.toLowerCase()} · ${plural(t.edits, 'edit')} · ${plural(t.errors, 'error')}`}</Text>
          ) : r ? (
            line(
              [
                { spans: [{ text: `${plural(r.agents, 'agent')} · ${plural(r.edits, 'edit')} · ${plural(r.errors, 'error')}`, dim: true }], fill: true },
                r.costDelta !== null ? { spans: [{ text: `· +${fmtUsd(r.costDelta)}`, color: C.main }] } : null,
              ],
              w - 4,
            )
          ) : (
            <Text color={C.faint}>no turn finished yet</Text>
          )}
          {isReview ? (
            <Text color={C.arch} wrap="wrap">
              {`${cfg.architectLabel.toLowerCase()} reviewing before done (inferred)`}
            </Text>
          ) : null}
        </Box>
      )
    }

    // ---- inbox: what needs a look, newest first; a row with a transcript row of its own jumps there
    const INBOX_ROWS = 5
    const inboxPanel = (w: number) => {
      const iw = w - 4
      const isNarrow = iw < 36
      const msgW = Math.max(4, iw - 6 - (isNarrow ? 2 : 7))
      const word = { tool: 'tool', denied: 'deny', api: 'api', turn: 'turn', mod: 'mod' } as const
      const clear: Right = {
        node: <Button key="inbox-clear" plain hotkey="c" label="clear" onPress={() => update($, inbox, () => [])} />,
        width: 8,
      }
      const shown = inboxNewest(ib, INBOX_ROWS)
      return (
        <Box {...block(w, C.warn)}>
          {head(iw, `inbox · ${ib.length}`, C.warn, clear)}
          {shown.map(x => {
            const isPause = x.text === 'turn interrupted'
            const color = isPause ? C.amber : C.warn
            const mark = isPause ? '‖' : '✕'
            // A row the transcript no longer holds (or a host that cannot scroll) says so rather than failing the press.
            const jump = (item: InboxItem) => async () => {
              const args = jumpTo(item)
              const moved = args ? await $.ui.scroll(args).catch((err: unknown) => ({ deny: String((err as Error)?.message ?? err) })) : null
              if (moved?.deny) $.ui.toast(`flightdeck: cannot show that row (${shorten(moved.deny, 60)})`)
            }
            return (
              <Box key={`inbox-row-${x.id}`} width={iw} columnGap={1} overflow="hidden">
                <Box width={5} flexShrink={0}>
                  <Text color={C.faint}>{fmtClock(x.at).slice(0, 5)}</Text>
                </Box>
                <Box width={isNarrow ? 1 : 6} flexShrink={0}>
                  <Text color={color}>{isNarrow ? mark : `${mark} ${word[x.source]}`}</Text>
                </Box>
                {x.target ? (
                  <Button key={`inbox-${x.id}`} plain label={shorten(x.text, msgW)} onPress={jump(x)} />
                ) : (
                  <Text wrap="truncate">{shorten(x.text, msgW)}</Text>
                )}
              </Box>
            )
          })}
          {ib.length > shown.length ? <Text color={C.faint}>{`+${ib.length - shown.length} older`}</Text> : null}
        </Box>
      )
    }

    // ---- trends: one sparkline per figure over the last turns, the latest reading on the right
    type TrendRow = { key: string; label: string; vals: (number | null)[]; max?: number; fmt: (n: number) => string; isHeat?: boolean }
    // ---- tools: where the session's time went, by tool; a slow run (10 s and up) in warning, failures in error
    const toolsPanel = (w: number) => {
      const iw = w - 4
      const calls = ts.reduce((n, x) => n + x.calls, 0)
      const shown = ts.slice(0, 6)
      const nameW = Math.min(18, Math.max(4, ...shown.map(x => cellWidth(toolLabel(x.name)))))
      return (
        <Box {...block(w, C.main)}>
          {head(iw, 'tools', C.main, right([{ text: plural(calls, 'call'), dim: true }]))}
          {shown.map(x => {
            // Columns, each a fixed width so they line up: the tool, its calls, the average, the slowest, failures.
            const avg = fmtDuration(x.totalMs / x.calls)
            const max = fmtDuration(x.maxMs)
            const room = iw - nameW - 1 - 4
            return (
              <Box key={`tool-${x.name}`} width={iw} overflow="hidden">
                <Box width={nameW} flexShrink={0}>
                  <Text wrap="truncate">{toolLabel(x.name)}</Text>
                </Box>
                <Box width={4} marginLeft={1} flexShrink={0} justifyContent="flex-end">
                  <Text dimColor>{String(x.calls)}</Text>
                </Box>
                {room >= 12 ? (
                  <Box width={10} marginLeft={2} flexShrink={0} columnGap={1}>
                    <Text dimColor>avg</Text>
                    <Text>{avg}</Text>
                  </Box>
                ) : null}
                {room >= 24 ? (
                  <Box width={10} marginLeft={1} flexShrink={0} columnGap={1}>
                    <Text dimColor>max</Text>
                    <Text {...(x.maxMs >= 10_000 ? { color: C.amber } : {})}>{max}</Text>
                  </Box>
                ) : null}
                {x.fails && room >= 34 ? (
                  <Box marginLeft={1} flexShrink={0}>
                    <Text color={C.warn}>{`${x.fails} failed`}</Text>
                  </Box>
                ) : null}
              </Box>
            )
          })}
          {ts.length > shown.length ? <Text dimColor>{`${GLYPH.more} ${plural(ts.length - shown.length, 'more tool')}`}</Text> : null}
        </Box>
      )
    }

    const trendPanel = (w: number) => {
      const iw = w - 4
      const n = Math.max(1, Math.min(tr.length, iw - 4 - 7 - 2))
      const pts = tr.slice(-n)
      const rows: TrendRow[] = [
        { key: 'ctx', label: 'ctx', vals: pts.map(x => x.ctx), max: 100, fmt: percent, isHeat: true },
        { key: 'cost', label: 'cost', vals: pts.map(x => x.cost), fmt: fmtUsd },
        { key: 'time', label: 'time', vals: pts.map(x => x.ms), fmt: fmtDuration },
        { key: 'out', label: 'out', vals: pts.map(x => x.out), fmt: kTokens },
      ].filter(x => x.vals.some(y => y !== null))
      const ramp = cfg.ascii ? SPARK_ASCII : SPARK
      const sparkline = (x: TrendRow) => {
        const levels = sparkLevels(x.vals, x.max)
        const colorAt = (i: number) => {
          const val = x.vals[i]
          return val === null || val === undefined ? C.faint : x.isHeat ? heat(val) : C.main
        }
        if (!isTerminal) {
          const { Svg } = $.ui.resolve(e)
          const drawn = svgSpark(levels, levels.map((_, i) => colorAt(i)), n, sparkHeights.get(x.key) ?? [], !motion)
          sparkHeights.set(x.key, drawn.heights)
          return <Svg source={drawn.source} alt={`${x.label} over the last ${plural(pts.length, 'turn')}`} />
        }
        // Runs of one colour drawn as one span.
        const spans: Span[] = []
        levels.forEach((lv, i) => {
          const ch = ramp[lv ?? 0] ?? ramp[0]!
          const color = colorAt(i)
          const last = spans[spans.length - 1]
          if (last && last.color === color) last.text += ch
          else spans.push({ text: ch, color })
        })
        return spanText(spans)
      }
      return (
        <Box {...block(w, C.main)}>
          {head(iw, 'trends', C.main, right([{ text: `last ${plural(pts.length, 'turn')}`, dim: true }]))}
          {rows.map(x => {
            const latest = [...x.vals].reverse().find((y): y is number => y !== null)
            return (
              <Box key={`trend-${x.key}`} width={iw} columnGap={1}>
                <Box width={4} flexShrink={0}>
                  <Text dimColor>{x.label}</Text>
                </Box>
                <Box width={n} flexShrink={0}>
                  {sparkline(x)}
                </Box>
                <Box width={7} flexShrink={0} justifyContent="flex-end">
                  <Text {...(x.isHeat && latest !== undefined ? { color: heat(latest) } : {})} wrap="truncate">
                    {latest !== undefined ? x.fmt(latest) : '—'}
                  </Text>
                </Box>
              </Box>
            )
          })}
        </Box>
      )
    }

    // ---- log: whatever rows the other panels leave, 4 to 8
    // Rows each block takes, its border included, and one row of gap between blocks.
    const used =
      3 +
      legendGap +
      (4 + (ctxFill.pct !== null ? 1 : 0) + Math.min(2, u.limits.length)) +
      (showArchitect ? 6 : 0) +
      5 +
      (v.gateOpen ? 5 : 0) +
      (cards.length > cfg.maxCards ? 4 + Math.min(6, cards.length) : 11) +
      (expandedCard ? 8 : 0) +
      (lp.length ? 4 : 0) +
      (sp && sp.rows.length > 0 ? 2 : 0) +
      (ib.length > 0 ? 3 + Math.min(INBOX_ROWS, ib.length) + (ib.length > INBOX_ROWS ? 1 : 0) : 0) +
      (tr.length > 0 ? 7 : 0) +
      4 +
      panels.length +
      2
    const bodyRows = e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 40
    const nLog = logRows(bodyRows, used)
    const shownLines = (viewed ? lines.filter(l => l.agentId === viewed) : lines).slice(-nLog)
    const colorOf = (l: LogLine) =>
      l.kind === 'error' ? C.warn : l.kind === 'consult' ? C.arch : l.who === 'main' ? C.main : l.who === 'gate' ? C.gate : l.who === 'you' ? C.text : C.agent
    // Below 40 columns a line keeps its minute, not its second, and a shorter name.
    const logPanel = (w: number) => (
      <Box {...block(w, C.dim)}>
        {head(w - 4, viewed ? 'session log · this agent' : 'session log', C.dim)}
        {shownLines.length === 0 ? <Text color={C.faint}>nothing yet</Text> : null}
        {shownLines.map(l => (
          <Box>
            <Box width={w < 40 ? 6 : 9} flexShrink={0}>
              <Text color={C.faint}>{w < 40 ? fmtClock(l.at).slice(0, 5) : fmtClock(l.at)}</Text>
            </Box>
            <Box width={w < 40 ? 9 : 13} flexShrink={0}>
              <Text color={colorOf(l)} weight="bold" wrap="truncate">
                {l.who}
              </Text>
            </Box>
            <Text color={l.kind === 'error' ? C.warn : C.text} wrap="truncate">
              {l.text}
            </Text>
          </Box>
        ))}
      </Box>
    )

    const draw = (p: Panel, w: number) =>
      p === 'main'
        ? mainPanel(w)
        : p === 'architect'
          ? architectPanel(w)
          : p === 'gate'
            ? gatePanel(w)
            : p === 'agents'
              ? agentsPanel(w)
              : p === 'loops'
                ? loopsPanel(w)
                : p === 'receipt'
                  ? receiptPanel(w)
                  : p === 'inbox'
                    ? inboxPanel(w)
                    : p === 'trends'
                      ? trendPanel(w)
                      : p === 'tools'
                        ? toolsPanel(w)
                        : logPanel(w)

    // Blocks one row apart, every gap alike: a connector where work flows from one block to the next (main to
    // architect, gate and the receipt), an empty row elsewhere. Hidden blocks take no gap.
    type Item = Panel | 'expanded'
    const flows = (a: Item, b: Item) => ![a, b].some(x => x === 'agents' || x === 'expanded' || x === 'log' || x === 'loops' || x === 'inbox' || x === 'trends' || x === 'tools')
    // Blocks sit edge to edge, no blank row between. Where work flows from one block to the next, the
    // connector runs on the upper block's own bottom edge: drawn over it, one cell in from each side, so
    // its rounded corners stay and the connector takes no row. At rest it is the edge, in its colour.
    const edgeOf = (a: Item) => (a === 'architect' ? C.arch : a === 'gate' ? C.gate : C.main)
    const gapRow = (a: Item, b: Item, w: number) =>
      flows(a, b) ? (
        <Box key={`link-${b}`} marginTop={-1} marginX={1} height={1} flexShrink={0}>
          {rail(`rail-${b}`, b === 'architect' ? advising : m.isRunning, b === 'architect' ? C.arch : C.main, w - 2, [], false, edgeOf(a))}
        </Box>
      ) : null
    const column = (ps: Panel[], w: number) => {
      const items: Item[] = ps.flatMap((p): Item[] => (p === 'agents' && expandedCard ? [p, 'expanded'] : [p]))
      return (
        <Box flexDirection="column" width={w}>
          {items.flatMap((p, i) => {
            const prev = items[i - 1]
            const drawn = (
              <Box key={`block-${p}`} flexDirection="column">
                {p === 'expanded' ? expandedPanel(w) : draw(p, w)}
              </Box>
            )
            return prev ? [gapRow(prev, p, w), drawn] : [drawn]
          })}
        </Box>
      )
    }

    // Desktop draws the agents' time axis as SVG under the panels.
    const svgLanes =
      e.surface !== 'terminal' && cards.length > 0
        ? (() => {
            const { Svg } = $.ui.resolve(e)
            const rowH = 18
            const pxW = 520
            const geo = lanes(cards.slice(-10), now, 100)
            const rects = cards
              .slice(-10)
              .map((c, i) => {
                const gm = geo[i]
                const x = 150 + ((gm?.before ?? 0) / 100) * (pxW - 160)
                const wpx = Math.max(3, ((gm?.bar ?? 1) / 100) * (pxW - 160))
                const fill = c.status === 'running' ? SVG_COLORS.running : c.status === 'done' ? SVG_COLORS.done : c.status === 'failed' ? SVG_COLORS.failed : SVG_COLORS.other
                const label = shorten(cardTitle(c), 22).replace(/[<&>]/g, '')
                return `<text x="4" y="${i * rowH + 13}" font-size="11" fill="${SVG_COLORS.label}">${label}</text><rect x="${x}" y="${i * rowH + 4}" width="${wpx}" height="10" rx="3" fill="${fill}"/>`
              })
              .join('')
            const svgH = Math.min(10, cards.length) * rowH + 4
            // No width or height on the element: it takes the markup's own width up to the pane's and
            // scales down to fit a narrow one, rather than running past it at 520 pixels.
            return (
              <Svg
                source={`<svg xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${svgH}" viewBox="0 0 ${pxW} ${svgH}">${rects}</svg>`}
                alt={`${cards.length} agents on a time axis`}
              />
            )
          })()
        : null

    // The inbox's count, beside the model in the header: what needs a look.
    const inboxBadge: Piece | null = ib.length > 0 ? { spans: [sep, { text: `✕ ${ib.length}`, color: C.warn }] } : null

    // Inline above the prompt (the terminal's main screen), the pane is a summary of at most 8 rows.
    const isMini = layout === 'mini' || (layout === 'auto' && e.props.placement === 'inline')
    // The pane in the glyph set `glyphs` and the font call for (glyphTree, DESIGN.md Options).
    const drawn = <T,>(tree: T): T => glyphTree(tree, glyphSet(options?.glyphs, hasNerd, e.surface))

    // ---- graphical surfaces (desktop, VS Code, mobile): drawn as the app draws its own panels, part for
    // part (kit's g* parts): limits as Settings > Usage draws them, the model as the Environment panel's
    // rows, the gate as the Context panel's legend. Context and its mix are the app's own Context panel's.
    if (!isTerminal && !isMini) {
      const gs = gateSummary(g)
      const muted = (text: string) => <Text dimColor wrap="truncate-end">{text}</Text>
      const changes = rp?.isRepo ? [rp.added ? `+${rp.added}` : '', rp.modified ? `~${rp.modified}` : '', rp.deleted ? `-${rp.deleted}` : ''].filter(Boolean).join(' ') : ''
      const limitName = (kind: string) => (kind === 'five_hour' ? 'Current session' : kind === 'seven_day' ? 'Weekly · all models' : limitLabel(kind))
      const limits =
        u.limits.length || ctxFill.pct !== null
        ? gSection(
            k,
            { key: 'g-limits', title: 'Usage' },
            ...(ctxFill.pct !== null
              ? [gUsage(k, { key: 'g-ctx', label: 'Context', ...(u.tokens !== null ? { sub: `${kTokens(u.tokens)} of ${kTokens(ctxFill.window)} tokens` } : {}), pct: ctxFill.pct })]
              : []),
            ...u.limits.slice(0, 2).map(l => {
              const full = forecast(l.pct, l.resetsAt, LIMIT_WINDOW_MS[l.kind], now)
              const at = fmtResetAt(l.resetsAt, now)
              const sub = at ? `Resets ${/^\d/.test(at) ? `at ${at}` : at}` : ''
              return gUsage(k, {
                key: `g-limit-${l.kind}`,
                label: limitName(l.kind),
                ...(sub ? { sub } : {}),
                ...(full !== null ? { note: `Full by ${clockAt(full, now) || 'now'} at this pace`, noteColor: APP.red } : {}),
                pct: l.pct,
              })
            }),
          )
        : null
      // What fills the context, as the app's Context panel splits it: one bar, a legend of its categories.
      const MIX = [APP.blue, '#8b5cf6', '#d97757', '#3fb950', '#e3b341', '#14b8a6']
      const mix =
        sp && sp.rows.length > 0
          ? gSection(
              k,
              { key: 'g-mix', title: 'Context by category', meta: muted('Estimated') },
              gBar(k, {
                key: 'g-mix-bar',
                alt: `What fills the context: ${sp.rows.map(x => `${splitLabel(x.name)} ${kTokens(x.tokens)}`).join(', ')}`,
                segments: sp.rows.map((x, i) => ({ share: x.tokens / sp.window, color: MIX[i % MIX.length]! })),
              }),
              ...sp.rows.slice(0, MIX.length).map((x, i) => gLegend(k, { key: `g-mix-${i}`, color: MIX[i]!, label: x.name, value: kTokens(x.tokens) })),
            )
          : null
      const model = gSection(
        k,
        { key: 'g-model', title: modelName, meta: m.isRunning ? <Text color={C.main}>Working</Text> : muted('Idle') },
        ...(m.effort ? [gRow(k, { key: 'g-effort', icon: 'effort', label: 'Effort', value: sentence(m.effort) })] : []),
        ...(m.mode ? [gRow(k, { key: 'g-mode', icon: 'mode', label: 'Mode', value: sentence(m.mode) })] : []),
        ...(rp?.isRepo ? [gRow(k, { key: 'g-branch', icon: 'branch', label: rp.branch, ...(changes ? { sub: changes } : {}) })] : []),
        ...(u.costUsd !== null ? [gRow(k, { key: 'g-cost', icon: 'cost', label: 'Session cost', value: fmtUsd(u.costUsd) })] : []),
        ...(m.speed ? [gRow(k, { key: 'g-ttft', icon: 'timer', label: 'Time to first token', value: fmtDuration(m.speed.ttftMs) })] : []),
      )
      const gate =
        gs.total > 0
          ? gSection(
              k,
              { key: 'g-gate', title: 'Permissions', meta: muted(plural(gs.total, 'check')) },
              gBar(k, {
                key: 'g-gate-bar',
                alt: `${gs.rule} allowed by a rule, ${gs.cleared} cleared by ${decider}, ${gs.ask} waiting, ${gs.deny} denied`,
                segments: [
                  { share: gs.rule / gs.total, color: svgColor(C.ok) },
                  { share: gs.cleared / gs.total, color: APP.blue },
                  { share: gs.ask / gs.total, color: svgColor(C.amber) },
                  { share: gs.deny / gs.total, color: APP.red },
                ],
              }),
              gLegend(k, { key: 'g-gate-rule', color: svgColor(C.ok), label: 'Allowed by a rule', value: String(gs.rule) }),
              gLegend(k, { key: 'g-gate-cleared', color: APP.blue, label: `Approved by ${decider}`, value: String(gs.cleared) }),
              ...(gs.ask ? [gLegend(k, { key: 'g-gate-ask', color: svgColor(C.amber), label: 'Waiting for you', value: String(gs.ask) })] : []),
              gLegend(k, { key: 'g-gate-deny', color: APP.red, label: 'Denied', value: String(gs.deny) }),
            )
          : null
      const agents = cards.length
        ? gSection(
            k,
            { key: 'g-agents', title: 'Agents', meta: muted(running.length ? `${running.length} running` : plural(cards.length, 'agent')) },
            ...cards.slice(-8).reverse().map(c =>
              gRow(k, {
                key: `g-agent-${c.id}`,
                lead: <Text color={statusColor(c)}>{glyph(c)}</Text>,
                label: cardTitle(c),
                sub: `${c.type}${c.model && prettyModel(c.model) !== modelName ? ` · ${prettyModel(c.model)}` : ''}`,
                value: c.spawnedAt > 0 ? fmtTimer((c.endedAt ?? now) - c.spawnedAt) : '',
              }),
            ),
          )
        : null
      const architect = showArchitect
        ? gSection(k, { key: 'g-arch', title: cfg.architectLabel, meta: advising ? <Text color={C.arch}>Advising</Text> : muted('On call') }, ...(a.lastAdvice ? [<Text key="g-advice" dimColor wrap="wrap">{a.lastAdvice}</Text>] : []))
        : null
      const turn =
        m.isRunning || r
          ? gSection(
              k,
              { key: 'g-turn', title: m.isRunning ? 'This turn' : 'Last turn', ...(r && !m.isRunning ? { meta: muted(`${r.reason === 'answer' ? 'Done' : 'Stopped'} in ${fmtDuration(r.durationMs)}`) } : {}) },
              gRow(k, { key: 'g-turn-edits', icon: 'edit', label: 'Files edited', value: String(m.isRunning ? t.edits : (r?.edits ?? 0)) }),
              gRow(k, { key: 'g-turn-errors', icon: 'error', label: 'Errors', value: String(m.isRunning ? t.errors : (r?.errors ?? 0)), ...((m.isRunning ? t.errors : r?.errors) ? { valueColor: APP.red } : {}) }),
              ...(!m.isRunning && r && r.agents ? [gRow(k, { key: 'g-turn-agents', icon: 'agent', label: 'Agents', value: String(r.agents) })] : []),
              ...(!m.isRunning && r && r.costDelta !== null ? [gRow(k, { key: 'g-turn-cost', icon: 'cost', label: 'Cost', value: fmtUsd(r.costDelta) })] : []),
            )
          : null
      // The last turns as sparklines, each figure's latest value right.
      const pts = tr.slice(-20)
      const trends = pts.length
        ? gSection(
            k,
            { key: 'g-trends', title: 'Trends', meta: muted(`Last ${plural(pts.length, 'turn')}`) },
            ...(
              [
                { key: 'ctx', label: 'Context', vals: pts.map(x => x.ctx), max: 100, fmt: percent, isHeat: true },
                { key: 'cost', label: 'Cost', vals: pts.map(x => x.cost), fmt: fmtUsd },
                { key: 'time', label: 'Time', vals: pts.map(x => x.ms), fmt: fmtDuration },
                { key: 'out', label: 'Output tokens', vals: pts.map(x => x.out), fmt: kTokens },
              ] as TrendRow[]
            )
              .filter(x => x.vals.some(y => y !== null))
              .map(x => {
                const { Svg } = $.ui.resolve(e)
                const colorOf = (v: number | null | undefined) => (v === null || v === undefined ? APP.track : x.isHeat ? usageColor(v) : APP.blue)
                const drawn = svgSpark(sparkLevels(x.vals, x.max), x.vals.map(colorOf), pts.length, sparkHeights.get(x.key) ?? [], !motion)
                sparkHeights.set(x.key, drawn.heights)
                const latest = [...x.vals].reverse().find((y): y is number => y !== null)
                return gChartRow(k, {
                  key: `g-trend-${x.key}`,
                  label: x.label,
                  chart: <Svg source={drawn.source} alt={`${x.label.toLowerCase()} over the last ${plural(pts.length, 'turn')}`} />,
                  value: latest !== undefined ? x.fmt(latest) : '—',
                  ...(x.isHeat && latest !== undefined && latest >= 80 ? { valueColor: APP.red } : {}),
                })
              }),
          )
        : null
      const tools = ts.length
        ? gSection(
            k,
            { key: 'g-tools', title: 'Tools', meta: muted(plural(ts.reduce((n, x) => n + x.calls, 0), 'call')) },
            ...ts.slice(0, 8).map(x =>
              gRow(k, {
                key: `g-tool-${x.name}`,
                label: toolLabel(x.name),
                sub: `${plural(x.calls, 'call')}${x.calls > 1 ? ` · ${fmtDuration(x.totalMs / x.calls)} on average` : ''}${x.fails ? ` · ${x.fails} failed` : ''}`,
                value: fmtDuration(x.maxMs),
                ...(x.maxMs >= 10_000 ? { valueColor: svgColor(C.amber) } : {}),
              }),
            ),
          )
        : null
      const inbox = ib.length
        ? gSection(k, { key: 'g-inbox', title: 'Needs attention', meta: <Text color={APP.red}>{String(ib.length)}</Text> }, ...ib.slice(0, 6).map(x => gRow(k, { key: `g-inbox-${x.id}`, label: x.text, sub: x.source })))
        : null
      const log = gSection(
        k,
        { key: 'g-log', title: 'Session log' },
        ...(lines.length
          ? lines.slice(-8).reverse().map((x, i) =>
              gRow(k, { key: `g-log-${i}`, label: x.text, sub: `${new Date(x.at).toTimeString().slice(0, 5)} · ${x.who}`, ...(x.kind === 'error' ? { value: 'Error', valueColor: APP.red } : {}) }),
            )
          : [muted('Nothing yet')]),
      )
      return drawn(gPane(k, inbox, limits, mix, model, gate, agents, architect, turn, trends, tools, log))
    }
    if (isMini) {
      const live = [...cards.filter(c => c.status === 'running'), ...cards.filter(c => c.status !== 'running').reverse()].slice(0, 3)
      const counts = `${s.rule} allowed · ${s.cleared} ${decider}${s.ask > 0 ? ` · ${s.ask} pending` : ''} · ${s.deny} denied`
      const mg = ctxFill.pct !== null ? fillBar(ctxFill.pct, 6) : null
      return drawn(
        <Box flexDirection="column" width={W}>
          {line(
            [
              {
                spans: [
                  { text: modelName, color: C.main, bold: true },
                  { text: m.isRunning ? ' ● working' : ' ○ idle', color: m.isRunning ? C.main : C.dim },
                ],
              },
              inboxBadge,
              mg
                ? {
                    spans: [
                      sep,
                      { text: 'ctx ', dim: true },
                      ...mg,
                      { text: ` ${percent(ctxFill.pct ?? 0)}`, color: heat(ctxFill.pct ?? 0) },
                      ...(u.compactions > 0 ? [{ text: ` ⟲${u.compactions}`, color: C.amber }] : []),
                    ],
                  }
                : u.compactions > 0
                  ? { spans: [{ text: `⟲${u.compactions}`, color: C.amber }] }
                  : null,
              u.costUsd !== null ? { spans: [sep, { text: fmtUsd(u.costUsd), dim: true }] } : null,
              showArchitect ? { spans: [sep, { text: `${cfg.architectLabel.toLowerCase()} ${advising ? 'advising' : a.consults.length}`, color: C.arch }] } : null,
            ],
            W,
          )}
          {s.total > 0 ? (
            <Box columnGap={1}>
              <Text color={C.gate}>{cfg.gateLabel.toLowerCase()}</Text>
              <Box flexShrink={0}>{spanText(gateBar(10))}</Box>
              <Text color={s.deny > 0 ? C.warn : s.ask > 0 ? C.amber : C.dim} wrap="truncate">
                {counts}
              </Text>
            </Box>
          ) : null}
          {live.map(c => (
            <Box columnGap={1}>
              <Text color={statusColor(c)}>{glyph(c)}</Text>
              <Box width={Math.max(6, W - 30)} flexShrink={0}>
                <Text wrap="truncate">{cardTitle(c)}</Text>
              </Box>
              {c.steps > 0 ? <Text dimColor>{`ctx ${kTokens(c.ctx)}`}</Text> : null}
              {clock(`mini-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}
            </Box>
          ))}
          {cards.length > live.length ? (
            <Text color={C.faint} wrap="truncate">{`+${cards.length - live.length} more agents · /flightdeck layout compact for all`}</Text>
          ) : null}
          {lp.length > 0 ? <Text dimColor wrap="truncate">{`other loops ${lp.length} · ${lp.filter(l => isLoopActive(l, now)).length} active`}</Text> : null}
          {!m.isRunning && r ? (
            <Text dimColor wrap="truncate">
              {`${r.reason === 'answer' ? '✓' : '✕'} last turn ${fmtDuration(r.durationMs)} · ${plural(r.agents, 'agent')} · ${plural(r.edits, 'edit')} · ${plural(r.errors, 'error')}${r.costDelta !== null ? ` · +${fmtUsd(r.costDelta)}` : ''}`}
            </Text>
          ) : null}
        </Box>
      )
    }

    const legend = fitLegend(
      [
        { label: 'main', color: C.main },
        { label: 'agents', color: C.agent },
        { label: cfg.gateLabel.toLowerCase(), color: C.gate },
        ...(showArchitect ? [{ label: cfg.architectLabel.toLowerCase(), color: C.arch }] : []),
      ],
      W,
    )

    const body = isWide ? (
      <Box flexDirection="column">
        <Box key="block-columns" columnGap={2}>
          {column(panels.filter(p => p === 'main' || p === 'architect' || p === 'gate' || p === 'inbox'), colW)}
          {column(panels.filter(p => p === 'agents' || p === 'loops' || p === 'receipt' || p === 'tools' || p === 'trends'), colW)}
        </Box>
        {panels.includes('log') ? (
          <Box key="block-log" flexDirection="column">
            {logPanel(W)}
          </Box>
        ) : null}
      </Box>
    ) : (
      column(panels, W)
    )

    const badges = [inboxBadge, showArchitect ? { spans: [{ text: cfg.architectLabel, color: C.arch, bold: true }, { text: advising ? ' advising' : ' on call', dim: true }] } : null].filter(x => x !== null)
    // The kit's pane layout: a blank row, the header, a blank row, then the content.
    return drawn(
      <Box flexDirection="column" width={W} paddingTop={SPACE.top}>
        {header(k, {
          title: 'Flightdeck',
          role: C.main,
          // No model yet (before the first turn): no detail, rather than a dash.
          ...(m.model ? { detail: modelName } : {}),
          status: <Text color={m.isRunning ? C.main : C.dim}>{m.isRunning ? `${GLYPH.live} working` : `${GLYPH.idle} idle`}</Text>,
        })}
        {space(k, 'gap-head')}
        {badges.length ? line(badges, W, 2) : null}
        <Box key="legend" columnGap={2} marginBottom={legendGap}>
          {legend.map(l => (
            <Box flexShrink={0}>
              <Text>
                <Text color={l.color}>■</Text>
                <Text color={C.faint}>{` ${l.label}`}</Text>
              </Text>
            </Box>
          ))}
        </Box>
        {body}
        {svgLanes}
      </Box>
    )
  }).catch(($, e, next) => {
    // Without this a failed draw leaves the engine's empty pane.
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" width={Math.max(20, e.props.bodyColumns)}>
        <Text color={C.main} weight="bold">
          flightdeck
        </Text>
        <Text color={C.warn} wrap="wrap">{`draw failed (${next.error.kind}): ${next.error.message ?? 'no message'}`}</Text>
      </Box>
    )
  })
}
