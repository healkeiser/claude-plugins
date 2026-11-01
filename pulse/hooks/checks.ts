// The Checks tab's logic: which shell commands are tests, type checks, lints or
// builds, and what GitHub says about the branch's CI runs and pull request.
// Pure, apart from readCi, which runs `gh` by argument vector, never on a draw.
import type { EngineInterface } from 'claude-code'

import type { CheckKind, CiRun, Pr } from '../types'

// Runners that, run as the command itself, are one kind of check.
const RUNNER: Readonly<Record<string, CheckKind>> = {
  pytest: 'test', jest: 'test', vitest: 'test', mocha: 'test', rspec: 'test', phpunit: 'test', tox: 'test', ctest: 'test', ava: 'test', nox: 'test',
  tsc: 'types', mypy: 'types', pyright: 'types', 'vue-tsc': 'types', basedpyright: 'types',
  eslint: 'lint', ruff: 'lint', flake8: 'lint', pylint: 'lint', biome: 'lint', shellcheck: 'lint', stylelint: 'lint', 'golangci-lint': 'lint', black: 'lint', prettier: 'lint',
  make: 'build', cmake: 'build', webpack: 'build', tsup: 'build', rollup: 'build', gradle: 'build', mvn: 'build', msbuild: 'build', ninja: 'build',
}
// Words that pass the command on: `npx vitest`, `uv run pytest`, `python -m pytest`.
const PASS_ON = new Set(['npx', 'bunx', 'pnpx', 'exec', 'run', 'uv', 'poetry', 'pipenv', 'hatch', 'pdm', 'rye', 'time', 'sudo', 'env', '-m'])

/** A script or subcommand's name as a kind: `test:unit` is a test, `typecheck` a type check, `build` a build. */
function scriptKind(name: string): CheckKind | null {
  const n = name.toLowerCase()
  if (/^(test|tests|spec|e2e|unit|ci)\b|[-:]test\b/.test(n)) return 'test'
  if (/^(typecheck|type-check|types|tsc|check-types)\b/.test(n)) return 'types'
  if (/^(lint|format:check|fmt:check|check|clippy|vet|validate|check-style)\b|[-:]lint\b/.test(n)) return 'lint'
  if (/^(build|compile|bundle|dist)\b|[-:]build\b/.test(n)) return 'build'
  return null
}

/** One segment of a command line (no `&&`, `;` or `|`) as a kind of check, or null. */
function segmentKind(segment: string): CheckKind | null {
  const words = segment.trim().split(/\s+/).filter(w => !/^\w+=/.test(w))
  while (words.length && (PASS_ON.has(words[0]!) || /^python[\d.]*$/.test(words[0]!))) words.shift()
  const [head = '', sub = '', third = ''] = words.map(w => w.replace(/^.*[\\/]/, ''))
  if (!head) return null
  if (head === 'make' && sub) return scriptKind(sub) ?? 'build'
  if (head in RUNNER) return head === 'prettier' && !segment.includes('--check') ? null : RUNNER[head]!
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(head)) return scriptKind(sub === 'run' || sub === 'run-script' ? third : sub)
  if (['cargo', 'go', 'dotnet', 'deno', 'swift', 'mix', 'zig'].includes(head)) {
    if (sub === 'check') return head === 'cargo' ? 'types' : 'lint'
    return scriptKind(sub)
  }
  if (head === 'claude' && sub === 'plugin') return third === 'test' ? 'test' : third === 'validate' ? 'lint' : null
  if (head === 'unittest') return 'test'
  // A script by its name: `node scripts/check-style.mjs`, `./run_tests.sh`, `bash build.sh`.
  const script = ['node', 'bash', 'sh', 'pwsh', 'powershell', 'deno', 'tsx', 'ts-node'].includes(head) ? sub : head
  const base = script.replace(/\.[a-z0-9]+$/i, '')
  if (/(^|[-_])(tests?|spec)([-_]|$)/i.test(base)) return 'test'
  if (/(^|[-_])(lint|check)([-_]|$)/i.test(base)) return 'lint'
  if (/(^|[-_])build([-_]|$)/i.test(base)) return 'build'
  return null
}

/**
 * What kind of check a shell command runs, or null: the first segment that is
 * one, so `npm run lint && npm test` is a lint. A command that only reads
 * files that name a test (`cat tests/a.py`, `git diff -- test/`) is none.
 */
