import { expect, test } from 'claude-code/testing'

import { describe, elapsed, summarize } from './label'

test('tool calls become short phrases', () => {
  expect(describe({ tool: 'Edit', file_path: 'C:\\repo\\hooks\\parse.ts' })).toBe('editing parse.ts')
  expect(describe({ tool: 'Bash', command: 'npm test -- x' })).toBe('running npm')
  expect(describe({ tool: 'Bash', command: 'ls', description: 'List files' })).toBe('List files')
  expect(describe({ tool: 'mcp__kitsu__list_shots' })).toBe('kitsu: list shots')
  expect(describe({ tool: 'WebFetch', url: 'https://github.com/a/b' })).toBe('fetching github.com')
  expect(describe({ tool: 'Bash', command: '\n  git status' })).toBe('running git')
  expect(describe({ tool: 'Bash', command: 'x', description: 'Build\nand test' })).toBe('Build and test')
})

test('elapsed time reads as seconds then minutes', () => {
  expect(elapsed(42)).toBe('42s')
  expect(elapsed(125)).toBe('2m 05s')
})

test('a folded run sums its calls by kind', () => {
  const calls = [{ tool: 'Read', isErrored: false }, { tool: 'Read', isErrored: false }, { tool: 'Grep', isErrored: true }]
  expect(summarize(calls)).toEqual({ text: '◇ 2 reads  ·  ⌕ 1 search', failed: 1 })
})
