// The healkeiser mods' shared design tokens: colour roles, glyphs, formatters
// and motion. DESIGN.md says why. The source is shared/style.ts; each mod
// keeps a copy (a plugin cannot import from another), written by
// `node scripts/check-style.mjs --write`, and the check fails when one drifts.
// Edit shared/, never a mod's copy.

// ---------------------------------------------------------------- colour roles

/** One meaning per role, each a theme key so it follows the person's theme. */
export const ROLE = {
  accent: 'claude',
  you: 'suggestion',
  command: 'merged',
  agent: 'planMode',
  info: 'ide',
  success: 'success',
  warning: 'warning',
  error: 'error',
  chrome: 'subtle',
  muted: 'inactive',
  chip: 'userMessageBackground',
} as const

// ---------------------------------------------------------------- glyphs

/** Single-cell, text-presentation glyphs; emoji-capable ones carry U+FE0E. */
export const GLYPH = {
  ok: '✓',
  fail: '✕',
  live: '●',
  idle: '○',
  mark: '■',
  bullets: ['•', '◦', '■'],
  stop: '‖',
  reset: '↻',
  compact: '⟲',
  key: '◆',
  keyOff: '◇',
  next: '»',
  more: '…',
  dot: '·',
  fill: '━',
  half: '╸',
  track: '─',
  bar: '│',
  external: '↗︎',
  warn: '⚠︎',
  info: 'ℹ︎',
} as const

/**
 * ASCII stand-ins for the `glyphs: text` option, one cell each so every width
 * holds: each glyph DESIGN.md names, the folds, the box corners and the spinner.
 */
export const ASCII: Readonly<Record<string, string>> = Object.fromEntries(
  // Pairs: a glyph, then its stand-in. Keys only, never drawn as they stand.
  [...'×x✓v✕x✗x●*○o■#•*◦-‖|↻@⟲<◆+◇-»>…~·-━=╸:─-│|┃|╭+╮+╰+╯+┬+┴+├+┼+┤+↗^⚠!ℹi→>—-⧉+▾v▴^▸>⌕?⌘/⇣v⇡^⠋|⠙/⠹-⠸\\⠼|⠴/⠦-⠧\\⠇|⠏/▁_▂.▃:▄-▅=▆+▇*█#◂<'].flatMap((c, i, all) => (i % 2 ? [] : [[c, all[i + 1]!]])), // glyph-lint-ignore
)

/** `s` with every glyph in `ASCII` swapped for its stand-in, variation selectors dropped. */
export const ascii = (s: string): string => [...s.replace(/[︎️]/g, '')].map(c => ASCII[c] ?? c).join('')

/** The `glyphs` option: `text` draws ASCII; `auto` and `plain` draw the Unicode set (these mods have no Nerd Font set). */
export const isAsciiGlyphs = (option: unknown): boolean => option === 'text'

// Elements whose text is content or a picture, never a glyph of ours.
const KEEP_TEXT = new Set(['Code', 'Markdown', 'Svg', 'Client', 'Raster', 'Image', 'Input', 'Select'])

/**
 * A drawn tree for `glyphs: text`: every text and label through `ascii`, and
 * rounded or bold borders drawn `classic` (`+`, `-`, `|`). Code, Markdown,
 * pictures and fields keep what they hold.
 */
export function asciiTree<T>(node: T): T {
  if (typeof node === 'string') return ascii(node) as T
  if (Array.isArray(node)) return node.map(asciiTree) as T
  if (node === null || typeof node !== 'object') return node
  const el = node as { type?: unknown; props?: Record<string, unknown>; children?: unknown }
  if (typeof el.type === 'string' && KEEP_TEXT.has(el.type)) return node
  const props = el.props && {
    ...el.props,
    ...(typeof el.props.label === 'string' ? { label: ascii(el.props.label) } : {}),
    ...(el.props.borderStyle === 'round' || el.props.borderStyle === 'bold' ? { borderStyle: 'classic' } : {}),
    ...(el.props.children !== undefined ? { children: asciiTree(el.props.children) } : {}),
  }
  return { ...el, ...(props ? { props } : {}), ...(el.children !== undefined ? { children: asciiTree(el.children) } : {}) } as T
}

/** ` · `, the separator inside cards and headers; bands use two spaces a side. */
export const SEP = ` ${GLYPH.dot} `

/**
 * Emoji-capable glyphs in `text` that lack U+FE0E after them, which some
 * terminals (Warp, Windows Terminal) draw as two-cell colour emoji. ASCII
 * (`#`, `*`, digits) and the joiners themselves are left out.
 */
