// Pure data: defaults, reducers, formatting and layout math. Nothing here touches `$`, so every
// behaviour is testable directly (the test kit cannot raise a subagent's tool call or a
// permission check inside a call; these functions are what the hooks apply).
import type { AgentCard, Architect, Bucket, Check, Gate, InboxItem, Layout, LogLine, Loop, Main, Moment, Receipt, Roster, Split, Tally, ToolNote, ToolStat, TrendPoint, Turn, Usage, View } from '../types'
import { HEAT_RAMP, ROLE, ascii, cellWidth, clip, clockAt, count, duration, isAsciiGlyphs, meter, plural as sharedPlural, span, usd, wholePct } from './style'

export const SCHEMA_VERSION = 2

// ---------------------------------------------------------------- defaults

export const DEFAULT_MAIN: Main = { model: '', effort: '', mode: '', steps: 0, isRunning: false, speed: null }
export const DEFAULT_USAGE: Usage = {
  pct: null,
  tokens: null,
  window: 0,
  compactWindow: null,
  compactFor: 0,
  compactMisses: 0,
  costUsd: null,
  limits: [],
  compactions: 0,
  lastCompactAt: null,
}
export const DEFAULT_ARCHITECT: Architect = { consults: [], ids: [], seen: [], lastAdvice: '' }
const ZERO: Tally = { rule: 0, ask: 0, cleared: 0, deny: 0 }
export const DEFAULT_GATE: Gate = { recent: [], totals: { file: ZERO, shell: ZERO, other: ZERO } }
export const DEFAULT_TURN: Turn = { edits: 0, errorStreak: 0, errors: 0, isReviewing: false, startedAt: 0, costAtStart: null }
export const DEFAULT_VIEW: View = { expanded: null, gateOpen: null, layout: null }
export const DEFAULT_ROSTER: Roster = { architectTypes: [] }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A stored object merged over its defaults, so a value saved under an older shape still reads. */
export const normalize = <T extends object>(def: T, stored: unknown): T =>
  isObject(stored) ? ({ ...def, ...stored } as T) : def

/** A stored list, or empty when what is stored is not a list. */
export const listOf = <T>(stored: unknown): T[] => (Array.isArray(stored) ? (stored as T[]) : [])

export const normalizeGate = (stored: unknown): Gate => {
  const g = normalize(DEFAULT_GATE, stored)
  const totals = normalize(DEFAULT_GATE.totals, g.totals)
  return {
    recent: listOf<Check>(g.recent),
    totals: { file: normalize(ZERO, totals.file), shell: normalize(ZERO, totals.shell), other: normalize(ZERO, totals.other) },
  }
}

export const normalizeCard = (stored: unknown): AgentCard =>
  normalize<AgentCard>(
    {
      id: '',
      type: 'agent',
      model: '',
      description: '',
      status: 'running',
      spawnedAt: 0,
      endedAt: null,
      ctx: 0,
      out: 0,
      steps: 0,
      lastStop: null,
      tools: [],
      answer: '',
    },
    stored,
  )

export const normalizeLog = (stored: unknown): LogLine[] =>
  listOf<Record<string, unknown>>(stored).map(l => ({
    at: typeof l.at === 'number' ? l.at : 0,
    who: String(l.who ?? ''),
    text: String(l.text ?? ''),
    agentId: typeof l.agentId === 'string' ? l.agentId : null,
    kind: l.kind === 'error' || l.kind === 'consult' || l.kind === 'done' ? l.kind : 'info',
  }))

// ---------------------------------------------------------------- config

export type Panel = 'main' | 'architect' | 'gate' | 'inbox' | 'agents' | 'loops' | 'receipt' | 'tools' | 'trends' | 'log'
const PANELS: readonly Panel[] = ['main', 'architect', 'gate', 'inbox', 'agents', 'loops', 'receipt', 'tools', 'trends', 'log']

export type Config = {
  architect: RegExp
  architectLabel: string
  gateLabel: string
  panels: Panel[]
  motion: boolean
  moments: boolean
  matchDescriptions: boolean
  maxCards: number
  paneColumns: number
  layout: Layout
  palette: Palette
  openOnStart: boolean
  statusLine: boolean
  /** `glyphs: text`: ASCII stand-ins and classic borders. */
  ascii: boolean
}

const safeRegExp = (source: string, fallback: string) => {
  try {
    return new RegExp(source || fallback, 'i')
  } catch {
    return new RegExp(fallback, 'i')
  }
}

