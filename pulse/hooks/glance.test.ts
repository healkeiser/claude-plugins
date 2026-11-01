import { expect, test } from 'claude-code/testing'

import { CACHE_1H, CACHE_5M, cacheLeft, cacheTtl, cacheUsed, countdown, fit, parseGitStatus, svgMeter } from './glance'

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

test('git status reads as the status line reads it', () => {
  const out = ['# branch.oid abcdef1234', '# branch.head main', '1 .M N... 100644 100644 100644 a b x.ts', '? new.ts', '1 D. N... 100644 0 0 a b gone.ts'].join('\n')
  expect(parseGitStatus(out)).toEqual({ branch: 'main', added: 1, modified: 1, deleted: 1 })
  expect(parseGitStatus('# branch.oid abcdef1234\n# branch.head (detached)').branch).toBe('(abcdef1)')
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
