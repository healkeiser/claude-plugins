import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { AgentCard, Architect, Bucket, Check, Gate, Layout, LogLine, Loop, Main, Repo, Roster, Turn, Usage, View } from '../types'
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
} from './core'
import type { Config, Panel } from './core'

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
    ctxFill.pct !== null ? `ctx ${Math.round(ctxFill.pct)}%` : null,
    cards.length > 0 ? `agents ${running}/${cards.length}` : null,
    a.consults.length > 0 || a.ids.length > 0 ? `${cfg.architectLabel.toLowerCase()} ${isAdvising(a) ? 'advising' : a.consults.length}` : null,
    s.deny > 0 ? `denied ${s.deny}` : null,
  ]
  // Only fields with something to say; with none, no status entry at all.
  const shown = parts.filter(Boolean)
  $.ui.status(shown.length > 0 ? shown.join(' · ') : undefined)
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
  // tool.check carries no loop id; the tool.call around it does, keyed by the call's id.
  const callLoop = new Map<string, string | null>()

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'flightdeck',
      description: 'Flightdeck, the live agent dashboard: open, close, reset, or set the layout',
      argumentHint: '[open|close|reset|layout auto|compact|wide|mini]',
    })
    await migrate($)
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
    return { text: 'Flightdeck opened. Focus it with ctrl+x tab; 1-6 expand cards, f/s/o open the gate rows.' }
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
        await refreshStatus($, cfg)
      }
    }
    return verdict
  })

  on('tool.call', async ($, e, next) => {
    callLoop.set(e.tool_use_id, e.agentId ?? null)
    const ran = await next(e).finally(() => callLoop.delete(e.tool_use_id))
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
    else if (hasFailed) await say($, await whoIs($, e.agentId), `${text}  ✗`, 'error', e.agentId ?? null)
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
      await update($, main, m => ({ ...normalize(DEFAULT_MAIN, m), isRunning: false }))
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
  on('ui.fault', async ($, e, next) => {
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
    const [m, u, a, g, cards, lp, lines, t, r, v, rp, now] = await Promise.all([
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
      $.clock.now(),
    ])
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
    const motion = cfg.motion && hasRail
    // A panel with nothing to show yet takes no room: most sessions never spawn an agent.
    const isEmpty: Record<Panel, boolean> = {
      main: false,
      architect: !showArchitect,
      gate: g.recent.length === 0 && gateSummary(g).total === 0,
      agents: cards.length === 0,
      loops: lp.length === 0,
      receipt: !m.isRunning && !r,
      log: false,
    }
    const panels = cfg.panels.filter(p => !isEmpty[p])
    const decider = m.mode === 'auto' ? 'classifier' : 'you'

    // A connector between blocks: animated while its flow is live, a dim line otherwise.
    const rail = (key: string, active: boolean, color: string, width: number, marks: number[] = [], isMerge = false) =>
      motion ? (
        <els.Client
          key={key}
          module="./rail.tsx"
          width={width}
          height={1}
          props={{ active, width, color, dim: C.faint, marks, isMerge }}
        />
      ) : (
        <Text color={C.faint} mono>
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
    const styleOf = (s: Span) => ({ ...(s.color ? { color: s.color } : {}), ...(s.dim ? { dimColor: true } : {}), ...(s.bold ? { bold: true } : {}) })
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
    const head = (w: number, label: string, color: string, r: Right | null = null, o: { dim?: boolean } = {}) => {
      const fit = headFit(w, cellWidth(label), r?.width ?? 0)
      return (
        <Box width={w} justifyContent="space-between" columnGap={1} overflow="hidden">
          <Text color={color} bold wrap="truncate" {...(o.dim ? { dimColor: true } : {})}>
            {shorten(label, fit.label)}
          </Text>
          {r && fit.showRight ? <Box flexShrink={0}>{r.node}</Box> : null}
        </Box>
      )
    }
    // A block's frame: `w` wide outside, its rows `w - 4` inside the border and padding.
    const block = (w: number, color: string, isDim = false) =>
      ({ flexDirection: 'column', borderStyle: 'round', borderColor: color, paddingX: 1, width: w, ...(isDim ? { borderDimColor: true } : {}) }) as const
    // A fill's colour by how full it is: three steps of the statusline's heat ramp, in theme colours.
    const heat = (pct: number) => ({ calm: C.main, warm: C.amber, hot: C.warn })[heatOf(pct)]
    const sep: Span = { text: '· ', color: C.faint }

    // Status-line rows, as statusline.sh draws them: a dim label column, the bar, the value right-aligned,
    // then a detail column and the rest. Below 40 inner columns the bar takes 5 cells and the gaps one, and
    // what does not fit is left out.
    type Meter = { key: string; label: string; bar: Span[]; value: Span; d1?: Span; d2?: (Piece | null)[] }
    const barWOf = (iw: number) => (iw >= 40 ? 10 : 5)
    const meterRoom = (iw: number, labelW: number) => (iw >= 40 ? iw - (labelW + 2 + 10 + 2 + 4) - 3 : iw - (labelW + 1 + 5 + 1 + 4) - 2)
    const meters = (rows: Meter[], iw: number) => {
      const labelW = Math.max(3, ...rows.map(x => cellWidth(x.label)))
      const isFull = iw >= 40
      const gap = isFull ? 2 : 1
      const room = meterRoom(iw, labelW)
      const hasD1 = rows.some(x => x.d1)
      const d2Room = hasD1 ? room - 9 - 2 : room
      return rows.map(x => (
        <Box key={x.key} width={iw}>
          <Box width={labelW} flexShrink={0}>
            <Text dimColor>{x.label}</Text>
          </Box>
          <Box width={barWOf(iw)} marginLeft={gap} flexShrink={0}>
            {spanText(x.bar.filter(b => b.text))}
          </Box>
          <Box width={4} marginLeft={gap} flexShrink={0} justifyContent="flex-end">
            <Text {...styleOf(x.value)} wrap="truncate">
              {x.value.text}
            </Text>
          </Box>
          {hasD1 && room >= 9 ? (
            <Box width={9} marginLeft={isFull ? 3 : 2} flexShrink={0}>
              {x.d1 ? (
                <Text {...styleOf(x.d1)} wrap="truncate">
                  {x.d1.text}
                </Text>
              ) : null}
            </Box>
          ) : null}
          {x.d2 && d2Room >= 4 ? <Box marginLeft={hasD1 ? 2 : isFull ? 3 : 2}>{line(x.d2, d2Room)}</Box> : null}
        </Box>
      ))
    }
    // A fill drawn as the statusline draws it: ━ in its heat, ─ for the rest.
    const fillBar = (pct: number, cells: number): Span[] => {
      const gg = gauge(pct, cells)
      return [
        { text: gg.on, color: heat(pct) },
        { text: gg.off, color: C.faint },
      ]
    }
    const pctOf = (pct: number): Span => ({ text: `${Math.round(pct)}%`, color: heat(pct) })

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
              ...(u.tokens !== null ? { d1: { text: `${kTokens(u.tokens)}/${kTokens(ctxFill.window)}`, dim: true } } : {}),
              d2: [u.compactions > 0 ? { spans: [{ text: `⟲ ${u.compactions}`, color: C.amber }] } : null],
            },
          ]
        : []),
      ...u.limits.slice(0, 2).map((l): Meter => {
        const resetIn = fmtResetIn(l.resetsAt, now)
        const resetAt = fmtResetAt(l.resetsAt, now)
        return {
          key: `meter-${l.kind}`,
          label: limitLabel(l.kind),
          bar: fillBar(l.pct, barWOf(iw)),
          value: pctOf(l.pct),
          ...(resetIn ? { d1: { text: `↻ ${resetIn}`, dim: true } } : {}),
          d2: [resetAt ? { spans: [{ text: resetAt, dim: true }] } : null],
        }
      }),
    ]
    // The label row as the statusline's header: model, folder ↗ (the folder and origin as links), branch and
    // its changes, zeros left out. Narrower, the link and the changes go first, then the branch, then the folder.
    const headVariants = (): Piece[][] => {
      const model: Piece = { spans: [{ text: modelName, color: C.main, bold: true }] }
      if (!rp) return [[model, { spans: [sep, { text: 'main', dim: true }] }], [model]]
      const folder = (withLink: boolean): Piece => ({
        spans: [sep, { text: folderOf(rp.dir), href: fileUri(rp.dir) }, ...(withLink && rp.remote ? [{ text: ' ↗\uFE0E', dim: true, href: rp.remote }] : [])],
      })
      const changes: Span[] = [
        ...(rp.added > 0 ? [{ text: ` +${rp.added}`, color: C.ok }] : []),
        ...(rp.modified > 0 ? [{ text: ` ~${rp.modified}`, color: C.amber }] : []),
        ...(rp.deleted > 0 ? [{ text: ` -${rp.deleted}`, color: C.warn }] : []),
      ]
      const branch = (withChanges: boolean): Piece => ({ spans: [sep, { text: rp.branch, color: C.ok }, ...(withChanges ? changes : [])] })
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
                  <Text color={isOn ? C.arch : C.dim} bold={isOn}>
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
      c.verdict === 'rule' ? C.gate : c.verdict === 'cleared' ? C.cleared : c.verdict === 'ask' ? C.amber : C.warn
    // ■ ran (by a rule, or once you or the classifier cleared it), ○ waiting on the decider, ✕ refused.
    const markOf = (c: Check) => (c.verdict === 'deny' ? '✕' : c.verdict === 'ask' ? '○' : '■')
    const verdicts = [
      { n: s.rule, color: C.gate, word: 'allowed' },
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
                  <Text color={statusColor(c)} bold={isViewed}>
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
                <Box
                  flexDirection="column"
                  borderStyle={isViewed ? 'bold' : 'round'}
                  borderColor={isMax ? C.warn : C.agent}
                  borderDimColor={c.status !== 'running' && !isViewed}
                  width={cardW}
                  paddingX={1}
                >
                  <Button key={`card-${c.id}`} plain hotkey={String(i + 1)} label={first} onPress={expandOnPress(c.id)} />
                  <Text bold wrap="truncate">
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
          <Text bold wrap="wrap">
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
              <Text color={colorOf(l)} bold wrap="truncate">
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
                  : logPanel(w)

    // Blocks one row apart, every gap alike: a connector where work flows from one block to the next (main to
    // architect, gate and the receipt), an empty row elsewhere. Hidden blocks take no gap.
    type Item = Panel | 'expanded'
    const flows = (a: Item, b: Item) => ![a, b].some(x => x === 'agents' || x === 'expanded' || x === 'log' || x === 'loops')
    const gapRow = (a: Item, b: Item, w: number) =>
      flows(a, b) ? rail(`link-${b}`, b === 'architect' ? advising : m.isRunning, b === 'architect' ? C.arch : C.main, w) : <Box key={`gap-${b}`} height={1} />
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

    // Inline above the prompt (the terminal's main screen), the pane is a summary of at most 8 rows.
    const isMini = layout === 'mini' || (layout === 'auto' && e.props.placement === 'inline')
    if (isMini) {
      const live = [...cards.filter(c => c.status === 'running'), ...cards.filter(c => c.status !== 'running').reverse()].slice(0, 3)
      const counts = `${s.rule} allowed · ${s.cleared} ${decider}${s.ask > 0 ? ` · ${s.ask} pending` : ''} · ${s.deny} denied`
      const mg = ctxFill.pct !== null ? gauge(ctxFill.pct, 6) : null
      return (
        <Box flexDirection="column" width={W}>
          {line(
            [
              {
                spans: [
                  { text: modelName, color: C.main, bold: true },
                  { text: m.isRunning ? ' ● working' : ' ○ idle', color: m.isRunning ? C.main : C.dim },
                ],
              },
              mg
                ? {
                    spans: [
                      sep,
                      { text: 'ctx ', dim: true },
                      { text: mg.on, color: heat(ctxFill.pct ?? 0) },
                      { text: mg.off, color: C.faint },
                      { text: ` ${Math.round(ctxFill.pct ?? 0)}%`, color: heat(ctxFill.pct ?? 0) },
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
          {column(panels.filter(p => p === 'main' || p === 'architect' || p === 'gate'), colW)}
          {column(panels.filter(p => p === 'agents' || p === 'loops' || p === 'receipt'), colW)}
        </Box>
        {panels.includes('log') ? <Box key="gap-log" height={1} /> : null}
        {panels.includes('log') ? (
          <Box key="block-log" flexDirection="column">
            {logPanel(W)}
          </Box>
        ) : null}
      </Box>
    ) : (
      column(panels, W)
    )

    // One blank row above the header, so the pane does not sit flush against its tab.
    return (
      <Box flexDirection="column" width={W} paddingTop={1}>
        {/* One compact row, left-aligned like the statusline's header. Below 40 columns the frame's own title names the pane. */}
        {line(
          [
            W >= 40 ? { spans: [{ text: 'flightdeck', color: C.main, bold: true }] } : null,
            {
              spans: [
                ...(W >= 40 ? [sep] : []),
                { text: modelName, bold: true },
                { text: m.isRunning ? ' ● working' : ' ○ idle', color: m.isRunning ? C.main : C.dim },
              ],
            },
            showArchitect
              ? {
                  spans: [sep, { text: cfg.architectLabel, color: C.arch, bold: true }, { text: advising ? ' advising' : ' on call', dim: true }],
                }
              : null,
          ],
          W,
        )}
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
        <Text color={C.main} bold>
          flightdeck
        </Text>
        <Text color={C.warn} wrap="wrap">{`draw failed (${next.error.kind}): ${next.error.message ?? 'no message'}`}</Text>
      </Box>
    )
  })
}
