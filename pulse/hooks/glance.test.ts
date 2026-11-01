import { expect, test } from 'claude-code/testing'

import { CACHE_1H, CACHE_5M, cacheLeft, cacheTtl, cacheUsed, countdown, countWorktrees, fit, parseCommits, parseGitStatus, parseLastCommit, parseNumstat, statusLetters, svgMeter } from './glance'

test('the cache TTL: Claude Code switches first, then an hour for a subscription, else five minutes', () => {
  expect(cacheTtl({}, true)).toBe(CACHE_1H)
  expect(cacheTtl({}, false)).toBe(CACHE_5M)
  expect(cacheTtl({ enable1h: '1' }, false)).toBe(CACHE_1H)
  expect(cacheTtl({ force5m: 'true' }, true)).toBe(CACHE_5M)
  expect(cacheTtl({ force5m: '0' }, true)).toBe(CACHE_1H)
  expect(cacheTtl({ disable: '1' }, true)).toBeNull()
})

test('the countdown: time left after the last request, rounded up, never below zero', () => {
  const c = { at: 1_000_000, ttlMs: CACHE_5M }
  expect(cacheLeft(c, 1_000_000)).toBe(CACHE_5M)
  expect(countdown(cacheLeft(c, 1_000_000))).toBe('5m 00s')
  expect(countdown(cacheLeft(c, 1_000_000 + 47_500))).toBe('4m 13s')
  expect(countdown(cacheLeft(c, 1_000_000 + CACHE_5M - 400))).toBe('1s')
  expect(cacheLeft(c, 1_000_000 + CACHE_5M + 1)).toBe(0)
  expect(cacheUsed(c, 1_000_000 + CACHE_5M / 2)).toBe(50)
  expect(cacheUsed(c, 1_000_000 + 2 * CACHE_5M)).toBe(100)
})

// A porcelain v2 sample: ahead 2, behind 1, a stash, one staged, one unstaged, one both, a rename, an untracked file, a conflict.
const STATUS = [
  '# branch.oid abcdef1234567',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +2 -1',
  '# stash 3',
  '1 M. N... 100644 100644 100644 aaa bbb src/staged.ts',
  '1 .M N... 100644 100644 100644 aaa bbb src/edited.ts',
  '1 MM N... 100644 100644 100644 aaa bbb src/both.ts',
  '2 R. N... 100644 100644 100644 aaa bbb R100 src/new name.ts\tsrc/old.ts',
  'u UU N... 100644 100644 100644 100644 aaa bbb ccc src/clash.ts',
  '? notes.md',
].join('\n')

test('git status: branch, upstream, ahead and behind, stash, and files staged, unstaged, untracked and conflicted', () => {
  expect(parseGitStatus(STATUS)).toEqual({
    branch: 'main', oid: 'abcdef1234567', upstream: 'origin/main', ahead: 2, behind: 1, stash: 3,
    staged: 3, unstaged: 2, untracked: 1, conflicted: 1,
  })
  expect(parseGitStatus('# branch.oid abcdef1234\n# branch.head (detached)').branch).toBe('(abcdef1)')
  // A fresh repo: no commit yet, no upstream.
  expect(parseGitStatus('# branch.oid (initial)\n# branch.head main')).toMatchObject({ oid: '', upstream: '', ahead: 0, behind: 0 })
  expect([...statusLetters(STATUS)]).toEqual([
    ['src/staged.ts', 'M'], ['src/edited.ts', 'M'], ['src/both.ts', 'M'], ['src/new name.ts', 'R'], ['src/clash.ts', 'U'], ['notes.md', '?'],
  ])
})

test('numstat counts lines per file and in all, a binary file as null, a rename by its new path', () => {
  const out = ['40\t3\tsrc/api.ts', '-\t-\tlogo.png', '5\t5\tsrc/{old => new}.ts', '1\t0\ta.ts => b.ts'].join('\n')
  expect(parseNumstat(out)).toEqual({
    add: 46, del: 8,
    files: [
      { path: 'src/api.ts', add: 40, del: 3 },
      { path: 'logo.png', add: null, del: null },
      { path: 'src/new.ts', add: 5, del: 5 },
      { path: 'b.ts', add: 1, del: 0 },
    ],
  })
  expect(parseNumstat('')).toEqual({ add: 0, del: 0, files: [] })
})

test('the last commit: short hash, subject, time in ms; none in a repo with no commit', () => {
  expect(parseLastCommit('a1b2c3d\0fix: token expiry\x001700000000\n')).toEqual({ hash: 'a1b2c3d', subject: 'fix: token expiry', at: 1_700_000_000_000 })
  expect(parseLastCommit('')).toBeNull()
})

test('a row drops its least important pieces first and keeps the ones marked 0', () => {
  const pieces = [
    { id: 'lead', cells: 10, drop: 0 },
    { id: 'cost', cells: 8, drop: 2 },
    { id: 'tabs', cells: 20, drop: 1 },
    { id: 'fold', cells: 3, drop: 0 },
  ]
  expect([...fit(pieces, 100)]).toEqual(['lead', 'cost', 'tabs', 'fold'])
  expect([...fit(pieces, 30)]).toEqual(['lead', 'cost', 'fold'])
  expect([...fit(pieces, 5)]).toEqual(['lead', 'fold'])
})

test('the SVG meter paints the ramp as a gradient and glides from the last width', () => {
  const first = svgMeter(64, 10, undefined, false, 'ctx 64%')
  expect(first.source).toContain('linearGradient')
  expect(first.source).toContain('#00ff00')
  expect(first.source).toContain('#ff0000')
  expect(first.source).not.toContain('<animate')
  expect(svgMeter(80, 10, first.width, false, 'ctx 80%').source).toContain('<animate')
  expect(svgMeter(80, 10, first.width, true, 'ctx 80%').source).not.toContain('<animate')
})

test('commits and work trees: hash and subject per line, one work tree per `worktree` line', () => {
  expect(parseCommits('c0ffee1\0feat: one\nc0ffee2\0feat: two\n')).toEqual([{ hash: 'c0ffee1', subject: 'feat: one' }, { hash: 'c0ffee2', subject: 'feat: two' }])
  expect(parseCommits('')).toEqual([])
  expect(countWorktrees('worktree /a\nHEAD x\n\nworktree /b\nHEAD y\n')).toBe(2)
})