/** The plugin's `/config` values, read leniently: anything malformed falls back to the default. */
export const parseConfig = (o: Readonly<Record<string, unknown>>): Config => {
  const str = (k: string, d: string) => (typeof o[k] === 'string' && o[k] !== '' ? (o[k] as string) : d)
  const bool = (k: string, d: boolean) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : d)
  const panels = str('panels', PANELS.join(','))
    .split(',')
    .map(s => s.trim())
    .filter((p): p is Panel => (PANELS as readonly string[]).includes(p))
  const layout = str('layout', 'auto')
  const max = typeof o.maxCards === 'number' ? Math.round(o.maxCards) : 3
  const cols = typeof o.paneColumns === 'number' && Number.isFinite(o.paneColumns) ? Math.round(o.paneColumns) : 66
  return {
    architect: safeRegExp(str('architectPattern', ''), 'advisor|architect'),
    architectLabel: str('architectLabel', 'Architect'),
    gateLabel: str('gateLabel', 'Gate'),
    panels: panels.length > 0 ? [...new Set(panels)] : [...PANELS],
    motion: str('motion', 'while-active') !== 'off',
    moments: bool('moments', true),
    matchDescriptions: bool('matchDescriptions', false),
    maxCards: Math.min(6, Math.max(1, max)),
    // The body clamps its drawing at 40 columns, so a narrower dock would only clip it.
    paneColumns: Math.max(40, cols),
    layout: layout === 'compact' || layout === 'wide' || layout === 'mini' ? layout : 'auto',
    palette: str('palette', 'theme') === 'pastel' ? 'pastel' : 'theme',
    openOnStart: bool('openOnStart', true),
    statusLine: bool('statusLine', false),
    ascii: isAsciiGlyphs(o.glyphs),
  }
}

// ---------------------------------------------------------------- palette

export type Palette = 'theme' | 'pastel'
export type Colors = Record<'main' | 'agent' | 'gate' | 'cleared' | 'arch' | 'amber' | 'warn' | 'ok' | 'dim' | 'faint' | 'text', string>

/**
 * `theme` names the person's own theme colours (they follow light, dark and colour-blind themes);
 * `pastel` is fixed hex tuned for dark terminals.
 */
export const PALETTES: Record<Palette, Colors> = {
  // The shared roles (style.ts, DESIGN.md): main the accent, agents the agent
  // role, the architect's advice the info role, the gate and what you cleared
  // the you role.
  theme: {
    main: ROLE.accent,
    agent: ROLE.agent,
    gate: ROLE.you,
    cleared: ROLE.you,
    arch: ROLE.info,
    amber: ROLE.warning,
    warn: ROLE.error,
    ok: ROLE.success,
    dim: ROLE.muted,
    faint: ROLE.chrome,
    text: 'text',
  },
  pastel: {
    main: '#7dd3fc',
    agent: '#93c5fd',
    gate: '#86efac',
    cleared: '#5eead4',
    arch: '#c4b5fd',
    amber: '#fcd34d',
    warn: '#fca5a5',
    ok: '#86efac',
    dim: '#6b7280',
    faint: '#3f4654',
    text: '#e5e7eb',
  },
}

/** SVG cannot name theme keys: mid-tone colours that read on light and dark backgrounds. */
export const SVG_COLORS = { running: '#3b82f6', done: '#16a34a', failed: '#dc2626', other: '#8b5cf6', label: '#6b7280' }

/** Each role's theme key as a mid-tone hex for SVG, which cannot name theme keys; a hex passes through. */
const SVG_ROLE: Record<string, string> = {
  claude: '#d97757',
  suggestion: '#6b7bd6',
  merged: '#8b5cf6',
  planMode: '#14917f',
  ide: '#3b82f6',
  success: '#16a34a',
  warning: '#d97706',
  error: '#dc2626',
  subtle: '#9ca3af',
  inactive: '#9ca3af',
  text: '#6b7280',
}
export const svgColor = (color: string | undefined) =>
  color?.startsWith('#') || color === HEAT_FILL ? color : SVG_ROLE[color ?? ''] ?? SVG_ROLE.subtle!

/** A run coloured `HEAT_FILL` takes the heat ramp as a gradient across the whole meter, as the status line's cells step along it. */
export const HEAT_FILL = 'url(#heat)'

/**
 * A meter as SVG for a graphical surface: a rounded track, then each lit run in its colour. A run whose
 * width changed since the last drawing (`before`, in pixels) glides to the new width on an ease-out over
 * 400 ms (SMIL, so no tick); `isStill` drops the glide.
 */
export const svgMeter = (runs: readonly { cells: number; color?: string; isTrack?: boolean }[], cells: number, before: readonly number[], isStill: boolean) => {
  const CELL = 7
  const w = cells * CELL
  let x = 0
  const widths: number[] = []
  const rects = runs
    .filter(r => !r.isTrack && r.cells > 0)
    .map((r, i) => {
      const rw = Math.round(r.cells * CELL * 100) / 100
      const from = before[i]
      const glide =
        !isStill && from !== undefined && from !== rw
          ? `<animate attributeName="width" from="${from}" to="${rw}" dur="0.4s" calcMode="spline" keyTimes="0;1" keySplines="0.33 1 0.68 1" fill="freeze"/>`
          : ''
      const rect = `<rect x="${x}" y="0" width="${rw}" height="6" fill="${svgColor(r.color)}">${glide}</rect>`
      widths.push(rw)
      x += rw
      return rect
    })
    .join('')
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="6" viewBox="0 0 ${w} 6">` +
    `<clipPath id="m"><rect width="${w}" height="6" rx="3"/></clipPath>` +
    (runs.some(r => r.color === HEAT_FILL)
      ? `<linearGradient id="heat" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${w}" y2="0">` +
        HEAT_RAMP.map((c, i) => `<stop offset="${(i * 100) / (HEAT_RAMP.length - 1)}%" stop-color="${c}"/>`).join('') +
        `</linearGradient>`
      : '') +
    `<g clip-path="url(#m)"><rect width="${w}" height="6" fill="${SVG_ROLE.subtle}" fill-opacity="0.35"/>${rects}</g></svg>`
  return { source, widths }
}