export function bareEmoji(text: string): string[] {
  const found: string[] = []
  const chars = [...text]
  chars.forEach((ch, i) => {
    const cp = ch.codePointAt(0) ?? 0
    if (cp < 0x80 || cp === 0xfe0e || cp === 0xfe0f || cp === 0x200d || cp === 0x20e3) return
    if (/\p{Emoji}/u.test(ch) && chars[i + 1] !== '︎') found.push(ch)
  })
  return found
}

// ---------------------------------------------------------------- cells

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

/** Grapheme clusters, so a cut never splits a character or its marks. */
export const graphemes = (s: string): string[] => (segmenter ? [...segmenter.segment(s)].map(x => x.segment) : [...s])

const WIDE: [number, number][] = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf],
  [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f300, 0x1f64f], [0x1f900, 0x1f9ff], [0x20000, 0x3fffd],
]
const isWide = (cp: number) => WIDE.some(([a, b]) => cp >= a && cp <= b)

/** The cells one grapheme takes in a terminal: 0, 1 or 2. */
export function graphemeWidth(g: string): number {
  if (g.includes('︎')) return 1
  if (g.includes('️')) return 2
  const cp = g.codePointAt(0) ?? 0
  if (cp === 0 || /^[\p{Mn}\p{Me}\p{Cf}]/u.test(g)) return 0
  if (cp < 0x7f) return cp < 0x20 ? 0 : 1
  return isWide(cp) || /\p{Emoji_Presentation}/u.test(g) ? 2 : 1
}

/** The cells a string takes in a terminal. */
export const cellWidth = (s: string): number => graphemes(s).reduce((n, g) => n + graphemeWidth(g), 0)

/** The longest head of `s` that fits `width` cells, and what is left. */
export function cutCells(s: string, width: number): [string, string] {
  const gs = graphemes(s)
  let used = 0
  let i = 0
  for (; i < gs.length; i++) {
    const w = graphemeWidth(gs[i]!)
    if (used + w > width) break
    used += w
  }
  return [gs.slice(0, i).join(''), gs.slice(i).join('')]
}

/** `s` cut to `width` cells, `…` last when cut. */
export function clip(s: string, width: number): string {
  if (cellWidth(s) <= width) return s
  if (width <= 0) return ''
  return `${cutCells(s, width - 1)[0].trimEnd()}${GLYPH.more}`
}

/** `s` padded with spaces to `width` cells (never cut). */
export const padCells = (s: string, width: number, align: 'left' | 'right' = 'left') => {
  const pad = ' '.repeat(Math.max(0, width - cellWidth(s)))
  return align === 'right' ? pad + s : s + pad
}

// ---------------------------------------------------------------- formats