export function checkKind(command: string): CheckKind | null {
  for (const segment of command.split(/&&|\|\||;|\||\r?\n/)) {
    const kind = segmentKind(segment)
    if (kind) return kind
  }
  return null
}

/** Whether a command may change what GitHub reports: a push, or `gh` acting on runs or pull requests. */
export const touchesCi = (command: string): boolean => /\bgit\s+push\b|\bgh\s+(pr|run|workflow)\b/.test(command)

/** `gh run list --json databaseId,workflowName,status,conclusion,createdAt,headSha,url`: the newest run of each workflow, newest first. */
export function parseRuns(json: string): CiRun[] {
  let rows: unknown
  try {
    rows = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(rows)) return []
  const seen = new Set<string>()
  const out: CiRun[] = []
  for (const r of rows as Record<string, unknown>[]) {
    const workflow = String(r.workflowName ?? '')
    if (!workflow || seen.has(workflow)) continue
    seen.add(workflow)
    out.push({
      id: Number(r.databaseId) || 0,
      workflow,
      status: String(r.status ?? '').toLowerCase(),
      conclusion: String(r.conclusion ?? '').toLowerCase(),
      sha: String(r.headSha ?? '').slice(0, 7),
      url: String(r.url ?? ''),
      at: Date.parse(String(r.createdAt ?? '')) || 0,
    })
  }
  return out
}

const PASSED = new Set(['success', 'neutral', 'skipped'])
const FAILED = new Set(['failure', 'error', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'stale'])

/** `gh pr view --json number,title,state,reviewDecision,url,statusCheckRollup`: the pull request and its checks, counted. */
export function parsePr(json: string): Pr | null {
  let r: Record<string, unknown>
  try {
    r = JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
  if (!r || typeof r.number !== 'number') return null
  let passed = 0
  let failed = 0
  let pending = 0
  for (const c of Array.isArray(r.statusCheckRollup) ? (r.statusCheckRollup as Record<string, unknown>[]) : []) {
    // A check run has a status and, once completed, a conclusion; a commit status has a state.
    const result = String(c.conclusion || c.state || '').toLowerCase()
    if (PASSED.has(result)) passed += 1
    else if (FAILED.has(result)) failed += 1
    else pending += 1
  }
  return {
    number: r.number,
    title: String(r.title ?? ''),
    state: String(r.state ?? '').toLowerCase(),
    review: String(r.reviewDecision ?? '').toLowerCase(),
    passed,
    failed,
    pending,
    url: String(r.url ?? ''),
  }
}

/** A run's result as drawn: done and passed, done and failed, or still going. */
export const runState = (r: CiRun): 'ok' | 'fail' | 'running' =>
  r.status !== 'completed' ? 'running' : PASSED.has(r.conclusion) ? 'ok' : 'fail'

/** Why `gh` gave nothing: not installed, not logged in, or no GitHub remote; '' when it answered. */
export function ghProblem(exitCode: number | null, stderr: string): '' | 'missing' | 'auth' | 'remote' {
  if (exitCode === null) return 'missing'
  if (exitCode === 0) return ''
  if (/auth login|not logged|authentication/i.test(stderr)) return 'auth'
  if (/none of the git remotes|not a git repository|no git remotes|could not determine/i.test(stderr)) return 'remote'
  return ''
}

/**
 * The branch's CI runs and pull request, by `gh` (no shell). A missing `gh`,
 * one not logged in, or a folder with no GitHub remote comes back as `problem`.
 */
export async function readCi($: EngineInterface, dir: string, branch: string) {
  const gh = (...args: string[]) =>
    $.process.run(['gh', ...args], { cwd: dir, timeoutMs: 8000 }).catch(() => null)
  const runs = await gh('run', 'list', '--branch', branch, '--limit', '20', '--json', 'databaseId,workflowName,status,conclusion,createdAt,headSha,url')
  const problem = ghProblem(runs ? runs.exitCode : null, runs?.stderr ?? '')
  if (problem) return { problem, runs: [] as CiRun[], pr: null }
  const pr = await gh('pr', 'view', '--json', 'number,title,state,reviewDecision,url,statusCheckRollup')
  return {
    problem: '' as const,
    runs: runs && runs.exitCode === 0 ? parseRuns(runs.stdout) : [],
    pr: pr && pr.exitCode === 0 ? parsePr(pr.stdout) : null,
  }
}
