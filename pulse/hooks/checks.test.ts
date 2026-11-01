import { expect, test } from 'claude-code/testing'

import { checkKind, ghProblem, parsePr, parseRuns, runState, touchesCi } from './checks'

test('commands that run a test, a type check, a lint or a build are known; reading a test file is not one', () => {
  const cases: [string, ReturnType<typeof checkKind>][] = [
    ['pytest -q tests/', 'test'],
    ['uv run pytest', 'test'],
    ['python -m pytest -x', 'test'],
    ['npx vitest run', 'test'],
    ['npm test', 'test'],
    ['pnpm run test:unit', 'test'],
    ['cargo test --all', 'test'],
    ['go test ./...', 'test'],
    ['claude plugin test pulse', 'test'],
    ['./run_tests.sh', 'test'],
    ['tsc -p .', 'types'],
    ['npx tsc --noEmit', 'types'],
    ['mypy src', 'types'],
    ['cargo check', 'types'],
    ['npm run typecheck', 'types'],
    ['ruff check .', 'lint'],
    ['eslint src', 'lint'],
    ['node scripts/check-style.mjs', 'lint'],
    ['claude plugin validate pulse', 'lint'],
    ['cargo clippy', 'lint'],
    ['npm run build', 'build'],
    ['make', 'build'],
    ['make test', 'test'],
    ['cargo build --release', 'build'],
    ['cd pulse && npm run lint && npm test', 'lint'],
    ['CI=1 npm test', 'test'],
    ['cat tests/test_api.py', null],
    ['git diff -- test/', null],
    ['ls build', null],
    ['prettier --write src', null],
    ['prettier --check src', 'lint'],
    ['echo hi', null],
  ]
  for (const [command, kind] of cases) expect([command, checkKind(command)]).toEqual([command, kind])
})

test('a push or a gh command on runs or pull requests may change CI', () => {
  expect(['git push', 'git push -u origin main', 'gh pr create --fill', 'gh run rerun 1', 'gh workflow run ci'].every(touchesCi)).toBe(true)
  expect(['git status', 'gh repo view', 'git pushd'].some(touchesCi)).toBe(false)
})

test('CI runs: the newest of each workflow, its state; a malformed answer is none', () => {
  const json = JSON.stringify([
    { databaseId: 3, workflowName: 'ci', status: 'in_progress', conclusion: '', createdAt: '2026-11-01T20:00:00Z', headSha: 'abcdef1234', url: 'u3' },
    { databaseId: 2, workflowName: 'ci', status: 'completed', conclusion: 'failure', createdAt: '2026-11-01T19:00:00Z', headSha: '0000000', url: 'u2' },
    { databaseId: 1, workflowName: 'release', status: 'completed', conclusion: 'success', createdAt: '2026-11-01T18:00:00Z', headSha: '1111111', url: 'u1' },
  ])
  const runs = parseRuns(json)
  expect(runs.map(r => [r.workflow, r.id, r.sha, runState(r)])).toEqual([
    ['ci', 3, 'abcdef1', 'running'],
    ['release', 1, '1111111', 'ok'],
  ])
  expect(runState({ ...runs[0]!, status: 'completed', conclusion: 'cancelled' })).toBe('fail')
  expect(parseRuns('not json')).toEqual([])
  expect(parseRuns('{}')).toEqual([])
})

test('the pull request: state, review, and its checks counted across check runs and commit statuses', () => {
  const pr = parsePr(JSON.stringify({
    number: 12, title: 'Unify the mods', state: 'OPEN', reviewDecision: 'APPROVED', url: 'u',
    statusCheckRollup: [
      { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' },
      { __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: '' },
      { __typename: 'StatusContext', state: 'SUCCESS' },
    ],
  }))
  expect(pr).toEqual({ number: 12, title: 'Unify the mods', state: 'open', review: 'approved', passed: 2, failed: 1, pending: 1, url: 'u' })
  expect(parsePr('no pull requests found')).toBeNull()
})

test('why gh gave nothing: missing, not logged in, no GitHub remote; another failure is not a reason to hide CI', () => {
  expect(ghProblem(null, '')).toBe('missing')
  expect(ghProblem(0, '')).toBe('')
  expect(ghProblem(4, 'To get started with GitHub CLI, please run:  gh auth login')).toBe('auth')
  expect(ghProblem(1, 'none of the git remotes configured for this repository point to a known GitHub host')).toBe('remote')
  expect(ghProblem(1, 'HTTP 502')).toBe('')
})