// ---------------------------------------------------------------- formatting

/** `claude-opus-5-5` → `Opus 5.5`; anything else is shown as given. */
/**
 * A model id as people say it, from any provider's spelling: `claude-opus-5-5[1m]` → `Opus 5.5 1M`,
 * `us.anthropic.claude-sonnet-4-5-20250929-v1:0` → `Sonnet 4.5`, `claude-3-5-haiku-20241022` →
 * `Haiku 3.5`. Anything else is shown as given, cut to 22 characters.
 */
export const prettyModel = (id: string) => {
  if (!id) return '—'
  const cap = (f: string) => f.charAt(0).toUpperCase() + f.slice(1)
  const big = /\[1m\]|-1m\b/i.test(id) ? ' 1M' : ''
  const now = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?![\d])/i.exec(id)
  if (now?.[1] && !/^\d/.test(now[1])) return `${cap(now[1].toLowerCase())} ${now[2]}${now[3] ? `.${now[3]}` : ''}${big}`
  const old = /claude-(\d+)(?:-(\d))?-([a-z]+)/i.exec(id)
  if (old?.[3]) return `${cap(old[3].toLowerCase())} ${old[1]}${old[2] ? `.${old[2]}` : ''}${big}`
  return shorten(id, 22)
}

/** One line cut to `n` terminal cells, `…` last when cut. */
export const shorten = (s: string, n: number) => clip(s.replace(/\s+/g, ' ').trim(), n)

/** `950`, `13.7k`, `640k`, `1.0M`: the shared count format. */
export const kTokens = count

/** `1.4s`, `42s`, `2m 05s`, `3h 12m`: the shared duration format. */
export const fmtDuration = duration

/** A running clock as the live cards draw it: m:ss, or XhYY past an hour. */
export const fmtTimer = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

export const fmtClock = (ms: number) => (ms > 0 ? new Date(ms).toTimeString().slice(0, 8) : '--:--:--')

/** `1 error`, `2 errors`. */
export const plural = (n: number, word: string) => sharedPlural(n, word)

export const fmtUsd = usd

/**
 * How soon a request began to answer: from when it was sent to its first piece of response; null when
 * none came. No output rate: the reported tokens include thinking, which may arrive unstreamed before
 * that first piece, so tokens over the visible stream read in the thousands per second.
 */
export const stepSpeed = (sentAt: number, firstAt: number | null) => (firstAt === null ? null : { ttftMs: Math.max(0, firstAt - sentAt) })

/** `ttft 0.8s`. */
export const fmtSpeed = (s: { ttftMs: number }) => `ttft ${(s.ttftMs / 1000).toFixed(1)}s`

/** The compaction window a context breakdown reports: its `rawMaxTokens` when auto-compaction is on and that is smaller than the model's `window`; else null. */
export const compactWindowOf = (b: { rawMaxTokens: number; isAutoCompactEnabled: boolean } | null | undefined, window: number): number | null =>
  b && b.isAutoCompactEnabled && b.rawMaxTokens > 0 && b.rawMaxTokens < window ? b.rawMaxTokens : null

/**
 * What the context gauge measures: the compaction window when one is set smaller than the model's,
 * else the model's window, and the fill of it from the real `tokens` reading. No gauge (null) without one.
 */
export const contextFill = (u: Pick<Usage, 'tokens' | 'window' | 'compactWindow'>): { pct: number | null; window: number } => {
  const window = u.compactWindow !== null && u.compactWindow > 0 && u.compactWindow < u.window ? u.compactWindow : u.window
  return { window, pct: u.tokens !== null && window > 0 ? (u.tokens * 100) / window : null }
}

/** Reads of the compaction window that may miss (no session bound yet) before a model window stops asking. */
export const COMPACT_TRIES = 3

/**
 * A measurement of model window `window`: whether it reads the compaction window (not read for this
 * window yet, fewer than COMPACT_TRIES misses), and the usage with that read claimed. A new window
 * starts its misses afresh.
 */
export const claimCompactRead = (u: Usage, window: number): { usage: Usage; isClaimed: boolean } => {
  const misses = u.window === window ? u.compactMisses : 0
  const isClaimed = window > 0 && u.compactFor !== window && misses < COMPACT_TRIES
  return { usage: { ...u, compactFor: isClaimed ? window : u.compactFor, compactMisses: misses }, isClaimed }
}

/**
 * The usage after a compaction-window read for model window `window`. Dropped when a newer claim took
 * its place (a model switch); a read that failed or came back with no breakdown is a miss, asked
 * again at the next measurement.
 */
export const afterCompactRead = (
  u: Usage,
  window: number,
  b: { rawMaxTokens: number; isAutoCompactEnabled: boolean } | null | undefined,
): Usage =>
  u.compactFor !== window
    ? u
    : b
      ? { ...u, compactWindow: compactWindowOf(b, window), compactMisses: 0 }
      : { ...u, compactWindow: null, compactFor: 0, compactMisses: u.compactMisses + 1 }

/** A new main-loop model may compact in another window (`modelSettings`): read afresh at the next measurement. */
export const forgetCompactRead = (u: Usage): Usage => ({ ...u, compactWindow: null, compactFor: 0, compactMisses: 0 })

/** A gauge of `width` cells, drawn as the statusline draws its bars: ━ filled, ╸ a half, ─ empty. */
export const gauge = (pct: number, width: number) => {
  const m = meter(pct, width)
  return { on: m.fill, off: m.track }
}

