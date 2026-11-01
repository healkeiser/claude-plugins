import { expect, test } from 'claude-code/testing'

import { blockDiff, blockRows, changeMarks, mdBlocks, mdWindow, tally } from '../hooks/compare'

test('mdBlocks: paragraphs split on blank lines, a heading stands alone, a fence stays whole across blank lines', () => {
  const text = '# Title\nintro line one\nline two\n\n- a\n- b\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\n~~~\nx\n~~~\r\ntail'
  expect(mdBlocks(text)).toEqual(['# Title', 'intro line one\nline two', '- a\n- b', '```ts\nconst a = 1\n\nconst b = 2\n```', '~~~\nx\n~~~', 'tail'])
  expect(mdBlocks('')).toEqual([])
  expect(mdBlocks('```\nunclosed\n\nstill code')).toEqual(['```\nunclosed\n\nstill code'])
})

test('blockDiff: kept blocks are same, a removed block next to an added one is modified, the rest added or removed', () => {
  const before = mdBlocks('# A\n\none\n\ntwo\n\nthree\n\nfour')
  const after = mdBlocks('# A\n\none\n\nTWO\n\nfour\n\nfive')
  const d = blockDiff(before, after)
  expect(d.map(b => b.kind)).toEqual(['same', 'same', 'mod', 'del', 'same', 'add'])
  expect(d[2]).toEqual({ kind: 'mod', before: 'two', after: 'TWO' })
  expect(d[3]).toEqual({ kind: 'del', before: 'three', after: '' })
  expect(d[5]).toEqual({ kind: 'add', before: '', after: 'five' })
  expect(tally(d)).toEqual({ add: 1, del: 1, mod: 1 })
  expect(blockDiff([], ['new']).map(b => b.kind)).toEqual(['add'])
  expect(blockDiff(['x', 'y'], ['x', 'y']).every(b => b.kind === 'same')).toBe(true)
  // A block moved down: matched where it lands, its old place removed.
  expect(blockDiff(['a', 'b', 'c'], ['b', 'c', 'a']).map(b => b.kind)).toEqual(['del', 'same', 'same', 'add'])
})

test('changeMarks and mdWindow: j and k land on each run of changes, the window fills about the rows asked and always shows a block', () => {
  const d = blockDiff(['a', 'b', 'c', 'd', 'e'], ['a', 'B', 'c', 'd', 'E', 'f'])
  expect(d.map(b => b.kind)).toEqual(['same', 'mod', 'same', 'same', 'mod', 'add'])
  expect(changeMarks(d)).toEqual([1, 4, 5])
  expect(blockRows({ kind: 'mod', before: 'a\nb', after: 'c' }, true)).toBe(3)
  expect(blockRows({ kind: 'mod', before: 'a\nb', after: 'c' }, false)).toBe(5)
  expect(mdWindow(d, 1, 4, true)).toEqual({ blocks: d.slice(1, 3), top: 1 })
  expect(mdWindow(d, 99, 1, false).top).toBe(5)
  expect(mdWindow(d, 0, 0, false).blocks.length).toBe(1)
})
