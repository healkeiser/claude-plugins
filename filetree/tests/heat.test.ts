import { expect, test } from 'claude-code/testing'

import { bump, decay, HEAT_KEEP, heatOf, heatPct, heatSegs, heatWidth, merge, rollHeat } from '../hooks/heat'
import { HEAT_RAMP, HEAT_UNLIT } from '../hooks/style'
import { emptyTree, visibleRows } from '../hooks/tree'
import type { FileNode } from '../types'

const root = '/home/k/proj'

test('bump counts each edit and keeps at most the hottest files, the one just edited always kept', () => {
  let counts: Record<string, number> = {}
  counts = bump(counts, `${root}/a.ts`)
  counts = bump(counts, `${root}/a.ts`)
  counts = bump(counts, `${root}/b.ts`)
  expect(counts).toEqual({ [`${root}/a.ts`]: 2, [`${root}/b.ts`]: 1 })
  const full = Object.fromEntries(Array.from({ length: HEAT_KEEP }, (_, i) => [`${root}/f${i}.ts`, 5]))
  const next = bump(full, `${root}/new.ts`)
  expect(Object.keys(next).length).toBe(HEAT_KEEP)
  expect(next[`${root}/new.ts`]).toBe(1)
  expect(bump({ x: 1, y: 3, z: 2 }, 'y', 2)).toEqual({ y: 4, z: 2 })
})

test('decay halves each count for a new session and drops what falls under half an edit; merge keeps the larger', () => {
  expect(decay({ a: 4, b: 1, c: 0.5 })).toEqual({ a: 2, b: 0.5 })
  expect(decay(decay(decay({ a: 4 })))).toEqual({ a: 0.5 })
  expect(merge({ a: 2, b: 1 }, { b: 3, c: 1 })).toEqual({ a: 2, b: 3, c: 1 })
})

test('heatOf keeps only positive finite counts from the store, bounded', () => {
  expect(heatOf(null)).toEqual({})
  expect(heatOf([1, 2])).toEqual({})
  expect(heatOf({ a: 2, b: 'x', c: -1, d: Number.NaN, e: 0, f: 1 })).toEqual({ a: 2, f: 1 })
  expect(Object.keys(heatOf({ a: 1, b: 3, c: 2 }, 2))).toEqual(['b', 'c'])
})

test('rollHeat: files under the root keep their counts, every folder between sums its files, outside paths are left out', () => {
  const { files, dirs } = rollHeat({ [`${root}/src/a.ts`]: 3, [`${root}/src/lib/b.ts`]: 2, [`${root}/README.md`]: 1, '/elsewhere/x.ts': 9, [root]: 4 }, root)
  expect(files).toEqual({ [`${root}/src/a.ts`]: 3, [`${root}/src/lib/b.ts`]: 2, [`${root}/README.md`]: 1 })
  expect(dirs).toEqual({ [`${root}/src`]: 5, [`${root}/src/lib`]: 2 })
  expect(rollHeat({ a: 1 }, '')).toEqual({ files: {}, dirs: {} })
})

test('heatSegs: a short meter and the count, in the ramp step of the share, or role colours without the ramp', () => {
  expect(heatSegs(0, 5, true)).toEqual([])
  expect(heatPct(3, 3)).toBe(100)
  const hot = heatSegs(3, 3, true)
  expect(hot).toEqual([{ t: ' ' }, { t: '━━', c: HEAT_RAMP[9] }, { t: ' 3', c: HEAT_RAMP[9] }])
  const warm = heatSegs(1, 3, true)
  expect(warm.map(s => s.t).join('')).toBe(' ╸─ 1')
  expect(warm[1]?.c).toBe(HEAT_RAMP[3])
  expect(warm[2]?.c).toBe(HEAT_UNLIT)
  const roles = heatSegs(1, 3, false)
  expect(roles.map(s => s.c)).toEqual([undefined, 'claude', 'subtle', 'claude'])
  expect(heatSegs(3, 3, false)[1]?.c).toBe('error')
  // A decayed count under one still reads as an edit.
  expect(heatSegs(0.5, 1, true).at(-1)?.t).toBe(' 1')
  expect(heatWidth(12)).toBe(6)
  expect(heatWidth(0)).toBe(0)
})

const node = (id: string, kind: FileNode['kind']): FileNode => ({ id, parent: id.slice(0, id.lastIndexOf('/')), name: id.slice(id.lastIndexOf('/') + 1), kind, hidden: false, mtime: 0, size: 0, loaded: true })

test('the hot files view keeps only edited files and their folders, open, hottest first, and narrows a search further', () => {
  const nodes = [node(`${root}/docs`, 'dir'), node(`${root}/src`, 'dir'), node(`${root}/z.md`, 'file'), node(`${root}/docs/a.md`, 'file'), node(`${root}/docs/cold.md`, 'file'), node(`${root}/src/b.ts`, 'file'), node(`${root}/src/c.ts`, 'file')]
  const heat = { [`${root}/docs/a.md`]: 1, [`${root}/src/b.ts`]: 2, [`${root}/src/c.ts`]: 5, [`${root}/z.md`]: 4 }
  const t = { ...emptyTree(root), nodes, heat }
  expect(visibleRows(t).map(r => r.node.name)).toEqual(['docs', 'src', 'z.md'])
  const hot = visibleRows({ ...t, hot: true })
  expect(hot.map(r => r.node.name)).toEqual(['src', 'c.ts', 'b.ts', 'z.md', 'docs', 'a.md'])
  expect(hot.every(r => r.node.kind !== 'dir' || r.open)).toBe(true)
  expect(visibleRows({ ...t, hot: true, query: '.ts' }).map(r => r.node.name)).toEqual(['src', 'c.ts', 'b.ts'])
  expect(visibleRows({ ...t, hot: true, heat: {} })).toEqual([])
})
