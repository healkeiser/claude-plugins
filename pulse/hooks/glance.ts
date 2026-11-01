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
 * `git status --porcelain=v2 --branch --show-stash`: the branch (a detached head
 * as its first 7 hex digits in brackets), its upstream and how far ahead and
 * behind, the stash, and the files staged, unstaged, untracked and conflicted.
 */
export function parseGitStatus(out: string) {
  const r = { branch: '', oid: '', upstream: '', ahead: 0, behind: 0, stash: 0, staged: 0, unstaged: 0, untracked: 0, conflicted: 0 }
  for (const l of out.split(/\r?\n/)) {
    if (l.startsWith('# branch.oid ')) r.oid = l.slice('# branch.oid '.length)
    else if (l === '# branch.head (detached)') r.branch = `(${r.oid.slice(0, 7)})`
    else if (l.startsWith('# branch.head ')) r.branch = l.slice('# branch.head '.length)
    else if (l.startsWith('# branch.upstream ')) r.upstream = l.slice('# branch.upstream '.length)
    else if (l.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(l)
      r.ahead = Number(m?.[1] ?? 0)
      r.behind = Number(m?.[2] ?? 0)
    } else if (l.startsWith('# stash ')) r.stash = Number(l.slice('# stash '.length)) || 0
    else if (l.startsWith('? ')) r.untracked += 1
    else if (l.startsWith('u ')) r.conflicted += 1
    else if (/^[12] /.test(l)) {
      if (l[2] !== '.') r.staged += 1
      if (l[3] !== '.') r.unstaged += 1
    }
  }
  if (r.oid === '(initial)') r.oid = ''
  return r
}

/** `git status --porcelain=v2` file rows by path: their status letter (worktree first, then index; `?` untracked, `U` conflicted). */
export function statusLetters(out: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const l of out.split(/\r?\n/)) {
    if (l.startsWith('? ')) m.set(l.slice(2), '?')
    else if (l.startsWith('u ')) m.set(l.split(' ').slice(10).join(' '), 'U')
    else if (l.startsWith('1 ')) m.set(l.split(' ').slice(8).join(' '), l[3] !== '.' ? l[3]! : l[2]!)
    // A rename row ends `new<TAB>old`.
    else if (l.startsWith('2 ')) m.set(l.split(' ').slice(9).join(' ').split('\t')[0]!, 'R')
  }
  return m
}

/** `git diff HEAD --numstat`: lines added and removed per file (null for a binary file), and the totals. */
export function parseNumstat(out: string) {
  const files: { path: string; add: number | null; del: number | null }[] = []
  let add = 0
  let del = 0
  for (const l of out.split(/\r?\n/)) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(l)
    if (!m) continue
    const a = m[1] === '-' ? null : Number(m[1])
    const d = m[2] === '-' ? null : Number(m[2])
    add += a ?? 0
    del += d ?? 0
    // A rename reads `dir/{old => new}` or `old => new`: the new path.
    const path = m[3]!.replace(/\{[^{}]* => ([^{}]*)\}/, '$1').replace(/^.* => /, '').replace(/\/\//g, '/')
    files.push({ path, add: a, del: d })
  }
  return { add, del, files }
}

/** `git log -1 --format=%h%x00%s%x00%ct`: HEAD's short hash, subject and commit time in ms; null with no commit. */
export function parseLastCommit(out: string): { hash: string; subject: string; at: number } | null {
  const [hash, subject, at] = out.trim().split('\0')
  return hash && at ? { hash, subject: subject ?? '', at: Number(at) * 1000 } : null
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