/** Which of `heat`'s three levels a fill reads at: the accent, then the warning colour from 60%, the error colour from 80%. */
export const heatOf = (pct: number): 'calm' | 'warm' | 'hot' => {
  const shown = wholePct(pct)
  return shown >= 80 ? 'hot' : shown >= 60 ? 'warm' : 'calm'
}

/** A rate-limit reading as the pane keeps it, its ISO reset time turned into ms since the epoch. */
export const limitOf = (r: { kind: string; percentUsed: number; resetsAt?: string }) => {
  const at = r.resetsAt ? Date.parse(r.resetsAt) : NaN
  return { kind: r.kind, pct: r.percentUsed, resetsAt: Number.isFinite(at) ? at : null }
}

/** Time left until a window resets, its two largest units: `25m`, `3h10m`, `4d2h`; empty when unknown or past. */
export const fmtResetIn = (resetsAt: number | null | undefined, now: number) =>
  resetsAt === null || resetsAt === undefined ? '' : span(resetsAt - now)


/** The wall-clock time a window resets, as the statusline shows it: `14:32`, or `Thu 09:15` a day or more out. */
export const fmtResetAt = (resetsAt: number | null | undefined, now: number) => clockAt(resetsAt, now)

/**
 * How `width` cells of a bar split between `counts`: in proportion, every non-zero count keeping at least
 * one cell while the width allows, the cells left over going to the counts furthest below their share. All zeros: none.
 */
export const segments = (counts: readonly number[], width: number): number[] => {
  const total = counts.reduce((a, b) => a + b, 0)
  if (total <= 0 || width <= 0) return counts.map(() => 0)
  const raw = counts.map(n => (n * width) / total)
  const out = raw.map((x, i) => ((counts[i] ?? 0) > 0 ? Math.max(1, Math.floor(x)) : 0))
  let left = width - out.reduce((a, b) => a + b, 0)
  const order = raw
    .map((x, i) => ({ rem: x - (out[i] ?? 0), i }))
    .filter(o => (counts[o.i] ?? 0) > 0)
    .sort((a, b) => b.rem - a.rem)
  for (let k = 0; left > 0; k = (k + 1) % order.length, left -= 1) {
    const i = order[k]?.i ?? 0
    out[i] = (out[i] ?? 0) + 1
  }
  // More non-zero counts than cells: the largest give theirs back.
  while (left < 0) {
    const i = out.indexOf(Math.max(...out))
    out[i] = (out[i] ?? 0) - 1
    left += 1
  }
  return out
}

/** A rate-limit window's short name: `five_hour` → `5h`, `seven_day_opus` → `7d opus`. */
// ---------------------------------------------------------------- the session folder, as the statusline reads it

/** The folder's own name: the last part of `dir`, either separator. */
export const folderOf = (dir: string) => dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || dir

/** `dir` as a file:/// link: forward slashes, one leading slash dropped (so `/home/x` and `C:/x` both read right), spaces encoded. */
export const fileUri = (dir: string) => `file:///${dir.replace(/\\/g, '/').replace(/^\//, '').replace(/ /g, '%20')}`

/** `git remote get-url origin` as an https link: `.git` dropped, `git@host:owner/repo` turned into `https://host/owner/repo`. */
export const remoteUrl = (raw: string) => {
  const url = raw.trim().replace(/\.git$/, '')
  const scp = /^[^@/]+@([^:/]+):(.+)$/.exec(url)
  return scp ? `https://${scp[1]}/${scp[2]}` : url
}

/**
 * `git status --porcelain=v2 --branch` read as the statusline reads it: the branch (a detached head as its
 * first 7 hex digits in brackets), untracked and newly added files as added, then modified and deleted.
 */
export const parseGitStatus = (out: string) => {
  let oid = ''
  let branch = ''
  let added = 0
  let modified = 0
  let deleted = 0
  for (const l of out.split(/\r?\n/)) {
    if (l.startsWith('# branch.oid ')) oid = l.slice('# branch.oid '.length)
    else if (l === '# branch.head (detached)') branch = `(${oid.slice(0, 7)})`
    else if (l.startsWith('# branch.head ')) branch = l.slice('# branch.head '.length)
    else if (l.startsWith('? ')) added += 1
    else if (/^[12u] /.test(l)) {
      const x = l[2]
      const y = l[3]
      if (x === 'A') added += 1
      if (x === 'M' || y === 'M') modified += 1
      if (x === 'D' || y === 'D') deleted += 1
    }
  }
  return { branch, added, modified, deleted }
}

export const limitLabel = (kind: string) =>
  kind
    .replace(/five[_ -]?hours?/i, '5h')
    .replace(/seven[_ -]?days?/i, '7d')
    .replace(/[_-]+/g, ' ')
    .trim()

// ---------------------------------------------------------------- redaction

const SECRETS: [RegExp, string][] = [
  [/(authorization\s*[:=]\s*)(bearer\s+|basic\s+)?\S+/gi, '$1$2•••'],
  [/\b(bearer)\s+[A-Za-z0-9._~+/-]{8,}=*/gi, '$1 •••'],
  [/\b(sk|pk|rk|ghp|gho|ghs|github_pat|xox[abprs])[-_][A-Za-z0-9_-]{8,}/g, '•••'],
  [/((?:api[_-]?key|access[_-]?token|token|secret|password|passwd|pwd)\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1•••'],
  [/(--(?:token|password|api-key|secret)[= ])\S+/gi, '$1•••'],
  [/(\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)=)\S+/g, '$1•••'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s@]+@/gi, '$1•••@'],
]

