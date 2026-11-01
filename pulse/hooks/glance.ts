// The band's figures: the ramp as SVG, the prompt cache's countdown, git's
// status, and which pieces of a one-line row fit.
import { HEAT_RAMP, HEAT_UNLIT, meterShare, seconds } from './style'

// ---------------------------------------------------------------- the ramp

/**
 * The ramp as an SVG meter for a graphical surface: a rounded track and the lit
 * part painted with one gradient through the ramp across the whole width, so a
 * cell sits on the same colour as in the terminal. A new reading glides from
 * `before` (pixels) on an ease-out over 400 ms as SMIL, so no tick runs;
 * `isStill` drops the glide. `title` is the hover tooltip.
 */
export function svgMeter(pct: number, cells: number, before: number | undefined, isStill: boolean, title: string) {
  const CELL = 7
  const w = cells * CELL
  const lit = Math.round(meterShare(pct, cells) * w)
  const stops = HEAT_RAMP.map((c, i) => `<stop offset="${((i + 0.5) / 10).toFixed(2)}" stop-color="${c}"/>`).join('')
  const glide =
    !isStill && before !== undefined && before !== lit
      ? `<animate attributeName="width" from="${before}" to="${lit}" dur="0.4s" calcMode="spline" keyTimes="0;1" keySplines="0.33 1 0.68 1" fill="freeze"/>`
      : ''
  const esc = title.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="6" viewBox="0 0 ${w} 6"><title>${esc}</title>` +
    `<defs><linearGradient id="r" x1="0" x2="${w}" gradientUnits="userSpaceOnUse">${stops}</linearGradient>` +
    `<clipPath id="m"><rect width="${w}" height="6" rx="3"/></clipPath></defs>` +
    `<g clip-path="url(#m)"><rect width="${w}" height="6" fill="${HEAT_UNLIT}" fill-opacity="0.35"/>` +
    `<rect width="${lit}" height="6" fill="url(#r)">${glide}</rect></g></svg>`
  return { source, width: lit }
}

// ---------------------------------------------------------------- the prompt cache

export const CACHE_5M = 5 * 60_000
export const CACHE_1H = 60 * 60_000

/**
 * How long the API keeps the session's cached prompt prefix after a request
 * uses it, or null with caching off. Claude Code's own switches first; else a
 * subscription (it reports rate-limit windows) gets the hour, an API key five
 * minutes. shortcut: the API does not say which TTL it applied; read it from
 * the engine if it ever reports it.
 */
export function cacheTtl(env: { disable?: string; force5m?: string; enable1h?: string }, isSubscription: boolean): number | null {
  const on = (v?: string) => v !== undefined && v !== '' && v !== '0' && v.toLowerCase() !== 'false'
  if (on(env.disable)) return null
  if (on(env.force5m)) return CACHE_5M
  if (on(env.enable1h) || isSubscription) return CACHE_1H
  return CACHE_5M
}

/** Milliseconds until the cached prefix lapses, 0 once it has. */
export const cacheLeft = (cache: { at: number; ttlMs: number }, now: number) => Math.max(0, cache.at + cache.ttlMs - now)

/** How much of the TTL has run, 0 to 100: the meter that fills toward the lapse. */
export const cacheUsed = (cache: { at: number; ttlMs: number }, now: number) => 100 * (1 - cacheLeft(cache, now) / cache.ttlMs)

/** A countdown in whole seconds, rounded up so it reads 1s until it is gone: `4m 12s`, `42s`. */
export const countdown = (ms: number) => seconds(Math.ceil(ms / 1000))

// ---------------------------------------------------------------- git

/**
 * `git status --porcelain=v2 --branch` read as the status line reads it: the
 * branch (a detached head as its first 7 hex digits in brackets), untracked and
 * newly added files as added, then modified and deleted. Flightdeck's parser.
 */
export function parseGitStatus(out: string) {
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

// ---------------------------------------------------------------- one-line rows

/** A piece of a one-line row: its cells (its separator included), and when it goes (lower first; 0 never). */
export type Piece = { id: string; cells: number; drop: number }

/** Which pieces of a row fit `width` cells: the lowest `drop` goes first, so the least important leaves before the rest. */
export function fit(pieces: readonly Piece[], width: number): Set<string> {
  const kept = new Set(pieces.map(p => p.id))
  let used = pieces.reduce((n, p) => n + p.cells, 0)
  for (const p of [...pieces].filter(p => p.drop > 0).sort((a, b) => a.drop - b.drop)) {
    if (used <= width) break
    kept.delete(p.id)
    used -= p.cells
  }
  return kept
}