/** `1.4s` under ten seconds, then `42s`, `2m 05s`, `3h 12m`, `3d 4h`. */
export function duration(ms: number): string {
  if (ms < 9950) return `${(Math.max(0, ms) / 1000).toFixed(1)}s`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

/** Whole seconds as a running clock counts them: `42s`, `2m 05s`, `3h 12m`. */
export const seconds = (s: number): string => (s < 60 ? `${Math.max(0, Math.floor(s))}s` : duration(s * 1000))

/** Time left, its two largest units: `25m`, `4h 51m`, `3d 22h`; empty when unknown or past. */
export function span(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !(ms > 0)) return ''
  const m = Math.max(1, Math.floor(ms / 60_000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d > 0) return `${d}d ${h}h`
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`
}

/** `950`, `13.7k`, `640k`, `1.0M`. */
export function count(n: number): string {
  if (n >= 999_950) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 99_950) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

/**
 * A reading as shown, as the status line rounds it: to tenths, then to the
 * nearest whole, so `37.5` is `38` and the two never disagree.
 */
export const wholePct = (pct: number): number => Math.floor((Math.round(pct * 10) + 5) / 10)

/** `64%`. */
export const percent = (pct: number) => `${wholePct(pct)}%`

/** `$12.45`, `$140`. */
export const usd = (n: number) => (n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`)

/**
 * A title in sentence case, as every title is drawn (DESIGN.md, Capitalisation):
 * its first letter upper case, the rest as written, so `session log` reads
 * `Session log` and a name the person chose in capitals stays as they wrote it.
 */
export const sentence = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** `1 tool`, `3 tools`. */
export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`

// ---------------------------------------------------------------- limits

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** A wall-clock time: `HH:MM`, with the weekday when a day or more out (`Thu 14:41`); empty when unknown or past. */
export function clockAt(at: number | null | undefined, now: number): string {
  if (at === null || at === undefined || at <= now) return ''
  const d = new Date(at)
  const hm = d.toTimeString().slice(0, 5)
  return at - now >= 86_400_000 ? `${WEEKDAYS[d.getDay()]} ${hm}` : hm
}

/** Each rate-limit window's length, by the API's `kind`. */
export const LIMIT_WINDOW_MS: Readonly<Record<string, number>> = { five_hour: 5 * 3_600_000, seven_day: 7 * 86_400_000 }

/**
 * Pace, as statusline.sh reads it: how fast a limit is used against the clock,
 * 1 being on track to reach 100% exactly at the reset, above 1 an overrun.
 * Null in the first 5% of a window, where the ratio is noise, or when unknown.
 */
export function pace(pct: number, resetsAt: number | null | undefined, windowMs: number | undefined, now: number): number | null {
  if (!resetsAt || !windowMs) return null
  const elapsed = windowMs - (resetsAt - now)
  if (elapsed < windowMs / 20) return null
  return (pct * windowMs) / (elapsed * 100)
}

/**
 * Pace as the status line draws it: to tenths, half up, then `1.4×`, in chrome
 * on track, warning above 1.0×, error from 1.5× (the shown number decides, so
 * `1.0×` never alarms).
 */
export function paceLabel(p: number): { text: string; role: string } {
  const tenths = Math.floor(p * 10 + 0.5)
  return { text: `${Math.floor(tenths / 10)}.${tenths % 10}×`, role: tenths >= 15 ? ROLE.error : tenths > 10 ? ROLE.warning : ROLE.chrome }
}

/** A forecast as drawn beside a limit: `full 15:40`, in error (it comes before the reset, or it would not be drawn). */
export const forecastLabel = (at: number, now: number): string => `full ${at <= now ? 'now' : clockAt(at, now)}`

/**
 * When a limit reaches 100% at the pace it has gone since its window opened:
 * the time in ms, only when that comes before the reset; null otherwise (it
 * lasts, too early to tell, or nothing used). The status line forecasts the same.
 */
export function forecast(pct: number, resetsAt: number | null | undefined, windowMs: number | undefined, now: number): number | null {
  const p = pace(pct, resetsAt, windowMs, now)
  if (p === null || pct <= 0 || !resetsAt || !windowMs) return null
  if (pct >= 100) return now
  const elapsed = windowMs - (resetsAt - now)
  const at = now + ((100 - pct) * elapsed) / pct
  return at < resetsAt ? Math.round(at) : null
}

/** A meter's colour by how full it is: accent, then warning from 60%, error from 80%. */
export const heat = (pct: number): 'claude' | 'warning' | 'error' => {
  const shown = wholePct(pct)
  return shown >= 80 ? ROLE.error : shown >= 60 ? ROLE.warning : ROLE.accent
}

/**
 * The status line's 256-colour heat ramp (xterm 46 82 118 154 190 226 220 214
 * 208 196, green to yellow to red, one step per 10%) as those entries' hex, so
 * a 256-colour terminal draws them exactly.
 */
export const HEAT_RAMP = ['#00ff00', '#5fff00', '#87ff00', '#afff00', '#d7ff00', '#ffff00', '#ffd700', '#ffaf00', '#ff8700', '#ff0000'] as const
/** The ramp's unlit track, xterm 239. */
export const HEAT_UNLIT = '#4e4e4e'

/** The ramp step a reading takes, as the status line colours its percentage: its tens, 90% and up the last. */
export const heatHex = (pct: number): string => HEAT_RAMP[Math.max(0, Math.min(9, Math.floor(wholePct(pct) / 10)))]!

/**
 * A meter of `cells` as coloured runs: each lit cell the ramp step of where it
 * sits along the bar (so the last lit cell is the severity), the rest unlit.
 */
export function heatRuns(pct: number, cells: number): { text: string; color: string }[] {
  const { fill, track } = meter(pct, cells)
  const runs: { text: string; color: string }[] = []
  ;[...fill].forEach((ch, k) => {
    const color = HEAT_RAMP[Math.min(9, Math.floor((k * 10) / cells))]!
    const last = runs[runs.length - 1]
    if (last?.color === color) last.text += ch
    else runs.push({ text: ch, color })
  })
  return track ? [...runs, { text: track, color: HEAT_UNLIT }] : runs
}

/**
 * Whether a terminal draws the ramp. statusline.sh always draws it, so the mods
 * do too, except on the consoles known to lack 256 colours (`TERM` dumb, linux,
 * vt100, ansi). An unset `TERM` (Windows) draws it: every console there takes
 * 24-bit colour. Otherwise meters take `heat`'s three role colours.
 */
export const canRamp = (env: { COLORTERM?: string; TERM?: string; WT_SESSION?: string }): boolean =>
  /truecolor|24bit/i.test(env.COLORTERM ?? '') || !!env.WT_SESSION || !/^(dumb|linux|vt\d+|ansi|cons\d+)$/i.test(env.TERM ?? '')

/**
 * A meter of `cells` as the status line steps it: the filled run (`━`, a last
 * `╸` for half a cell) and the track `─`. Half-cell steps, rounded from the
 * reading in tenths; any reading above zero lights at least half a cell.
 */
export function meter(pct: number, cells: number): { fill: string; track: string } {
  const tenths = Math.round(pct * 10)
  const halves = Math.max(tenths > 0 ? 1 : 0, Math.min(cells * 2, Math.floor((tenths * cells * 2 + 500) / 1000)))
  const full = halves >> 1
  const half = halves & 1
  return { fill: GLYPH.fill.repeat(full) + (half ? GLYPH.half : ''), track: GLYPH.track.repeat(cells - full - half) }
}

/** The share of a graphical meter a reading fills, 0 to 1: proportional, and above zero at least half a cell of `cells`. */
export const meterShare = (pct: number, cells: number): number =>
  Math.round(pct * 10) > 0 ? Math.min(1, Math.max(0.5 / cells, pct / 100)) : 0

// ---------------------------------------------------------------- motion

/** One tick per mod: 10 frames a second, a third of the engine's redraw cap. */
export const FRAME_MS = 100

export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const

/** The spinner's frame at `tick`. */
export const spin = (tick: number) => SPINNER[((tick % SPINNER.length) + SPINNER.length) % SPINNER.length]!

/** Ease curves over t in [0, 1]. */
export const easeInOut = (t: number) => 0.5 - Math.cos(Math.PI * Math.min(1, Math.max(0, t))) / 2
export const easeOut = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3

/** A value gliding from `from` to `to` over `ms` (400 by default), `t` ms in. */
export const glide = (from: number, to: number, t: number, ms = 400) => from + (to - from) * easeOut(t / ms)

/**
 * The sweep: a soft band crossing `len` cells, eased in and out, one pass every
 * `len + 8` cells' worth of ticks at 1.6 cells a tick. Returns the ramp step
 * (0 rest to 3 brightest) cell `i` takes at `tick`; `i` -1 lights the whole run
 * with the band's centre.
 */
export function sweep(i: number, tick: number, len: number): 0 | 1 | 2 | 3 {
  const path = len + 8
  const ticks = Math.max(1, Math.round(path / 1.6))
  const at = easeInOut((tick % ticks) / ticks) * path - 4
  const d = i < 0 ? Math.abs(len / 2 - at) / Math.max(1, len / 4) : Math.abs(i - at)
  // Raised cosine over three cells either side: a glow, not an on/off blink.
  const glow = d >= 3 ? 0 : (1 + Math.cos((Math.PI * d) / 3)) / 2
  return glow > 0.6 ? 3 : glow > 0.3 ? 2 : glow > 0.08 ? 1 : 0
}

/** Packets along a rail of `width`: a `●` head and `•` trail every `gap` cells, one cell a tick. */
export function packets(width: number, tick: number, gap = 24): Map<number, string> {
  const lit = new Map<number, string>()
  for (let base = 0; base < width + gap; base += gap) {
    const head = (base + tick) % (width + gap)
    if (head < width) lit.set(head, GLYPH.live)
    if (head - 1 >= 0 && head - 1 < width) lit.set(head - 1, '•')
  }
  return lit
}

/** A label new for under `FADE_MS` draws dim, then normal. */
export const FADE_MS = 200
export const isFading = (ageMs: number) => ageMs >= 0 && ageMs < FADE_MS

/**
 * Whether motion runs: the mod's `motion` option is not `off`, and Claude Code's
 * Reduce motion setting (`/config`, row `reduceMotion`) is not on.
 */
export function motionOn(option: unknown, rows: readonly { key: string; value: unknown }[] = []): boolean {
  if (option === 'off' || option === false) return false
  return !rows.some(r => /^(reduceMotion|prefersReducedMotion)$/.test(r.key) && r.value === true)
}

// ---------------------------------------------------------------- memory

/** Sets `key` in `map`, dropping the oldest entries past `max`. */
export function remember<K, V>(map: Map<K, V>, key: K, value: V, max = 200): V {
  map.delete(key)
  map.set(key, value)
  while (map.size > max) map.delete(map.keys().next().value as K)
  return value
}