/** What the gate drill-down may store: credentials masked before anything is written to state. */
export const redact = (s: string) => SECRETS.reduce((t, [re, to]) => t.replace(re, to), s)

// ---------------------------------------------------------------- tools and gate

const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit', 'Glob', 'Grep'])
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])
export const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

export const bucketOf = (tool: string): Bucket =>
  FILE_TOOLS.has(tool) ? 'file' : SHELL_TOOLS.has(tool) ? 'shell' : 'other'

/** One line saying what a call was about: its command, path or pattern; redacted. */
export const describeInput = (tool: string, input: unknown) => {
  const i = isObject(input) ? input : {}
  const path = typeof i.file_path === 'string' ? i.file_path.split(/[\\/]/).slice(-2).join('/') : ''
  const what =
    typeof i.command === 'string'
      ? i.command
      : path || (typeof i.pattern === 'string' ? i.pattern : typeof i.url === 'string' ? i.url : typeof i.description === 'string' ? i.description : '')
  return redact(what ? `${tool} → ${what}` : tool)
}

/** Keeps the last `max` checks, but never drops a pending ask: its settle must still find it. */
export const trimRecent = (list: Check[], max: number): Check[] => {
  let extra = list.length - max
  if (extra <= 0) return list
  const out: Check[] = []
  for (const c of list) {
    if (extra > 0 && c.verdict !== 'ask') {
      extra -= 1
      continue
    }
    out.push(c)
  }
  return out.slice(-max * 2)
}

export const recordCheck = (g: Gate, c: Check): Gate => {
  const t = g.totals[c.bucket]
  return {
    recent: trimRecent([...g.recent, c], 80),
    totals: { ...g.totals, [c.bucket]: { ...t, [c.verdict]: t[c.verdict] + 1 } },
  }
}

/** An `ask` settled by the call that followed it: it ran (cleared) or was refused (deny). */
export const settleCheck = (g: Gate, id: string, didRun: boolean): Gate => {
  const c = g.recent.find(r => r.id === id && r.verdict === 'ask')
  if (!c) return g
  const verdict = didRun ? 'cleared' : 'deny'
  const t = g.totals[c.bucket]
  return {
    recent: g.recent.map(r => (r === c ? { ...r, verdict } : r)),
    totals: { ...g.totals, [c.bucket]: { ...t, ask: Math.max(0, t.ask - 1), [verdict]: t[verdict] + 1 } },
  }
}

export const gateSummary = (g: Gate) => {
  const all = (['file', 'shell', 'other'] as const).reduce(
    (s, k) => ({
      rule: s.rule + g.totals[k].rule,
      ask: s.ask + g.totals[k].ask,
      cleared: s.cleared + g.totals[k].cleared,
      deny: s.deny + g.totals[k].deny,
    }),
    { ...ZERO },
  )
  return { ...all, total: all.rule + all.ask + all.cleared + all.deny }
}

// ---------------------------------------------------------------- turn and architect

/**
 * The turn after one tool call. Errors count in the main loop only (a subagent's failure is its
 * own); edits count from every loop, so delegated work still reaches "before done".
 */
export const afterCall = (t: Turn, c: { inSubagent: boolean; hasFailed: boolean; isEdit: boolean }): Turn => ({
  ...t,
  errorStreak: c.inSubagent ? t.errorStreak : c.hasFailed ? t.errorStreak + 1 : 0,
  errors: t.errors + (!c.inSubagent && c.hasFailed ? 1 : 0),
  edits: t.edits + (c.isEdit ? 1 : 0),
})

/** Which of the architect's three moments a consult falls at: an inference over this turn so far. */
export const momentOf = (t: Pick<Turn, 'edits' | 'errorStreak'>): Moment =>
  t.errorStreak >= 2 ? 'error repeats' : t.edits === 0 ? 'before a plan' : 'before done'

export const startConsult = (a: Architect, c: { id: string; at: number; moment: Moment; via: string }): Architect =>
  a.consults.some(x => x.id === c.id) ? a : { ...a, consults: [...a.consults, { ...c, endAt: null }].slice(-40) }

/** Ends the open consult (the latest without an end), or the one named. */
export const endConsult = (a: Architect, at: number, advice: string | null, id?: string): Architect => {
  const open = [...a.consults].reverse().find(c => c.endAt === null && (id === undefined || c.id === id))
  return {
    ...a,
    consults: a.consults.map(c => (c === open ? { ...c, endAt: at } : c)),
    lastAdvice: advice ?? a.lastAdvice,
  }
}

export const isAdvising = (a: Architect) => a.consults.some(c => c.endAt === null)

