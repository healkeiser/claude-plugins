// How often Claude edits each file: counts per absolute path, folders summed
// from their files, drawn as a short heat meter beside the git markers.
import type { Seg } from './rows'
import { count, heat, HEAT_UNLIT, heatHex, meter } from './style'
import { ancestorsOf, inside } from './tree'

/** The most files kept: the coolest go first, so the counts never grow past this. */
export const HEAT_KEEP = 300
/** Cells in a row's meter; the count follows it, so colour is never alone. */
export const HEAT_CELLS = 2

/** One more edit of `path`, trimmed to the `keep` hottest files. */
export function bump(counts: Readonly<Record<string, number>>, path: string, keep = HEAT_KEEP): Record<string, number> {
  const next = { ...counts, [path]: (counts[path] ?? 0) + 1 }
  const ids = Object.keys(next)
  if (ids.length <= keep) return next
  // The file just edited stays even when the others are all hotter.
  const kept = ids.filter(id => id !== path).sort((a, b) => (next[b] ?? 0) - (next[a] ?? 0)).slice(0, keep - 1)
  return Object.fromEntries([...kept, path].map(id => [id, next[id] ?? 0]))
}

/** The counts a new session inherits: each scaled by `factor`, those under half an edit dropped. */
export function decay(counts: Readonly<Record<string, number>>, factor = 0.5): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).flatMap(([id, n]) => (n * factor >= 0.5 ? [[id, n * factor]] : [])))
}

/** The larger count of each path in either record. */
export function merge(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): Record<string, number> {
  const out = { ...a }
  for (const [id, n] of Object.entries(b)) out[id] = Math.max(out[id] ?? 0, n)
  return out
}

/** Files under `root` with their counts, and every folder between them and `root` with the sum of its files. */
export function rollHeat(counts: Readonly<Record<string, number>>, root: string): { files: Record<string, number>; dirs: Record<string, number> } {
  const files: Record<string, number> = {}
  const dirs: Record<string, number> = {}
  if (!root) return { files, dirs }
  for (const [id, n] of Object.entries(counts)) {
    if (n <= 0 || id === root || !inside(root, id)) continue
    files[id] = n
    for (const dir of ancestorsOf(id, root)) dirs[dir] = (dirs[dir] ?? 0) + n
  }
  return { files, dirs }
}

/** A row's heat as a share of the hottest of its kind, 0 to 100. */
export const heatPct = (n: number, max: number): number => (n > 0 && max > 0 ? Math.min(100, (n / max) * 100) : 0)

/**
 * A row's meter and count. A meter this short cannot step along the ramp, so
 * its lit cells and its count take the step of its share (`heatHex`, as the
 * status line colours a percentage), the track unlit. Without the ramp
 * (`ramp` false) the role colours of `heat` stand in and the track is chrome.
 */
export function heatSegs(n: number, max: number, ramp: boolean): Seg[] {
  if (n <= 0) return []
  const pct = heatPct(n, max)
  const { fill, track } = meter(pct, HEAT_CELLS)
  const color = ramp ? heatHex(pct) : heat(pct)
  return [{ t: ' ' }, { t: fill, c: color }, ...(track ? [{ t: track, c: ramp ? HEAT_UNLIT : 'subtle' }] : []), { t: ` ${count(n < 1 ? 1 : n)}`, c: color }]
}

/** The widest the meter draws, for the name's room. */
export const heatWidth = (n: number): number => (n > 0 ? 2 + HEAT_CELLS + count(n < 1 ? 1 : n).length : 0)


/** Counts read back from the store, kept only as path to positive count, at most `keep` of the hottest. */
export function heatOf(v: unknown, keep = HEAT_KEEP): Record<string, number> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {}
  const ok = Object.entries(v).filter((x): x is [string, number] => typeof x[1] === 'number' && Number.isFinite(x[1]) && x[1] > 0)
  return Object.fromEntries(ok.sort((a, b) => b[1] - a[1]).slice(0, keep))
}