/** A one-row timeline of consults across `width` cells: ◆ a consult, ━ while it ran. */
export const consultTimeline = (a: Architect, now: number, width: number) => {
  if (a.consults.length === 0 || width < 4) return '─'.repeat(Math.max(0, width))
  const first = a.consults[0]?.at ?? now
  const span = Math.max(1, now - first)
  const cells = Array.from({ length: width }, () => '─')
  for (const c of a.consults) {
    const from = Math.min(width - 1, Math.floor(((c.at - first) / span) * (width - 1)))
    const to = Math.min(width - 1, Math.floor((((c.endAt ?? now) - first) / span) * (width - 1)))
    for (let i = from + 1; i <= to; i += 1) cells[i] = '━'
    cells[from] = '◆'
  }
  return cells.join('')
}

export const receiptOf = (t: Turn, o: { durationMs: number; agentsSince: number; costNow: number | null; reason: string }): Receipt => ({
  durationMs: o.durationMs,
  agents: o.agentsSince,
  edits: t.edits,
  errors: t.errors,
  costDelta: o.costNow !== null && t.costAtStart !== null && o.costNow - t.costAtStart >= 0.005 ? o.costNow - t.costAtStart : null,
  reason: o.reason,
})

// ---------------------------------------------------------------- agents and loops

type StepUsage = { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; output_tokens?: number } | null

/** A card after one of its model requests: its context is the latest step's whole input; output adds up. */
export const applyStep = (c: AgentCard, s: { model: string; usage: StepUsage; stopReason: string | null }): AgentCard => {
  const u = s.usage ?? {}
  const ctx = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
  return {
    ...c,
    model: c.model || s.model,
    steps: c.steps + 1,
    ctx: ctx > 0 ? ctx : c.ctx,
    out: c.out + (u.output_tokens ?? 0),
    lastStop: s.stopReason,
  }
}

export const noteTool = (c: AgentCard, n: ToolNote): AgentCard => ({ ...c, tools: [...c.tools, n].slice(-3) })

/** A surface module's fault key, `desktop:rail.tsx`, from `hooks/rail.tsx` or `hooks\rail.tsx` alike. */
export const faultKey = (surface: string, module: string) => `${surface}:${module.split(/[\\/]/).pop()}`

/** A card whose agent was resumed after it finished (SendMessage): running again, its clock from its first spawn. */
export const resumeCard = (c: AgentCard): AgentCard => ({ ...c, status: 'running', endedAt: null })

/**
 * A spawned card joins the list. An id already there is that agent resumed: its card runs again
 * where it stands, with its tallies and the new task and model, so no two cards share keys.
 */
export const addCard = (cards: AgentCard[], card: AgentCard): AgentCard[] =>
  cards.some(c => c.id === card.id)
    ? cards.map(c => (c.id === card.id ? resumeCard({ ...c, description: card.description || c.description, model: card.model || c.model }) : c))
    : [...cards, card].slice(-24)

export const stepLoop = (loops: Loop[], id: string, at: number): Loop[] => {
  const found = loops.find(l => l.id === id)
  const next = found
    ? loops.map(l => (l === found ? { ...l, steps: l.steps + 1, lastAt: at } : l))
    : [...loops, { id, steps: 1, firstAt: at, lastAt: at, isDone: false }]
  return next.slice(-60)
}

export const LOOP_ACTIVE_MS = 15_000
export const isLoopActive = (l: Loop, now: number) => !l.isDone && now - l.lastAt < LOOP_ACTIVE_MS

/** Swimlane geometry: each agent's bar on one shared axis from the first spawn to now. */
export const lanes = (cards: AgentCard[], now: number, width: number) => {
  const start = Math.min(...cards.map(c => c.spawnedAt).filter(n => n > 0), now)
  const span = Math.max(1, now - start)
  return cards.map(c => {
    const from = Math.floor(((Math.max(c.spawnedAt, start) - start) / span) * width)
    const to = Math.max(from + 1, Math.ceil((((c.endedAt ?? now) - start) / span) * width))
    return { id: c.id, before: Math.min(from, width), bar: Math.min(to, width) - Math.min(from, width), after: width - Math.min(to, width) }
  })
}

// ---------------------------------------------------------------- layout

/** How many log lines fit: what the other panels leave, never fewer than 4 nor more than 8. */
export const logRows = (bodyRows: number, used: number) => Math.max(4, Math.min(8, bodyRows - used - 3))

/** Legend items that fit on one row of `width` cells, in order; the rest are dropped. */
export const fitLegend = <T extends { label: string }>(items: T[], width: number) => {
  const out: T[] = []
  let used = 0
  for (const it of items) {
    const w = it.label.length + 4
    if (used + w > width) break
    out.push(it)
    used += w
  }
  return out
}

/**
 * How a block's label row `label    right` shares `width` cells: the label keeps what the right-hand
 * status and its gap leave. The status is dropped when it would cut the label below 6 cells (or below
 * its own length, if shorter).
 */
export const headFit = (width: number, labelW: number, rightW: number) => {
  const showRight = rightW > 0 && width - 1 - rightW >= Math.min(labelW, 6)
  return { label: Math.max(1, Math.min(labelW, width - (showRight ? 1 + rightW : 0))), showRight }
}

/** A connector of `width` cells: `mark` at each of `marks`, ─ elsewhere. */
export const ruleLine = (width: number, marks: readonly number[] = [], mark = '┴') =>
  Array.from({ length: Math.max(1, width) }, (_, i) => (marks.includes(i) ? mark : '─')).join('')

/** The cells a string takes in a terminal: CJK and emoji two, combining marks none. */
export { cellWidth }

/**
 * How many pieces of a line fit in `room` cells, in order from the start: each piece is `lead` extra cells
 * then `width`, and pieces sit `gap` cells apart. The rest are left out, as the legend's items are.
 */
export const piecesThatFit = (pieces: readonly { width: number; lead?: number }[], room: number, gap: number) => {
  let used = 0
  for (let i = 0; i < pieces.length; i += 1) {
    const p = pieces[i]!
    const next = used + (i > 0 ? gap : 0) + (p.lead ?? 0) + p.width
    if (next > room) return i
    used = next
  }
  return pieces.length
}

/**
 * How many marks (● ✓ ○) a row of `cells` columns holds. A terminal draws each mark in one
 * cell; a graphical surface draws them wider (■ measured about 1.4 cells on the desktop app), so
 * there a row holds fewer and its newest marks still show.
 */
export const marksIn = (cells: number, isTerminal: boolean) => (isTerminal ? cells : Math.floor(cells / 1.5))

/** A card's title row: the task in the agent's own words, the type only when there is none. */
export const cardTitle = (c: AgentCard) => c.description || c.type

/** A title split over two rows at a word boundary: `first` cells on row one, `rest` on row two. */
export const titleLines = (title: string, first: number, rest: number): [string, string] => {
  const t = title.replace(/\s+/g, ' ').trim()
  if (t.length <= first) return [t, '']
  const cut = t.lastIndexOf(' ', first)
  const at = cut > 0 ? cut : first
  return [t.slice(0, at).trim(), shorten(t.slice(at), rest)]
}

/**
 * What a turn's opening text was, for the log: the person's words, or for a turn the engine
 * opened with a tagged message (a subagent's hand-back, a task notification), that message's kind.
 */
export const promptLine = (text: string): { who: string; text: string } => {
  const tag = /^\s*<([a-z][\w-]*)/i.exec(text)?.[1]
  if (!tag) return { who: 'you', text: shorten(text, 70) }
  const from = /\bfrom="([^"]+)"/.exec(text)?.[1]
  return { who: 'engine', text: shorten(`${tag.replace(/[-_]/g, ' ')}${from ? ` from ${from.slice(0, 8)}` : ''}`, 70) }
}

/**
 * A subagent's hand-back message: who sent it and the first line of what it said. The report
 * follows a framing header in the message; without one, the first line after the opening tag.
 */
export const handbackOf = (text: string): { from: string; body: string } | null => {
  const from = /^\s*<agent-message\s+from="([^"]+)"/.exec(text)?.[1]
  if (!from) return null
  const afterHeader = text.split(/The report follows:\s*\n/)[1]
  const rest = afterHeader ?? text.replace(/^\s*<agent-message[^>]*>/, '')
  const body =
    rest
      .split('\n')
      .map(l => l.trim())
      .find(l => l && !l.startsWith('[') && !l.startsWith('<') && !l.startsWith('</')) ?? ''
  return body ? { from, body } : null
}

/** The advice line a pane shows for a report: its first real line, markdown markers stripped, cut to 160. */
export const adviceLine = (report: string) => {
  const first = report.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('[') && !l.startsWith('<')) ?? ''
  return shorten(first.replace(/\*\*|__/g, '').replace(/^[#>*\s-]+/, ''), 160)
}

export const elapsedOf = (c: AgentCard, now: number) => (c.endedAt ?? now) - c.spawnedAt

// ---------------------------------------------------------------- trends, context split, inbox

/** Finished main turns the trend sparklines keep. */
export const TREND_MAX = 30

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export const normalizeTrend = (stored: unknown): TrendPoint[] =>
  listOf<unknown>(stored)
    .filter(isObject)
    .map(p => ({ at: num(p.at) ?? 0, ctx: num(p.ctx), cost: num(p.cost), ms: num(p.ms) ?? 0, out: num(p.out) }))
    .slice(-TREND_MAX)

export const pushTrend = (list: readonly TrendPoint[], p: TrendPoint): TrendPoint[] => [...list, p].slice(-TREND_MAX)

/** The sparkline's eight levels, low to high, and the ASCII stand-ins `glyphs: text` draws. */
export const SPARK = '▁▂▃▄▅▆▇█'
export const SPARK_ASCII = ascii(SPARK)

/**
 * Each value's level, 0 to 7, against `max` (a percentage passes 100; else the series' own largest), so the
 * baseline is always zero. Zero is level 0; above zero at least level 1, as a meter never draws a reading
 * above zero empty; null (not known) stays null. A flat series draws flat: all 7, or all 0 when zero.
 */
export const sparkLevels = (values: readonly (number | null)[], max?: number): (number | null)[] => {
  const top = max ?? Math.max(0, ...values.map(v => v ?? 0))
  return values.map(v => (v === null ? null : v <= 0 || top <= 0 ? 0 : Math.min(7, Math.max(1, Math.round((Math.min(v, top) / top) * 7)))))
}

/**
 * A sparkline as SVG for a graphical surface: one bar per value, `cells` wide at 7 pixels a cell as the
 * meters are, each bar's height its level over 7 (level 0 a one-pixel baseline, null none). A bar whose
 * height changed since the last drawing (`before`) glides there on the meters' 400 ms ease-out; `isStill` drops it.
 */
export const svgSpark = (levels: readonly (number | null)[], colors: readonly string[], cells: number, before: readonly number[], isStill: boolean) => {
  const CELL = 7
  const H = 12
  const w = Math.max(1, cells) * CELL
  const heights: number[] = []
  const bars = levels
    .map((lv, i) => {
      const h = lv === null ? 0 : Math.max(1, Math.round((lv / 7) * H * 100) / 100)
      heights.push(h)
      if (lv === null) return ''
      const from = before[i]
      const anim = (attr: string, a: number, b: number) =>
        `<animate attributeName="${attr}" from="${a}" to="${b}" dur="0.4s" calcMode="spline" keyTimes="0;1" keySplines="0.33 1 0.68 1" fill="freeze"/>`
      const top = (x: number) => Math.round((H - x) * 100) / 100
      const glide = !isStill && from !== undefined && from !== h ? anim('height', from, h) + anim('y', top(from), top(h)) : ''
      return `<rect x="${i * CELL + 0.5}" y="${top(h)}" width="${CELL - 1}" height="${h}" rx="1" fill="${svgColor(colors[i])}">${glide}</rect>`
    })
    .join('')
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${H}" viewBox="0 0 ${w} ${H}">${bars}</svg>`, heights }
}

/**
 * The context window by category from a breakdown: its `used` rows with tokens, largest first, against the
 * window it measures. Free space, the compaction buffer and deferred tool schemas are not content; null without a breakdown.
 */
export const splitOf = (
  b: { categories: readonly { name: string; tokens: number; color: string; kind: string }[]; rawMaxTokens: number } | null | undefined,
  at: number,
): Split | null =>
  b && Array.isArray(b.categories) && b.rawMaxTokens > 0
    ? {
        rows: b.categories
          .filter(c => c.kind === 'used' && c.tokens > 0)
          .map(c => ({ name: c.name, tokens: c.tokens, color: c.color }))
          .sort((x, y) => y.tokens - x.tokens),
        window: b.rawMaxTokens,
        at,
      }
    : null

/** A category's short name for the legend: `System prompt` → `system prompt`, cut at 14 cells. */
export const splitLabel = (name: string) => shorten(name.toLowerCase(), 14)

/** Tools the timing table keeps, the most time-consuming first. */
export const TOOLS_MAX = 40

export const normalizeTools = (stored: unknown): ToolStat[] =>
  listOf<unknown>(stored)
    .filter(isObject)
    .map(x => ({
      name: String(x.name ?? ''),
      calls: num(x.calls) ?? 0,
      fails: num(x.fails) ?? 0,
      totalMs: num(x.totalMs) ?? 0,
      maxMs: num(x.maxMs) ?? 0,
    }))
    .filter(x => x.name && x.calls > 0)

/** `stats` with one more call of `name` that took `ms`, failed or not; the most time-consuming first, at most TOOLS_MAX. */
export function noteToolTime(stats: readonly ToolStat[], name: string, ms: number, hasFailed: boolean): ToolStat[] {
  const t = Math.max(0, Math.round(ms))
  const had = stats.find(x => x.name === name)
  const next: ToolStat = had
    ? { ...had, calls: had.calls + 1, fails: had.fails + (hasFailed ? 1 : 0), totalMs: had.totalMs + t, maxMs: Math.max(had.maxMs, t) }
    : { name, calls: 1, fails: hasFailed ? 1 : 0, totalMs: t, maxMs: t }
  return [next, ...stats.filter(x => x.name !== name)].sort((a, b) => b.totalMs - a.totalMs).slice(0, TOOLS_MAX)
}

/** A tool's name for the table: an MCP tool as `server·tool` (`mcp__fxhoudini__get_frame` reads `fxhoudini·get_frame`). */
export const toolLabel = (name: string) => {
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(name)
  return m ? `${m[1]}·${m[2]}` : name
}

/** Items the inbox keeps. */
export const INBOX_MAX = 40

export const normalizeInbox = (stored: unknown): InboxItem[] =>
  listOf<unknown>(stored)
    .filter(isObject)
    .map(x => ({
      id: String(x.id ?? ''),
      at: num(x.at) ?? 0,
      source: (['tool', 'denied', 'api', 'turn', 'mod'] as const).find(k => k === x.source) ?? 'tool',
      text: String(x.text ?? ''),
      target: typeof x.target === 'string' ? x.target : null,
    }))

/** An item joins the inbox once: a call refused by a rule and then by its tool.call is one item, the first. */
export const addInbox = (list: readonly InboxItem[], item: InboxItem): InboxItem[] =>
  list.some(x => x.id === item.id) ? [...list] : [...list, item].slice(-INBOX_MAX)

/** The `n` newest items, newest first; items of the same time keep their arrival order reversed. */
export const inboxNewest = (list: readonly InboxItem[], n: number): InboxItem[] =>
  list
    .map((x, i) => ({ x, i }))
    .sort((a, b) => b.x.at - a.x.at || b.i - a.i)
    .slice(0, Math.max(0, n))
    .map(o => o.x)

/** Where an inbox row jumps: its call's row in the transcript, centred; null when it has none. */
export const jumpTo = (item: Pick<InboxItem, 'target'>) => (item.target ? { to: { requestId: item.target }, block: 'center' as const } : null)

/** The first line of an error text, redacted and cut to `n` cells. */
export const errorLine = (text: string | undefined, n = 120) => shorten(redact((text ?? '').split(/\r?\n/).find(l => l.trim()) ?? ''), n)
