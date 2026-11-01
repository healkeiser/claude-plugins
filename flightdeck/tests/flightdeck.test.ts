import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { bareEmoji } from '../hooks/style'

import {
  svgMeter,
  DEFAULT_ARCHITECT,
  DEFAULT_GATE,
  DEFAULT_TURN,
  DEFAULT_USAGE,
  COMPACT_TRIES,
  addCard,
  cellWidth,
  piecesThatFit,
  afterCompactRead,
  claimCompactRead,
  faultKey,
  forgetCompactRead,
  resumeCard,
  afterCall,
  applyStep,
  compactWindowOf,
  consultTimeline,
  contextFill,
  describeInput,
  endConsult,
  fitLegend,
  gauge,
  heatOf,
  fileUri,
  folderOf,
  headFit,
  parseGitStatus,
  remoteUrl,
  segments,
  ruleLine,
  fmtResetAt,
  fmtResetIn,
  fmtSpeed,
  gateSummary,
  lanes,
  limitLabel,
  limitOf,
  logRows,
  marksIn,
  momentOf,
  normalizeCard,
  normalizeGate,
  normalizeLog,
  titleLines,
  parseConfig,
  prettyModel,
  promptLine,
  handbackOf,
  adviceLine,
  receiptOf,
  recordCheck,
  redact,
  settleCheck,
  trimRecent,
  startConsult,
  stepSpeed,
  INBOX_MAX,
  SPARK,
  SPARK_ASCII,
  TREND_MAX,
  addInbox,
  errorLine,
  inboxNewest,
  normalizeInbox,
  normalizeTrend,
  pushTrend,
  sparkLevels,
  splitOf,
  svgSpark,
  jumpTo,
} from '../hooks/core'
import type { Check, InboxItem, TrendPoint } from '../types'

// ---------------------------------------------------------------- pure behaviour

test('redaction masks credentials before anything is stored', () => {
  expect(redact('curl -H "Authorization: Bearer abc.def.ghi123" x')).not.toContain('abc.def')
  expect(redact('export OPENAI_API_KEY=sk-proj-1234567890abcdef')).not.toContain('1234567890')
  expect(redact('gh auth --token ghp_abcdefghijklmnop')).not.toContain('abcdefghijklmnop')
  expect(redact('psql postgres://bob:hunter2@db/x')).not.toContain('hunter2')
  expect(redact('password=hunter2 ls')).not.toContain('hunter2')
  expect(redact('ls -la src/')).toBe('ls -la src/')
  expect(describeInput('Read', { file_path: 'C:\\Users\\me\\proj\\src\\main.ts' })).toBe('Read → src/main.ts')
})

const check = (id: string, verdict: Check['verdict'], bucket: Check['bucket'] = 'shell'): Check => ({
  id,
  tool: 'Bash',
  bucket,
  verdict,
  inSubagent: false,
  detail: 'Bash → ls',
  at: 1,
})

test('an ask is settled by the call that follows: cleared if it ran, deny if refused', () => {
  let g = recordCheck(DEFAULT_GATE, check('a', 'ask'))
  g = recordCheck(g, check('b', 'ask'))
  g = recordCheck(g, check('c', 'rule', 'file'))
  g = settleCheck(g, 'a', true)
  g = settleCheck(g, 'b', false)
  g = settleCheck(g, 'zzz', true) // not an ask: unchanged
  const s = gateSummary(g)
  expect([s.rule, s.ask, s.cleared, s.deny, s.total]).toEqual([1, 0, 1, 1, 3])
  expect(g.recent.map(c => c.verdict)).toEqual(['cleared', 'deny', 'rule'])
})

test('the gate tallies a mixed run of verdicts per family', () => {
  let g = DEFAULT_GATE
  g = recordCheck(g, check('r1', 'rule', 'file'))
  g = recordCheck(g, check('a1', 'ask', 'shell'))
  g = recordCheck(g, check('a2', 'ask', 'shell'))
  g = recordCheck(g, check('d1', 'deny', 'other'))
  g = settleCheck(g, 'a1', true)
  g = settleCheck(g, 'a2', false)
  expect(g.totals.file).toEqual({ rule: 1, ask: 0, cleared: 0, deny: 0 })
  expect(g.totals.shell).toEqual({ rule: 0, ask: 0, cleared: 1, deny: 1 })
  expect(g.totals.other.deny).toBe(1)
  expect(gateSummary(g)).toEqual({ rule: 1, ask: 0, cleared: 1, deny: 2, total: 4 })
  expect(gateSummary(DEFAULT_GATE).total).toBe(0)
})

test('a v1-shaped gate reads as empty, then records normally', () => {
  const g = normalizeGate({ file: { allow: 3, ask: 1, deny: 0, cleared: 2 }, shell: null })
  expect(gateSummary(g).total).toBe(0)
  const next = recordCheck(g, check('n1', 'rule', 'file'))
  expect(next.totals.file.rule).toBe(1)
  expect(next.recent.length).toBe(1)
})

test('a pending ask is never trimmed out before it settles', () => {
  let g = recordCheck(DEFAULT_GATE, check('old-ask', 'ask'))
  for (let i = 0; i < 120; i += 1) g = recordCheck(g, check(`r${i}`, 'rule', 'file'))
  expect(g.recent.length).toBe(80)
  expect(g.recent.some(c => c.id === 'old-ask')).toBe(true)
  g = settleCheck(g, 'old-ask', true)
  expect(gateSummary(g).ask).toBe(0)
  expect(trimRecent([check('a', 'rule'), check('b', 'rule')], 5).length).toBe(2)
})

test('edits count from every loop; errors only from the main loop', () => {
  const t = { ...DEFAULT_TURN, errorStreak: 1 }
  expect(afterCall(t, { inSubagent: true, hasFailed: false, isEdit: true }).edits).toBe(1)
  expect(afterCall(t, { inSubagent: true, hasFailed: true, isEdit: false }).errorStreak).toBe(1)
  expect(afterCall(t, { inSubagent: false, hasFailed: true, isEdit: false })).toEqual({ ...t, errorStreak: 2, errors: 1 })
  expect(momentOf(afterCall(DEFAULT_TURN, { inSubagent: true, hasFailed: false, isEdit: true }))).toBe('before done')
  expect(momentOf({ edits: 0, errorStreak: 2 })).toBe('error repeats')
})

test("a card's context is its latest step's whole input; output adds up", () => {
  let c = normalizeCard({ id: 'x' })
  c = applyStep(c, { model: 'claude-sonnet-5-5', usage: { input_tokens: 10, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 2_000, output_tokens: 500 }, stopReason: 'tool_use' })
  c = applyStep(c, { model: 'claude-sonnet-5-5', usage: { input_tokens: 5, cache_read_input_tokens: 40_000, output_tokens: 700 }, stopReason: 'max_tokens' })
  expect([c.ctx, c.out, c.steps, c.lastStop, c.model]).toEqual([40_005, 1200, 2, 'max_tokens', 'claude-sonnet-5-5'])
})

test('a resumed agent runs again on its own card instead of adding a second', () => {
  const a = { ...normalizeCard({ id: 'a', description: 'first', spawnedAt: 5, model: 'claude-sonnet-5-5' }), status: 'done' as const, endedAt: 100, steps: 4, out: 900 }
  const b = normalizeCard({ id: 'b' })
  const cards = addCard(addCard(addCard([], a), b), { ...normalizeCard({ id: 'a', description: 'again', spawnedAt: 200 }) })
  expect(cards.map(c => `${c.id}:${c.description}`)).toEqual(['a:again', 'b:'])
  expect(cards[0] && [cards[0].status, cards[0].endedAt, cards[0].steps, cards[0].out, cards[0].spawnedAt]).toEqual(['running', null, 4, 900, 5])
  expect([resumeCard(a).status, resumeCard(a).endedAt]).toEqual(['running', null])
  // Spawned again on another model, the card names it; a spawn that names none keeps the card's.
  expect(addCard([a], normalizeCard({ id: 'a', model: 'claude-opus-5-5' }))[0]?.model).toBe('claude-opus-5-5')
  expect(addCard([a], normalizeCard({ id: 'a' }))[0]?.model).toBe('claude-sonnet-5-5')
})

test('consults open, close by id, and draw on a shared timeline', () => {
  let a = startConsult(DEFAULT_ARCHITECT, { id: 's1', at: 0, moment: 'before a plan', via: 'advisor tool' })
  a = startConsult(a, { id: 's1', at: 5, moment: 'before a plan', via: 'again' }) // same id: ignored
  a = endConsult(a, 10, null, 's1')
  a = startConsult(a, { id: 's2', at: 90, moment: 'before done', via: 'advisor tool' })
  expect(a.consults.length).toBe(2)
  expect(a.consults[0]?.endAt).toBe(10)
  const tl = consultTimeline(a, 100, 11)
  expect(tl.length).toBe(11)
  expect(tl.startsWith('◆━')).toBe(true)
  expect(tl.split('◆').length - 1).toBe(2)
})

test('config is read leniently: bad values fall back to defaults', () => {
  const d = parseConfig({})
  expect([d.maxCards, d.paneColumns, d.layout, d.motion, d.moments, d.panels.length]).toEqual([3, 66, 'auto', true, true, 9])
  expect(d.architect.test('fable-advisor:fable-advisor')).toBe(true)
  expect([d.statusLine, parseConfig({ statusLine: true }).statusLine]).toEqual([false, true]) // off unless asked
  const c = parseConfig({ architectPattern: '([', maxCards: 99, layout: 'diagonal', panels: 'log, gate ,nope,gate', motion: 'off' })
  expect(c.architect.test('advisor')).toBe(true) // invalid regex → default
  expect([c.maxCards, c.layout, c.motion]).toEqual([6, 'auto', false])
  expect([46.4, 12, Number.NaN, '90'].map(n => parseConfig({ paneColumns: n }).paneColumns)).toEqual([46, 40, 66, 66])
  expect(c.panels).toEqual(['log', 'gate'])
})

test('state saved under an older shape still reads', () => {
  expect(normalizeLog([{ at: '08:00:00', who: 'jev', text: 'x' }])[0]).toEqual({ at: 0, who: 'jev', text: 'x', agentId: null, kind: 'info' })
  const g = normalizeGate({ file: { allow: 1 } }) // v1 gate shape
  expect(g.recent).toEqual([])
  expect(g.totals.shell.rule).toBe(0)
  expect(normalizeCard({ id: 'a', status: 'done' }).tools).toEqual([])
})

test('layout math: lanes share one axis, the log gets 4-8 rows, the legend never wraps', () => {
  const cards = [
    { ...normalizeCard({}), id: 'a', spawnedAt: 1000, endedAt: 1050 },
    { ...normalizeCard({}), id: 'b', spawnedAt: 1050, endedAt: null },
  ]
  const [a, b] = lanes(cards, 1100, 20)
  expect(a).toEqual({ id: 'a', before: 0, bar: 10, after: 10 })
  expect(b?.before).toBe(10)
  expect((b?.before ?? 0) + (b?.bar ?? 0) + (b?.after ?? 0)).toBe(20)
  expect([logRows(10, 40), logRows(50, 40), logRows(200, 40)]).toEqual([4, 7, 8])
  expect(fitLegend([{ label: 'main' }, { label: 'agents' }, { label: 'architect' }], 20).map(x => x.label)).toEqual(['main', 'agents'])
  expect([marksIn(64, true), marksIn(64, false), marksIn(6, false)]).toEqual([64, 42, 4])
  expect(limitLabel('five_hour')).toBe('5h')
  expect(prettyModel('claude-opus-5-5[1m]')).toBe('Opus 5.5 1M')
  expect(prettyModel('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe('Sonnet 4.5')
  expect(prettyModel('claude-3-5-haiku-20241022')).toBe('Haiku 3.5')
  expect(prettyModel('claude-opus-4-20250514')).toBe('Opus 4')
  expect(prettyModel('claude-3-opus-20240229')).toBe('Opus 3')
  expect(prettyModel('z-ai/glm-5.3-flash-with-a-long-name')).toBe('z-ai/glm-5.3-flash-wi…')
  expect(prettyModel('')).toBe('—')
  expect(promptLine('fix the parser')).toEqual({ who: 'you', text: 'fix the parser' })
  const hb = '<agent-message from="a1940a83d593229d5">\n[Subagent hand-back] The text below is the final report. The report follows:\n  Add gate tests: redaction edge cases.\n  - more\n</agent-message>'
  expect(handbackOf(hb)).toEqual({ from: 'a1940a83d593229d5', body: 'Add gate tests: redaction edge cases.' })
  expect(handbackOf('<agent-message from="x">\nPlain report line\n</agent-message>')).toEqual({ from: 'x', body: 'Plain report line' })
  expect(handbackOf('fix the parser')).toBe(null)
  expect(adviceLine('## Ship it after one more gate test.\n- details')).toBe('Ship it after one more gate test.')
  expect(adviceLine('[Subagent hand-back] header\n\n**Fix card overflow first**')).toBe('Fix card overflow first')
  expect(adviceLine('')).toBe('')
  expect(promptLine('<agent-message from="a1492260715f3be7b"> [Subagent hand-back]')).toEqual({ who: 'engine', text: 'agent message from a1492260' })
  expect(receiptOf({ ...DEFAULT_TURN, costAtStart: 5 }, { durationMs: 1, agentsSince: 0, costNow: 5, reason: 'answer' }).costDelta).toBe(null)
  expect(titleLines('Write tinyqueue test suite', 13, 16)).toEqual(['Write', 'tinyqueue test…'])
  expect(titleLines('Short', 13, 16)).toEqual(['Short', ''])
  expect(receiptOf({ ...DEFAULT_TURN, costAtStart: 1, edits: 2 }, { durationMs: 1000, agentsSince: 3, costNow: 1.5, reason: 'answer' }).costDelta).toBe(0.5)
})

test('a request\'s speed is its time to the first piece of response, and no output rate', () => {
  expect(stepSpeed(1000, 1800)).toEqual({ ttftMs: 800 })
  expect(stepSpeed(1000, null)).toBe(null) // no response arrived
  expect(fmtSpeed({ ttftMs: 1250 })).toBe('ttft 1.3s')
  // State saved by 0.5.0 still carries a rate: it is not drawn.
  expect(fmtSpeed({ ttftMs: 800, tokPerS: 9844 } as { ttftMs: number })).toBe('ttft 0.8s')
})

test('a window keeps its reset time, drawn as the time left', () => {
  expect(limitOf({ kind: 'five_hour', percentUsed: 19, resetsAt: '1970-01-01T03:10:00.000Z' })).toEqual({ kind: 'five_hour', pct: 19, resetsAt: 11_400_000 })
  expect(limitOf({ kind: 'seven_day', percentUsed: 3 }).resetsAt).toBe(null)
  expect(limitOf({ kind: 'spend_limit', percentUsed: 1, resetsAt: 'soon' }).resetsAt).toBe(null)
  expect([fmtResetIn(11_400_000, 0), fmtResetIn(25 * 60_000 + 5_000, 0), fmtResetIn(4 * 86_400_000 + 2 * 3_600_000, 0)]).toEqual(['3h 10m', '25m', '4d 2h'])
  expect([fmtResetIn(null, 0), fmtResetIn(undefined, 0), fmtResetIn(5, 10)]).toEqual(['', '', ''])
})

// ---------------------------------------------------------------- drawing

// What git answers in a test, and every git command flightdeck ran: no test reaches the real git.
type GitReply = { exitCode: number; stdout: string; stderr: string }
let gitReply: (argv: readonly string[]) => GitReply = () => ({ exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' })
let gitCalls: (readonly string[])[] = []

const engine = (on: On) => {
  const clock = mock.clock(on)
  gitCalls = []
  gitReply = () => ({ exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' })
  on('session.cwd', () => ({ value: '/w/proj' }))
  on('process.run', (_$, e) => (gitCalls.push(e.argv), { value: { isStdoutTruncated: false, isStderrTruncated: false, ...gitReply(e.argv) } }))
  on('ui.status', () => ({ value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  return clock
}

const pane = (bodyColumns: number) => ({
  plugin: 'flightdeck',
  component: 'Pane' as const,
  requestId: 'flightdeck',
  props: {
    title: 'Flightdeck',
    isFocused: true,
    bodyColumns,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 70 },
    view: {},
  },
})

let spawnN = 0
const spawn = (subagentType: string, description: string) => ({
  prompt: description,
  description,
  subagentType,
  tool_use_id: `tu${++spawnN}`,
  provider: { plugin: 'engine', tier: 'core' as const },
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
})

test('a fresh session draws on every surface and width, empty panels hidden', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    for (const cols of [40, 60, 86, 120]) {
      const ui = await $.ui.mount({ ...pane(cols), surface })
      expect(await ui.find({ text: /· main$/ })).toBeDefined()
      expect(await ui.find({ text: /Session log/ })).toBeDefined()
      expect(await ui.find({ text: /agents ·/ })).toBeUndefined() // no subagents: no agents panel
      expect(await ui.find({ text: /permissions/ })).toBeUndefined() // no checks yet: no gate panel
      await ui.unmount()
    }
  }
})

test('inline above the prompt, the pane is a summary of at most 8 rows', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `m${++n}` }))
  on('tool.check', () => ({ decision: 'allow' }))
  await $.turn.start({ text: 'go', turnId: 'M1' })
  for (const d of ['one', 'two', 'three', 'four', 'five']) await $.agent.spawn(spawn('general-purpose', `task ${d}`))
  await $.tool.check({ tool: 'Read', input: { file_path: '/a' }, tool_use_id: 'm-k1' })
  for (const surface of ['terminal', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...pane(80), props: { ...pane(80).props, placement: 'inline' as const }, surface })
    const root = (await ui.drawn()) as { children?: unknown[] }
    expect((root.children ?? []).filter(Boolean).length <= 8).toBe(true)
    expect(await ui.find({ text: /\+2 more agents/ })).toBeDefined()
    expect(await ui.find({ text: /1 allowed/ })).toBeDefined()
    expect(await ui.find({ text: /Session log/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('/clear starts the pane fresh', async ($, on) => {
  engine(on)
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'c1' }))
  await $.turn.start({ text: 'go', turnId: 'C1' })
  await $.agent.spawn(spawn('Explore', 'look around'))
  await $.session.end({ reason: 'clear', sessionId: 's' } as never)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /look around/ })).toBeUndefined()
  await ui.unmount()
})

test('colours come from the theme by default, raw hex only when asked', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  const title = textsIn(keyed(await ui.drawn(), 'main-head'))[0]
  expect([title?.props?.color, title?.props?.weight]).toEqual(['claude', 'bold'])
  await ui.unmount()
})

test('pastel keeps the fixed dark-terminal colours', { options: { palette: 'pastel' } }, async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(textsIn(keyed(await ui.drawn(), 'main-head'))[0]?.props?.color).toBe('#7dd3fc')
  await ui.unmount()
})

test('subagents become cards, then swimlanes past the card limit; a card expands on its hotkey', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `ag${++n}` }))
  await $.turn.start({ text: 'fan out', turnId: 'T1' })
  await $.agent.spawn(spawn('general-purpose', 'Write the parser tests'))
  await $.agent.spawn(spawn('Explore', 'Map the call sites'))

  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /Write the parser/ })).toBeDefined()
  expect(await ui.find({ text: /Sonnet 5\.5/ })).toBeDefined() // differs from main: shown
  await ui.press({ key: 'card-ag1' })
  expect(await ui.find({ text: /^Write the parser tests$/ })).toBeDefined() // the expanded panel, full title
  await ui.unmount()

  await $.agent.spawn(spawn('general-purpose', 'Implement the parser'))
  await $.agent.spawn(spawn('general-purpose', 'Review the parser'))
  for (const surface of ['terminal', 'desktop'] as const) {
    const lanesUi = await $.ui.mount({ ...pane(64), surface })
    expect(await lanesUi.find({ text: /4 total/ })).toBeDefined()
    expect(await lanesUi.find({ text: /━/ })).toBeDefined()
    await lanesUi.unmount()
  }
})

test('the server-side advisor is read from assistant rows: consulting, then on call', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'plan it', turnId: 'T2' })
  const row = (content: unknown[]) =>
    $.session
      .append({
        message: { type: 'assistant', role: 'assistant', content: content as never },
        door: 'response',
        origin: { kind: 'model', model: 'claude-opus-5-5' } as never,
        uuid: `u${++spawnN}`,
      })
      .catch(() => undefined) // the test has no transcript to store rows in
  await row([{ type: 'server_tool_use', id: 'srv1', name: 'advisor', input: {} }])
  const mid = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await mid.find({ text: /Architect · advising/ })).toBeDefined()
  expect(await mid.find({ text: /◆ before a plan/ })).toBeDefined()
  await mid.unmount()

  await row([{ type: 'advisor_tool_result', tool_use_id: 'srv1', content: { type: 'advisor_redacted_result' } }])
  const after = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await after.find({ text: /Architect · on call/ })).toBeDefined()
  expect(await after.find({ text: /^1$/ })).toBeDefined()
  await after.unmount()
})

test('the gate meter fills from checks and a row opens its redacted drill-down', async ($, on) => {
  engine(on)
  on('tool.check', (_$, e) => ({ decision: e.tool === 'Read' ? 'allow' : 'ask' }))
  await $.tool.check({ tool: 'Read', input: { file_path: '/a/b.ts' }, tool_use_id: 'k1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'curl -H "Authorization: Bearer abcdefgh12345" api' }, tool_use_id: 'k2' })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /2 checks/ })).toBeDefined()
  expect(await ui.find({ text: /1 pending/ })).toBeDefined()
  await ui.press({ key: 'gate-shell' })
  expect(await ui.find({ text: /Authorization: Bearer •••/ })).toBeDefined()
  expect(await ui.find({ text: /abcdefgh12345/ })).toBeUndefined()
  await ui.unmount()
})

test('config changes labels, hides panels and turns the moments off', { options: { architectLabel: 'REVIEWER', panels: 'main,architect,agents,log', moments: false } }, async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-fable-5-1', agentId: `r${++n}` }))
  await $.turn.start({ text: 'review it', turnId: 'T3' })
  await $.agent.spawn(spawn('fable-advisor:fable-advisor', 'final review'))
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /REVIEWER · advising/ })).toBeDefined()
  expect(await ui.find({ text: /permissions/ })).toBeUndefined()
  expect(await ui.find({ text: /before a plan/ })).toBeUndefined()
  await ui.unmount()
})

test('a consult whose start and result share one row closes, and its review flag with it', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.turn.start({ text: 'go', turnId: 'T4' })
  // An edit first, so the consult is inferred as "before done" and sets the review flag.
  await $.tool.call({ tool: 'Edit', file_path: '/x.ts', old_string: 'a', new_string: 'b' } as never)
  await $.session
    .append({
      message: {
        type: 'assistant',
        role: 'assistant',
        content: [
          { type: 'server_tool_use', id: 'srv9', name: 'advisor', input: {} },
          { type: 'advisor_tool_result', tool_use_id: 'srv9', content: { type: 'advisor_redacted_result' } },
        ] as never,
      },
      door: 'response',
      origin: { kind: 'model', model: 'claude-opus-5-5' } as never,
      uuid: 'one-row',
    })
    .catch(() => undefined)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /Architect · on call/ })).toBeDefined()
  expect(await ui.find({ text: /◆ before done/ })).toBeDefined()
  expect(await ui.find({ text: /reviewing before done/ })).toBeUndefined()
  await ui.unmount()
})

test('with no architect anywhere, the panel, legend entry and status field stay hidden', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /Architect/ })).toBeUndefined()
  expect(await ui.find({ text: /^ architect$/ })).toBeUndefined()
  await ui.unmount()
})

test('cards that cannot fit the pane fall back to lanes', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `w${++n}` }))
  await $.turn.start({ text: 'go', turnId: 'W1' })
  for (const d of ['alpha', 'beta', 'gamma']) await $.agent.spawn(spawn('Explore', `task ${d}`))
  const narrow = await $.ui.mount({ ...pane(40), surface: 'terminal' })
  expect(await narrow.find({ text: /━/ })).toBeDefined() // lanes
  await narrow.unmount()
  const wide = await $.ui.mount({ ...pane(84), surface: 'terminal' })
  expect(await wide.find({ text: /━/ })).toBeUndefined() // three cards of 26 columns fit in an 84-column pane's block
  expect(await wide.find({ text: /task gamma/ })).toBeDefined()
  await wide.unmount()
})

test("a background architect's advice is read from its hand-back", async ($, on) => {
  engine(on)
  on('agent.spawn', () => ({ model: 'claude-fable-5-1', agentId: 'fab1' }))
  await $.turn.start({ text: 'review it', turnId: 'H1' })
  await $.agent.spawn(spawn('fable-advisor:fable-advisor', 'final review'))
  await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 'H1', agentId: 'fab1', reason: 'answer' })
  await $.turn.start({
    text: '<agent-message from="fab1">\n[Subagent hand-back] The report follows:\n  Ship it after one more gate test.\n</agent-message>',
    turnId: 'H2',
  })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /» Ship it after one more gate test\./ })).toBeDefined()
  await ui.unmount()
})

test('each rate-limit window shows the time to its reset where the main panel has room', async ($, on) => {
  // The fallback colours: a console without 256 colours.
  mock.env(on, { TERM: 'dumb' })
  engine(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  const at = (ms: number) => new Date(ms).toISOString()
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 19, resetsAt: at(3 * 3_600_000 + 10 * 60_000) },
      { kind: 'seven_day', percentUsed: 3, resetsAt: at(4 * 86_400_000 + 2 * 3_600_000) },
    ],
    changed: ['rateLimits'],
  })
  for (const cols of [64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    const five = textsIn(keyed(await ui.drawn(), 'meter-five_hour')).map(textOf)
    expect([five[0], five[4], five[5]]).toEqual(['5h', '19%', '↻ 3h 10m'])
    expect(five[6]).toMatch(/^\d\d:\d\d$/)
    expect(textsIn(keyed(await ui.drawn(), 'meter-seven_day')).map(textOf)).toContain('↻ 4d 2h')
    await ui.unmount()
  }
  const narrow = await $.ui.mount({ ...pane(24), surface: 'terminal' })
  expect(await narrow.find({ text: /^19%$/ })).toBeDefined()
  expect(await narrow.find({ text: /↻/ })).toBeUndefined() // no room: the meters stay whole
  await narrow.unmount()
})

test("the main box shows the last request's time to first token, and no tokens per second", async ($, on) => {
  const clock = engine(on)
  // The model beneath: 800 ms to its first words, then 2 s more to stop after 120 tokens.
  on('turn.step', async function* () {
    await clock.sleep(800)
    yield { kind: 'text' as const, index: 0, text: 'hello' }
    await clock.sleep(2000)
    const usage = { input_tokens: 10, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: 'S1', index: 0, answer: 'hello', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  const before = await $.ui.mount({ ...pane(40), surface: 'terminal' })
  expect(await before.find({ text: /ttft/ })).toBeUndefined() // nothing measured yet: no line
  await before.unmount()
  const s = $.turn.step({ turnId: 'S1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  const first = s.next()
  await clock.advance(800)
  expect((await first).value).toEqual({ kind: 'text', index: 0, text: 'hello' })
  const stop = s.next()
  await clock.advance(2000)
  await stop
  for await (const _ of s) void _
  await s.result
  for (const cols of [40, 64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    expect(await ui.find({ text: /ttft 0\.8s$/ })).toBeDefined()
    expect(await ui.find({ text: /tok\/s/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('on a graphical surface, rows of marks hold fewer marks and clip at their box; the gate is a meter', async ($, on) => {
  engine(on)
  // The newest check is the one refused: its ✕ must stay in sight.
  on('tool.check', (_$, e) => ({ decision: e.tool_use_id === 'g29' ? 'deny' : 'allow' }))
  const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
  on('turn.step', async function* () {
    return { turnId: 'G1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  for (let i = 0; i < 30; i += 1) await $.tool.check({ tool: 'Read', input: { file_path: `/f${i}.ts` }, tool_use_id: `g${i}` })
  // A loop that is no card and no architect: a dot on the "other loops" row.
  const s = $.turn.step({ turnId: 'G1', index: 0, model: 'claude-opus-5-5', messageCount: 1, agentId: 'wf1' })
  for await (const _ of s) void _
  await s.result
  await $.session
    .append({
      message: { type: 'assistant', role: 'assistant', content: [{ type: 'server_tool_use', id: 'srvG', name: 'advisor', input: {} }] as never },
      door: 'response',
      origin: { kind: 'model', model: 'claude-opus-5-5' } as never,
      uuid: 'marks-row',
    })
    .catch(() => undefined)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    for (const cols of [40, 64, 120]) {
      const ui = await $.ui.mount({ ...pane(cols), surface })
      // The gate is a meter, not a row of marks: 29 allowed and 1 denied fill it, the denied cell last.
      const cells = cols === 40 ? 5 : 10
      if (surface === 'terminal') {
        const bar = textsIn(keyed(await ui.drawn(), 'meter-gate'))[1]
        expect(textOf(bar)).toBe('━'.repeat(cells))
        expect(bar?.children?.filter(isDrawn).map(x => x.props?.color)).toEqual(['success', 'error'])
      } else {
        // A graphical surface draws it as SVG in the roles' hex: success, then the denied run in error.
        const svg = (await ui.findAll({ type: 'Svg' })).find(x => /^all /.test(String((x as Drawn).props?.alt))) as Drawn | undefined
        const source = String(svg?.props?.source ?? '')
        expect(source.indexOf('#16a34a')).toBeGreaterThan(-1)
        expect(source.indexOf('#dc2626')).toBeGreaterThan(source.indexOf('#16a34a'))
        expect(source).toContain(`width="${cells * 7}"`)
      }
      expect((await ui.find({ type: 'Text', text: /^●$/ }))?.props.wrap).toBe('truncate-start')
      expect(keyed(await ui.drawn(), 'timeline')?.children?.filter(isDrawn)[0]?.props?.wrap).toBe('truncate-middle')
      expect((await ui.find({ key: 'legend' }))?.props.marginBottom).toBe(surface === 'terminal' ? 0 : 1)
      await ui.unmount()
    }
  }
})

test("the inline summary's gate is the meter, with its counts", async ($, on) => {
  engine(on)
  on('tool.check', (_$, e) => ({ decision: e.tool_use_id === 'n59' ? 'deny' : 'allow' }))
  for (let i = 0; i < 60; i += 1) await $.tool.check({ tool: 'Bash', input: { command: `ls ${i}` }, tool_use_id: `n${i}` })
  for (const surface of ['terminal', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...pane(80), props: { ...pane(80).props, placement: 'inline' as const }, surface })
    const bar = (await ui.find({ type: 'Text', text: /^━{10}$/ })) as unknown as Drawn
    expect(bar?.children?.filter(isDrawn).map(x => x.props?.color)).toEqual(['success', 'error'])
    expect(await ui.find({ text: /59 allowed/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /[▪■○]{2,}/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('a draw that fails says why instead of leaving the pane empty', async ($, on) => {
  on('ui.status', () => ({ value: undefined }))
  on('clock.now', () => {
    throw new Error('boom')
  })
  for (const cols of [40, 64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    expect(await ui.find({ text: /^draw failed \(throw\)/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a finished agent that takes another step (resumed by SendMessage) runs again, in the pane and the status line', { options: { statusLine: true } }, async ($, on) => {
  // engine(on), with a status line that keeps what it was told
  mock.clock(on)
  const status: (string | undefined)[] = []
  on('ui.status', (_$, e) => (status.push(e.text), { value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'r1' }))
  const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-sonnet-5-5' }
  on('turn.step', async function* () {
    return { turnId: 'R1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  const step = async () => {
    const s = $.turn.step({ turnId: 'R1', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId: 'r1' })
    for await (const _ of s) void _
    await s.result
  }
  await $.turn.start({ text: 'go', turnId: 'T1' })
  await $.agent.spawn(spawn('general-purpose', 'Audit the parser'))
  await step()
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'R1', agentId: 'r1', reason: 'answer' })
  expect(status[status.length - 1]).toMatch(/agents 0\/1/)
  await step()
  expect(status[status.length - 1]).toMatch(/agents 1\/1/)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /● running/ })).toBeDefined()
  expect(await ui.find({ text: /✓ done/ })).toBeUndefined()
  expect(await ui.find({ text: /^resumed$/ })).toBeDefined()
  expect(await ui.find({ text: /ctx 10 · out 10 · 2 st/ })).toBeDefined()
  await ui.unmount()
})

test('the docked pane asks for the width set in paneColumns, over a transparent backdrop', { options: { paneColumns: 46 } }, async ($, on) => {
  engine(on)
  const asked: (number | undefined)[] = []
  const backdrops: unknown[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', (_$, e) => (asked.push(e.columns), backdrops.push(e.backgroundColor), { value: { isPlaced: true as const } }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  expect(asked).toEqual([46])
  expect(backdrops).toEqual(['transparent'])
})

test('the context gauge measures against a compaction window set below the model window', () => {
  const u = { ...DEFAULT_USAGE, tokens: 200_000, window: 1_000_000, compactWindow: 400_000 }
  // From the real reading, not the model's percentage: 200k of 400k.
  expect(contextFill(u)).toEqual({ pct: 50, window: 400_000 })
  expect(contextFill({ ...u, tokens: 100_000 })).toEqual({ pct: 25, window: 400_000 })
  // None set, or not below the model's window: the model's window.
  expect(contextFill({ ...u, compactWindow: null })).toEqual({ pct: 20, window: 1_000_000 })
  expect(contextFill({ ...u, compactWindow: 1_000_000 })).toEqual({ pct: 20, window: 1_000_000 })
  expect(contextFill({ ...u, compactWindow: 1_500_000 })).toEqual({ pct: 20, window: 1_000_000 })
  expect(contextFill({ ...u, compactWindow: 0 })).toEqual({ pct: 20, window: 1_000_000 })
  // No reading yet, no gauge; and none from a window not yet known.
  expect(contextFill({ ...u, tokens: null })).toEqual({ pct: null, window: 400_000 })
  expect(contextFill(DEFAULT_USAGE)).toEqual({ pct: null, window: 0 })
  expect(contextFill({ ...DEFAULT_USAGE, tokens: 5 }).pct).toBeNull()
})

test('a breakdown names a compaction window only when auto-compaction is on and it is below the model window', () => {
  const on = { rawMaxTokens: 400_000, isAutoCompactEnabled: true }
  expect(compactWindowOf(on, 1_000_000)).toBe(400_000)
  expect(compactWindowOf({ ...on, isAutoCompactEnabled: false }, 1_000_000)).toBeNull()
  expect(compactWindowOf({ ...on, rawMaxTokens: 1_000_000 }, 1_000_000)).toBeNull() // the model's own limit
  expect(compactWindowOf(on, 200_000)).toBeNull() // a model switch to a smaller window
  expect(compactWindowOf({ ...on, rawMaxTokens: 0 }, 1_000_000)).toBeNull()
  expect(compactWindowOf(undefined, 1_000_000)).toBeNull() // no breakdown: unknown
  expect(compactWindowOf(null, 1_000_000)).toBeNull()
})

/** A session whose `session.usage` answers as a host does: the breakdown only to a call that asks for one. */
const compactHost = (on: On, o: { window: () => number; compact: number | null; isEnabled?: boolean; tokens?: number }) => {
  const asked: (string | undefined)[] = []
  on('session.usage', (_$, e) => {
    asked.push(e.breakdown)
    const window = o.window()
    const breakdown =
      e.breakdown && o.compact !== null
        ? { rawMaxTokens: o.compact, isAutoCompactEnabled: o.isEnabled ?? true, totalTokens: 123, percentage: 99 }
        : undefined
    return { value: { startedAt: 0, rateLimits: [], context: { window, ...(o.tokens !== undefined ? { tokens: o.tokens } : {}), ...(breakdown ? { breakdown: breakdown as never } : {}) } } }
  })
  return asked
}

test('the gauge, status and inline summary measure against the compaction window, read once per model window', { options: { statusLine: true } }, async ($, on) => {
  // The fallback colours: a console without 256 colours.
  mock.env(on, { TERM: 'dumb' })
  mock.clock(on)
  let status: string | undefined
  on('ui.status', (_$, e) => {
    status = e.text
    return { value: undefined }
  })
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  let window = 1_000_000
  const asked = compactHost(on, { window: () => window, compact: 400_000 })
  const measure = (tokens: number) =>
    $.session.measure({ context: { window, tokens, percent: tokens / (window / 100) }, rateLimits: [], changed: ['context'] })
  await measure(100_000)
  await measure(150_000)
  await measure(200_000)
  // Three measurements, one summary breakdown: never `full`, which would send token-count requests.
  expect(asked.filter(Boolean)).toEqual(['summary'])
  expect(status).toBe('ctx 50%') // not the host's 20% of a million
  for (const cols of [40, 64, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    expect(await ui.find({ text: /200k\/400k/ })).toBeDefined()
    expect(await ui.find({ text: /(^| )50%/ })).toBeDefined()
    expect(await ui.find({ text: /1\.0M/ })).toBeUndefined()
    await ui.unmount()
    const mini = await $.ui.mount({ ...pane(cols), props: { ...pane(cols).props, placement: 'inline' as const }, surface: 'terminal' })
    expect(await mini.find({ text: /(^| )50%/ })).toBeDefined()
    await mini.unmount()
  }
  // Past 80% of the compaction window the gauge warns, though the model's window has room.
  await measure(340_000)
  const warn = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect((await warn.find({ type: 'Text', text: /^━+╸?$/ }))?.props.color).toBe('error')
  expect(await warn.find({ text: /(^| )85%/ })).toBeDefined()
  await warn.unmount()
  // A model with a smaller window: read again, and a compaction window above it no longer counts.
  window = 200_000
  await measure(100_000)
  expect(asked.filter(Boolean)).toEqual(['summary', 'summary'])
  const small = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await small.find({ text: /100k\/200k/ })).toBeDefined()
  await small.unmount()
})

const keepsModelWindow = (name: string, host: { compact: number | null; isEnabled?: boolean }, asks: number) =>
  test(name, async ($, on) => {
    mock.clock(on)
    on('ui.status', () => ({ value: undefined }))
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    const asked = compactHost(on, { window: () => 1_000_000, ...host })
    for (const tokens of [50_000, 100_000, 200_000, 250_000, 300_000]) {
      await $.session.measure({ context: { window: 1_000_000, tokens, percent: tokens / 10_000 }, rateLimits: [], changed: ['context'] })
    }
    // An answer is asked for once; no breakdown (no session bound yet) is asked again, COMPACT_TRIES in all.
    expect(asked.filter(Boolean).length).toBe(asks)
    for (const cols of [40, 64, 120]) {
      const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
      expect(await ui.find({ text: /300k\/1\.0M/ })).toBeDefined()
      expect(await ui.find({ text: /(^| )30%/ })).toBeDefined()
      await ui.unmount()
    }
  })

keepsModelWindow('a host that gives no breakdown keeps the model window and stops asking after 3 tries', { compact: null }, 3)
keepsModelWindow('with auto-compaction off the gauge keeps the model window and is asked once', { compact: 400_000, isEnabled: false }, 1)

test('a resumed session reads its compaction window at start, and /clear leaves the reading alone', async ($, on) => {
  mock.clock(on)
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('command.register', () => ({ value: { command: 'flightdeck' } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  // Resumed with 200k already in context.
  const asked = compactHost(on, { window: () => 1_000_000, compact: 400_000, tokens: 200_000 })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(asked).toEqual([undefined, 'summary'])
  const resumed = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await resumed.find({ text: /200k\/400k/ })).toBeDefined()
  expect(await resumed.find({ text: /(^| )50%/ })).toBeDefined()
  await resumed.unmount()
  // The gauge waits for the next measurement after a /clear; the compaction window is not asked again.
  await $.session.end({ reason: 'clear', sessionId: 's' } as never)
  await $.session.measure({ context: { window: 1_000_000, tokens: 100_000, percent: 10 }, rateLimits: [], changed: ['context'] })
  expect(asked).toEqual([undefined, 'summary'])
  const cleared = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await cleared.find({ text: /100k\/400k/ })).toBeDefined()
  expect(await cleared.find({ text: /(^| )25%/ })).toBeDefined()
  await cleared.unmount()
})

test('a compaction-window read that fails is asked again at the next measurement', async ($, on) => {
  mock.clock(on)
  on('ui.status', () => ({ value: undefined }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  let reads = 0
  on('session.usage', (_$, e) => {
    if (e.breakdown && ++reads === 1) return { deny: 'not bound yet' }
    const breakdown = e.breakdown ? { rawMaxTokens: 400_000, isAutoCompactEnabled: true } : undefined
    return { value: { startedAt: 0, rateLimits: [], context: { window: 1_000_000, ...(breakdown ? { breakdown: breakdown as never } : {}) } } }
  })
  const measure = (tokens: number) =>
    $.session.measure({ context: { window: 1_000_000, tokens, percent: tokens / 10_000 }, rateLimits: [], changed: ['context'] })
  await measure(100_000)
  const failed = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await failed.find({ text: /100k\/1\.0M/ })).toBeDefined()
  await failed.unmount()
  await measure(200_000)
  await measure(300_000)
  expect(reads).toBe(2) // the failed read once more, then not again
  const read = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await read.find({ text: /300k\/400k/ })).toBeDefined()
  expect(await read.find({ text: /(^| )75%/ })).toBeDefined()
  await read.unmount()
})

test('a compaction-window read is claimed once per model window, missed reads retried up to a cap, stale ones dropped', () => {
  const b = { rawMaxTokens: 400_000, isAutoCompactEnabled: true }
  const fresh = { ...DEFAULT_USAGE, window: 1_000_000 }
  const first = claimCompactRead(fresh, 1_000_000)
  expect([first.isClaimed, first.usage.compactFor]).toEqual([true, 1_000_000])
  expect(claimCompactRead(first.usage, 1_000_000).isClaimed).toBe(false) // already claimed
  expect(afterCompactRead(first.usage, 1_000_000, b).compactWindow).toBe(400_000)
  // A read for a window no longer claimed (the model switched while it ran) changes nothing.
  const switched = claimCompactRead({ ...first.usage, window: 1_000_000 }, 200_000).usage
  expect(afterCompactRead(switched, 1_000_000, b)).toBe(switched)
  // A miss (no breakdown, or a failed call) gives the claim back and counts; COMPACT_TRIES misses stop asking.
  let u = first.usage
  for (let i = 0; i < COMPACT_TRIES; i += 1) {
    const c = claimCompactRead(u, 1_000_000)
    expect(c.isClaimed || i === 0).toBe(true)
    u = afterCompactRead(c.isClaimed ? c.usage : u, 1_000_000, i % 2 ? null : undefined)
  }
  expect([u.compactFor, u.compactMisses, u.compactWindow]).toEqual([0, COMPACT_TRIES, null])
  expect(claimCompactRead(u, 1_000_000).isClaimed).toBe(false)
  // Another model window, or another model, starts afresh.
  expect(claimCompactRead(u, 200_000).isClaimed).toBe(true)
  expect(claimCompactRead(forgetCompactRead({ ...u, compactWindow: 400_000 }), 1_000_000).isClaimed).toBe(true)
  expect(forgetCompactRead({ ...u, compactWindow: 400_000 }).compactWindow).toBe(null)
})

test("a surface module's fault key is the same for the hook's path, either separator, and the drawing's name", () => {
  expect(faultKey('desktop', 'hooks/rail.tsx')).toBe('desktop:rail.tsx')
  expect(faultKey('desktop', 'hooks\\rail.tsx')).toBe(faultKey('desktop', 'rail.tsx'))
  expect(faultKey('terminal', 'hooks/elapsed.tsx')).not.toBe(faultKey('desktop', 'hooks/elapsed.tsx'))
})

test('switching to another model with the same window reads its compaction window afresh', async ($, on) => {
  mock.clock(on)
  on('ui.status', () => ({ value: undefined }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  let compact = 400_000
  let reads = 0
  on('session.usage', (_$, e) => {
    if (e.breakdown) reads += 1
    const breakdown = e.breakdown ? { rawMaxTokens: compact, isAutoCompactEnabled: true } : undefined
    return { value: { startedAt: 0, rateLimits: [], context: { window: 1_000_000, ...(breakdown ? { breakdown: breakdown as never } : {}) } } }
  })
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'x' }
  on('turn.step', async function* () {
    return { turnId: 'M1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  const step = async (model: string) => {
    const s = $.turn.step({ turnId: 'M1', index: 0, model, messageCount: 1 })
    for await (const _ of s) void _
    await s.result
  }
  const measure = (tokens: number) =>
    $.session.measure({ context: { window: 1_000_000, tokens, percent: tokens / 10_000 }, rateLimits: [], changed: ['context'] })
  await step('claude-opus-5-5[1m]')
  await measure(300_000)
  await step('claude-opus-5-5[1m]')
  await measure(360_000)
  expect(reads).toBe(1) // the same model: not asked again
  // Another 1M model whose own autoCompactWindow (modelSettings) is 700k.
  compact = 700_000
  await step('claude-sonnet-5-5[1m]')
  await measure(360_000)
  expect(reads).toBe(2)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /360k\/700k/ })).toBeDefined()
  expect(await ui.find({ text: /(^| )51%/ })).toBeDefined()
  await ui.unmount()
})

test('a resume through agent.spawn logs once, whether its spawn or its first step lands first; "done" times the run', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.status', () => ({ value: undefined }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-sonnet-5-5' }
  on('turn.step', async function* () {
    return { turnId: 'R1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  const step = async () => {
    const s = $.turn.step({ turnId: 'R1', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId: 'r1' })
    for await (const _ of s) void _
    await s.result
  }
  // A resumed agent may take its first step before its spawn's own hooks have finished.
  let isStepFirst = false
  on('agent.spawn', async (_$, e) => {
    if (e.resume && isStepFirst) await step()
    return { model: 'claude-sonnet-5-5', agentId: e.resume?.agentId ?? 'r1' }
  })
  const complete = (durationMs: number) =>
    $.turn.complete({ answer: 'ok', durationMs, isAborted: false, turnId: 'R1', agentId: 'r1', reason: 'answer' })
  const lines = async (re: RegExp) => {
    const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
    const n = (await ui.findAll({ text: re })).length
    await ui.unmount()
    return n
  }
  await $.turn.start({ text: 'go', turnId: 'T1' })
  await $.agent.spawn(spawn('general-purpose', 'Audit the parser'))
  await step()
  await clock.advance(60_000)
  await complete(60_000)
  // Idle half an hour, then resumed: the spawn first, then its step.
  await clock.advance(30 * 60_000)
  await $.agent.spawn({ ...spawn('general-purpose', 'Audit it again'), resume: { agentId: 'r1' } })
  await step()
  expect(await lines(/^resumed$/)).toBe(1)
  await clock.advance(90_000)
  await complete(90_000)
  // Resumed again, its first step landing inside the spawn.
  isStepFirst = true
  await $.agent.spawn({ ...spawn('general-purpose', 'And once more'), resume: { agentId: 'r1' } })
  expect(await lines(/^resumed$/)).toBe(2)
  expect(await lines(/^Audit the parser$/)).toBe(0) // one card, the latest task
  // Each run timed on its own, not from the first spawn.
  expect(await lines(/^done · 1m 00s$/)).toBe(1)
  expect(await lines(/^done · 1m 30s$/)).toBe(1)
})

test("a subagent's turn start is its own: no prompt line, and the main turn keeps its count", async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.turn.start({ text: 'refactor it', turnId: 'T1' })
  await $.tool.call({ tool: 'Edit', file_path: '/x.ts', old_string: 'a', new_string: 'b' } as never)
  await $.turn.start({ text: 'Look at the parser again', turnId: 'A1', agentId: 'sub1' })
  await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 'T1', reason: 'answer' })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /Look at the parser again/ })).toBeUndefined()
  expect(await ui.find({ text: /refactor it/ })).toBeDefined()
  expect(await ui.find({ text: /· 1 edit ·/ })).toBeDefined()
  await ui.unmount()
})

test('a line keeps the pieces that fit, in order, counting each lead and the gaps between them', () => {
  const pieces = [{ width: 5 }, { width: 5, lead: 2 }, { width: 3 }]
  expect([piecesThatFit(pieces, 13, 1), piecesThatFit(pieces, 12, 1), piecesThatFit(pieces, 17, 1), piecesThatFit(pieces, 4, 1)]).toEqual([2, 1, 3, 0])
  expect([cellWidth('■ ▰▱ 48%'), cellWidth('')]).toEqual([8, 0])
})

// ---------------------------------------------------------------- width check

// The kit lays nothing out, so this measures the drawn tree as a row layout would: the fewest cells
// each element needs without spilling (a truncating Text or a clipping Box needs none, a Text that
// asks to wrap its longest word, any other Text its whole length, a plain Button with a hotkey `1: `
// more than its label), and checks that every Box given a width holds what it contains.
type Drawn = { type: string; props?: Record<string, unknown>; children?: unknown[] }
const isDrawn = (n: unknown): n is Drawn => typeof n === 'object' && n !== null && typeof (n as Drawn).type === 'string'
const cellsOf = (s: string) => [...s].length
/** The Box drawn under `key`, anywhere in the tree. */
const keyed = (n: unknown, key: string): Drawn | undefined =>
  !isDrawn(n) ? undefined : n.props?.key === key ? n : (n.children ?? []).reduce<Drawn | undefined>((hit, c) => hit ?? keyed(c, key), undefined)
const textOf = (n: unknown): string =>
  typeof n === 'string' || typeof n === 'number' ? String(n) : isDrawn(n) ? (n.children ?? []).map(textOf).join('') : ''
const spaceOf = (v: unknown) => (typeof v === 'number' ? v : v === undefined ? 0 : 1)
const longestWord = (s: string) => Math.max(0, ...s.split(/\s+/).map(cellsOf))
const needs = (n: unknown, out: string[], path: string): number => {
  if (typeof n === 'string') return longestWord(n)
  if (!isDrawn(n)) return 0
  const p = n.props ?? {}
  const here = `${path}/${String(p.key ?? n.type)}`
  if (n.type === 'Text') return p.wrap === undefined ? cellsOf(textOf(n)) : p.wrap === 'wrap' ? longestWord(textOf(n)) : 1
  if (n.type === 'Button') return cellsOf(String(p.label ?? '')) + (p.plain ? (p.hotkey ? 3 : 0) : 4)
  if (n.type === 'Client') return typeof p.width === 'number' ? p.width : 5
  if (n.type !== 'Box') return 0
  const kids = (n.children ?? []).filter(c => c !== null && c !== undefined && c !== false && c !== '')
  const inner = kids.map((c, i) => needs(c, out, `${here}[${i}]`))
  const isColumn = p.flexDirection === 'column' || p.flexDirection === 'column-reverse'
  const content =
    isColumn || p.flexWrap === 'wrap'
      ? Math.max(0, ...inner)
      : inner.reduce((a, b) => a + b, 0) + spaceOf(p.columnGap ?? p.gap) * Math.max(0, inner.length - 1)
  const need = content + (p.borderStyle ? 2 : 0) + 2 * spaceOf(p.paddingX ?? p.padding)
  const margin = spaceOf(p.marginLeft) + spaceOf(p.marginRight) + 2 * spaceOf(p.marginX)
  // A Box with a width must hold its contents, clipping or not; one without clips to nothing if it may.
  if (typeof p.width === 'number') {
    if (need > p.width) out.push(`${here}: needs ${need} in ${p.width}`)
    return p.width + margin
  }
  return (p.overflow === 'hidden' ? 0 : need) + margin
}

/**
 * What a graphical surface needs of a line of text: no `truncate` Text nests Texts (the desktop app wraps the
 * nested pieces, or lays truncating ones out as blocks of their own), and no Text placed in a Box starts or
 * ends with a space (it collapses spaces, so a gap between pieces is the Box's, not the text's).
 */
const desktopFaults = (n: unknown, out: string[], path = '', parent = ''): string[] => {
  if (!isDrawn(n)) return out
  const p = n.props ?? {}
  const here = `${path}/${String(p.key ?? n.type)}`
  const kids = (n.children ?? []).filter(isDrawn)
  if (n.type === 'Text') {
    const text = textOf(n)
    if (p.wrap === 'truncate' && kids.some(k => k.type === 'Text')) out.push(`${here}: truncates nested Texts "${text}"`)
    if (parent === 'Box' && text !== text.trim()) out.push(`${here}: edge spaces "${text}"`)
    return out
  }
  kids.forEach((k, i) => desktopFaults(k, out, `${here}[${i}]`, n.type))
  return out
}
const spillsOf = (tree: unknown, columns: number) => {
  const out: string[] = []
  const need = needs(tree, out, '')
  if (need > columns) out.push(`root: needs ${need} in ${columns}`)
  return out
}

/** A session with every panel busy: a compaction window, limits, consults with advice, checks of every kind, agents, a loop. */
const busySession = async ($: Parameters<TestBody>[0], on: On) => {
  const clock = engine(on)
  splitHost(on)
  await clock.advance(3_600_000) // clocks draw as m:ss, as in a session, not as the '—' of an unknown start
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('tool.check', (_$, e) => ({ decision: (e.tool_use_id ?? '').endsWith('7') ? 'deny' : 'allow' }))
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  let n = 0
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: e.subagentType.includes('advisor') ? 'adv1' : `b${++n}` }))
  const usage = { input_tokens: 4000, output_tokens: 900, cache_read_input_tokens: 120_000, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
  on('turn.step', async function* () {
    yield { kind: 'text' as const, index: 0, text: 'ok' }
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage }
    return { turnId: 'B1', index: 0, answer: 'ok', toolUses: [], stopReason: 'end_turn' as const, usage }
  })
  const step = async (agentId?: string) => {
    const s = $.turn.step({ turnId: 'B1', index: 0, model: 'claude-opus-5-5[1m]', messageCount: 1, ...(agentId ? { agentId } : {}) })
    for await (const _ of s) void _
    await s.result
  }
  await $.session.measure({
    context: { window: 1_000_000, tokens: 360_000, percent: 36 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 82, resetsAt: new Date(3 * 3_600_000).toISOString() },
      { kind: 'seven_day_opus', percentUsed: 40, resetsAt: new Date(4 * 86_400_000).toISOString() },
    ],
    cost: { usd: 123.45 },
    changed: ['context', 'rateLimits', 'cost'],
  } as never)
  await $.turn.start({ text: 'Refactor the configuration loader and keep every public name stable please', turnId: 'B1' })
  await step()
  const tools = [
    { tool: 'Bash', input: { command: 'npm run test -- --reporter=verbose --coverage packages/configuration-loader' } },
    { tool: 'Read', input: { file_path: '/Users/someone/projects/a-very-long-repository-name/src/configuration/loader.ts' } },
    { tool: 'WebFetch', input: { url: 'https://example.com/a/very/long/documentation/path/for/the/loader' } },
  ]
  for (let i = 0; i < 60; i += 1) await $.tool.check({ ...tools[i % 3]!, tool_use_id: `k${i}` })
  await $.tool.call({ tool: 'Edit', file_path: '/x/loader.ts', old_string: 'a', new_string: 'b', tool_use_id: 'edit1' } as never)
  await $.agent.spawn(spawn('fable-advisor:fable-advisor', 'final review of the loader'))
  await $.turn.complete({
    answer: 'Ship it once the configuration loader keeps its public names and the migration test covers the old shape',
    durationMs: 9000, isAborted: false, turnId: 'A1', agentId: 'adv1', reason: 'answer',
  })
  for (const d of ['Write the configuration loader regression tests', 'Map every call site of the old loader', 'Review the migration path for saved state']) {
    await $.agent.spawn(spawn('general-purpose', d))
  }
  await step('b1')
  await step('wf-unclaimed-loop')
  await clock.advance(95_000)
  await $.turn.complete({ answer: '', durationMs: 95_000, isAborted: false, turnId: 'B1', reason: 'answer' })
  return clock
}

test('every panel fits the pane at every width from 24 columns, on every surface and placement, in lines a graphical surface keeps whole', { timeoutMs: 60_000 }, async ($, on) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  await busySession($, on)
  // A repo with a long branch and every kind of change: the main block's label row must fit too.
  gitReply = repoReply(STATUS.replace('feat/x', 'feature/a-rather-long-branch-name'))
  await $.session.start({ cwd: '/w/proj', surface: 'terminal', isInteractive: true })
  const failures: string[] = []
  const check = async (label: string) => {
    for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
      for (let cols = 24; cols <= 40; cols += 1) {
        for (const placement of ['dock', 'inline'] as const) {
          const ui = await $.ui.mount({ ...pane(cols), props: { ...pane(cols).props, placement }, surface })
          for (const s of spillsOf(await ui.drawn(), cols)) failures.push(`${label} ${surface} ${placement} ${cols}: ${s}`)
          await ui.unmount()
        }
      }
      for (const cols of [64, 120]) {
        const ui = await $.ui.mount({ ...pane(cols), surface })
        for (const s of spillsOf(await ui.drawn(), cols)) failures.push(`${label} ${surface} dock ${cols}: ${s}`)
        await ui.unmount()
      }
    }
  }
  await check('lanes, finished')
  // The gate drill-down and an expanded card open, and a turn running.
  const opener = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  await opener.press({ key: 'gate-shell' })
  await opener.press({ key: 'card-b1' })
  await opener.unmount()
  await $.turn.start({ text: 'and once more', turnId: 'B2' })
  await check('drill-down, expanded, running')
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const cols of [24, 32, 40, 64, 120]) {
      for (const placement of ['dock', 'inline'] as const) {
        const ui = await $.ui.mount({ ...pane(cols), props: { ...pane(cols).props, placement }, surface })
        for (const f of desktopFaults(await ui.drawn(), [])) failures.push(`${surface} ${placement} ${cols}: ${f}`)
        await ui.unmount()
      }
    }
  }
  // One line per panel and width that spills, the surface left out (they draw the same boxes).
  expect([...new Set(failures.map(f => f.replace(/ (terminal|desktop|vscode|mobile) /, ' ')))]).toEqual([])
})

test('a single agent card fits from 24 columns, and the time axis scales to the pane', async ($, on) => {
  const clock = engine(on)
  await clock.advance(3_600_000)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'one' }))
  await $.turn.start({ text: 'go', turnId: 'O1' })
  await $.agent.spawn(spawn('general-purpose', 'Write the configuration loader regression tests'))
  const failures: string[] = []
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    for (let cols = 24; cols <= 40; cols += 1) {
      const ui = await $.ui.mount({ ...pane(cols), surface })
      for (const s of spillsOf(await ui.drawn(), cols)) failures.push(`${surface} ${cols}: ${s}`)
      if (surface !== 'terminal') {
        // No pixel width of its own: the surface draws it at the markup's width, down to the pane's.
        const svg = await ui.find({ type: 'Svg' })
        expect([svg !== undefined, svg?.props.width, svg?.props.height]).toEqual([true, undefined, undefined])
      }
      await ui.unmount()
    }
  }
  expect(failures).toEqual([])
})

test('a running connector keeps its length every frame: one face, clipped at its width, the dot still moving', async ($, on) => {
  engine(on)
  on('tool.check', () => ({ decision: 'allow' }))
  await $.tool.check({ tool: 'Read', input: { file_path: '/a' }, tool_use_id: 'r1' })
  await $.turn.start({ text: 'go', turnId: 'R1' }) // a turn running: the connectors animate
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...pane(64), surface })
    expect((await ui.find({ key: 'link-gate' }))?.type).toBe('Client')
    const heads = new Set<number>()
    for (let frame = 0; frame < 30; frame += 1) {
      const tree = (await ui.drawn({ in: 'link-gate' })) as Drawn
      const texts: Drawn[] = []
      const walk = (n: unknown) => {
        if (!isDrawn(n)) return
        if (n.type === 'Text') texts.push(n)
        else (n.children ?? []).forEach(walk)
      }
      walk(tree)
      const line = texts.map(textOf).join('')
      // The box is the line's width and clips; its text is that width and four spare cells, every frame.
      expect([tree.type, tree.props?.width, tree.props?.overflow]).toEqual(['Box', 64, 'hidden'])
      expect(cellsOf(line)).toBe(64 + 4)
      expect(texts.every(t => t.props?.mono === true)).toBe(true)
      expect(/^[─●•┬┴]+$/.test(line)).toBe(true)
      const head = [...line].slice(0, 64).indexOf('●')
      if (head >= 0) heads.add(head)
      await ui.advance(110)
    }
    expect(heads.size > 5).toBe(true) // the dot travels along the line
    await ui.unmount()
  }
})

// ---------------------------------------------------------------- the look shared with gloss, pulse and postcard

test('a meter splits by count, every non-zero count keeping a cell, and resets read as wall-clock times', () => {
  expect(segments([115, 12, 26, 0], 10)).toEqual([7, 1, 2, 0])
  expect(segments([29, 0, 0, 1], 5)).toEqual([4, 0, 0, 1])
  expect(segments([0, 0], 10)).toEqual([0, 0])
  expect(segments([1, 1, 1, 1], 3).reduce((a, b) => a + b, 0)).toBe(3)
  expect(fmtResetAt(null, 0)).toBe('')
  expect(fmtResetAt(3_600_000, 0)).toMatch(/^\d\d:\d\d$/)
  expect(fmtResetAt(3 * 86_400_000, 0)).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d\d:\d\d$/)
})

test("a block's label row gives the label its room first, the status only where the label keeps 6 cells", () => {
  expect(headFit(62, 15, 9)).toEqual({ label: 15, showRight: true })
  expect(headFit(20, 15, 9)).toEqual({ label: 10, showRight: true })
  expect(headFit(16, 15, 12)).toEqual({ label: 15, showRight: false })
  expect(ruleLine(8, [3, 6])).toBe('───┴──┴─')
  expect(ruleLine(5, [2], '┬')).toBe('──┬──')
  expect(gauge(64, 10)).toEqual({ on: '━━━━━━╸', off: '───' })
  expect([heatOf(30), heatOf(64), heatOf(82)]).toEqual(['calm', 'warm', 'hot'])
})

const textsIn = (n: unknown, out: Drawn[] = []): Drawn[] => {
  if (!isDrawn(n)) return out
  if (n.type === 'Text') out.push(n)
  ;(n.children ?? []).forEach(c => textsIn(c, out))
  return out
}
const boxesIn = (n: unknown, out: Drawn[] = []): Drawn[] => {
  if (!isDrawn(n)) return out
  if (n.type === 'Box') out.push(n)
  ;(n.children ?? []).forEach(c => boxesIn(c, out))
  return out
}

test('panels are full rounded blocks in theme colours, cards are rounded boxes in the agents block', { options: { motion: 'off' } }, async ($, on) => {
  // The fallback colours: a console without 256 colours.
  mock.env(on, { TERM: 'dumb' })
  engine(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('tool.check', (_$, e) => ({ decision: e.tool_use_id === 'd1' ? 'deny' : e.tool_use_id === 'a1' ? 'ask' : 'allow' }))
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `o${++n}` }))
  await $.session.measure({
    context: { window: 200_000, tokens: 128_000, percent: 64 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 82 }],
    changed: ['context', 'rateLimits'],
  } as never)
  await $.turn.start({ text: 'go', turnId: 'L1' })
  for (const id of ['r1', 'a1', 'd1']) await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: id })
  await $.agent.spawn(spawn('general-purpose', 'Write the tests'))
  await $.agent.spawn(spawn('Explore', 'Map the code'))
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'X', agentId: 'o2', reason: 'answer' })

  const ui = await $.ui.mount({ ...pane(66), surface: 'terminal' })
  const tree = await ui.drawn()
  const texts = textsIn(tree)
  const first = (re: RegExp) => texts.find(t => re.test(textOf(t)))
  // Every block is a full round border with one cell of padding, no fill: main, gate, the inbox (d1 was denied), agents with its two
  // cards inside (the finished one dimmed), the running turn and the log, each in its panel colour.
  const framed = boxesIn(tree).filter(b => b.props?.borderStyle)
  expect(framed.map(b => [b.props?.borderStyle, b.props?.borderColor, b.props?.paddingX, b.props?.borderDimColor === true])).toEqual([
    ['round', 'claude', 1, false],
    ['round', 'suggestion', 1, false],
    ['round', 'error', 1, false],
    ['round', 'planMode', 1, false],
    ['round', 'planMode', 1, false],
    ['round', 'planMode', 1, true],
    ['round', 'claude', 1, false],
    ['round', 'inactive', 1, false],
  ])
  expect(boxesIn(tree).some(b => b.props?.backgroundColor !== undefined)).toBe(false)
  expect(texts.some(t => /^[╭╰]/.test(textOf(t)))).toBe(false)
  // The main block reads as the statusline: the model bold in the accent, then a meter per row.
  const model = textsIn(keyed(tree, 'main-head'))[0]
  expect([model?.props?.color, model?.props?.weight]).toEqual(['claude', 'bold'])
  expect(first(/^● working$/)?.props?.color).toBe('claude')
  // Fills heat up as the statusline's bars do: 64% in the warning colour, 82% in the error colour, value alike.
  const meter = (key: string) => textsIn(keyed(tree, key)).map(t => [textOf(t), t.props?.color])
  expect(meter('meter-ctx')).toEqual([['ctx', undefined], ['━━━━━━╸───', undefined], ['━━━━━━╸', 'warning'], ['───', 'subtle'], ['64%', 'warning'], ['128k/200k', undefined]])
  expect(meter('meter-five_hour').slice(4, 5)).toEqual([['82%', 'error']])
  // The gate meter: allowed, pending and denied in their colours, no row of marks.
  expect(meter('meter-gate').slice(2, 5)).toEqual([['━━━━', 'success'], ['━━━', 'warning'], ['━━━', 'error']])
  expect(texts.some(t => /^[▪■○✕]{2,}$/.test(textOf(t)))).toBe(false)
  expect(first(/^· 1 pending$/)).toBeDefined()
  // Effort is a word in the statusline's grammar, no dots.
  expect(texts.some(t => /[●○]{2,}/.test(textOf(t)))).toBe(false)
  // A still connector fans out from the agents' label row to the two 30-column cards' centres.
  const fan = texts.filter(t => /^[─┬]+$/.test(textOf(t)) && textOf(t).includes('┬'))
  expect(fan.map(textOf)).toEqual([`${'─'.repeat(15)}┬${'─'.repeat(30)}┬${'─'.repeat(15)}`])
  expect(fan.every(t => t.props?.color === 'subtle')).toBe(true)
  expect(first(/^● running$/)?.props?.color).toBe('planMode')
  expect(first(/^✓ done$/)?.props?.color).toBe('success')
  expect(first(/^Turn$/)?.props?.color).toBe('claude')
  await ui.unmount()

  // The finished turn: its time on the right of the label, ✓ in the success colour, the block dimmed.
  await $.turn.complete({ answer: 'ok', durationMs: 95_000, isAborted: false, turnId: 'L1', reason: 'answer' })
  const done = await $.ui.mount({ ...pane(66), surface: 'terminal' })
  const drawn = await done.drawn()
  const after = textsIn(drawn)
  expect(after.find(t => textOf(t) === 'Last turn')?.props?.dimColor).toBe(true)
  expect(after.find(t => textOf(t) === '✓ 1m 35s')?.props?.color).toBe('success')
  // Main, the dimmed last turn, then the trends its finish began.
  expect(boxesIn(drawn).filter(b => b.props?.borderStyle && b.props?.borderColor === 'claude').map(b => b.props?.borderDimColor === true)).toEqual([false, true, false])
  await done.unmount()
})

test('the viewed card is drawn bold, the others round', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `v${++n}` }))
  await $.agent.spawn(spawn('general-purpose', 'Write the tests'))
  await $.agent.spawn(spawn('Explore', 'Map the code'))
  const ui = await $.ui.mount({ ...pane(66), surface: 'terminal', props: { ...pane(66).props, view: { agentId: 'v2' } } } as never)
  const cards = boxesIn(await ui.drawn()).filter(b => b.props?.borderColor === 'planMode')
  expect(cards.map(b => b.props?.borderStyle)).toEqual(['round', 'round', 'bold']) // the block, then its two cards
  await ui.unmount()
})

test('a status glyph and the words it marks share one colour, in glyphs no terminal draws as emoji', async ($, on) => {
  const clock = engine(on)
  await clock.advance(3_600_000)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `c${++n}` }))
  await $.turn.start({ text: 'go', turnId: 'C1' })
  for (const d of ['one', 'two', 'three', 'four']) await $.agent.spawn(spawn('general-purpose', d))
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'X', agentId: 'c1', reason: 'answer' })
  await $.turn.complete({ answer: 'ok', durationMs: 26_000, isAborted: false, turnId: 'C1', reason: 'answer' })
  for (const cols of [66, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    const texts = textsIn(await ui.drawn())
    // Every Text drawing ✓ draws it, and whatever follows in the same Text, in the success colour.
    const ticks = texts.filter(t => textOf(t).includes('✓'))
    expect(ticks.length > 0).toBe(true)
    expect(ticks.every(t => t.props?.color === 'success' && (t.children ?? []).filter(isDrawn).every(k => k.props?.color === undefined || k.props?.color === 'success'))).toBe(true)
    expect(texts.find(t => textOf(t) === '✓ 26s')?.props?.color).toBe('success')
    // ✔ ▪ ▶ ⏸ draw as colour emoji in some terminals (Warp), whatever colour they are given.
    expect(texts.some(t => /[✔▪▶⏸]/.test(textOf(t)))).toBe(false)
    await ui.unmount()
  }
})

test('every gap between blocks is one row, whatever is in it', { timeoutMs: 60_000 }, async ($, on) => {
  await busySession($, on)
  // One row on top, then the header; blocks one row apart: a connector, or an empty row.
  const gapsOf = (tree: unknown) => {
    const out: string[] = []
    const walk = (n: unknown) => {
      if (!isDrawn(n)) return
      const kids = (n.children ?? []).filter(isDrawn)
      if (kids.some(k => String(k.props?.key ?? '').startsWith('block-'))) {
        kids.forEach((k, i) => {
          const key = String(k.props?.key ?? '')
          const isBlock = key.startsWith('block-')
          // Blocks and gaps alternate, a block first and last.
          if (isBlock !== (i % 2 === 0)) out.push(`${i}: ${key || k.type} out of turn`)
          if (isBlock) {
            const inner = (k.children ?? []).filter(isDrawn)[0]
            if (inner?.props?.marginTop || inner?.props?.marginBottom) out.push(`${key}: has a margin`)
            return
          }
          const isRow =
            (k.type === 'Client' && k.props?.height === 1) ||
            (k.type === 'Text' && !textOf(k).includes('\n')) ||
            (k.type === 'Box' && k.props?.height === 1 && (k.children ?? []).filter(isDrawn).length === 0)
          if (!isRow) out.push(`${i}: ${key || k.type} is not one row`)
        })
        if (kids.length % 2 === 0) out.push('ends on a gap')
      }
      kids.forEach(walk)
    }
    walk(tree)
    return out
  }
  const failures: string[] = []
  const check = async (label: string) => {
    for (const cols of [24, 40, 64, 120]) {
      const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
      const tree = await ui.drawn()
      for (const f of gapsOf(tree)) failures.push(`${label} ${cols}: ${f}`)
      if (!JSON.stringify(tree).includes('"block-log"')) failures.push(`${label} ${cols}: no blocks found`)
      expect((tree as Drawn).props?.paddingTop).toBe(1)
      await ui.unmount()
    }
  }
  await check('lanes, finished')
  const opener = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  await opener.press({ key: 'card-b1' })
  await opener.unmount()
  await $.turn.start({ text: 'and once more', turnId: 'B2' })
  await check('expanded, running')
  expect(failures).toEqual([])
})

test('the header is one compact row and the legend uses ■ swatches', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...pane(66), surface: 'terminal' })
  const texts = textsIn(await ui.drawn())
  expect(texts.find(t => textOf(t) === 'Flightdeck')?.props?.color).toBe('claude')
  expect(texts.filter(t => textOf(t) === '■').map(t => t.props?.color)).toEqual(['claude', 'planMode', 'suggestion'])
  await ui.unmount()
})

// ---------------------------------------------------------------- the session folder in the main block

const STATUS = ['# branch.oid 0123456789abcdef', '# branch.head feat/x', '1 .M N... 100644 100644 100644 a a a.ts', '1 A. N... 0 100644 100644 0 b b.ts', '? c.ts', '1 D. N... 100644 0 0 d 0 d.ts'].join('\n')
const repoReply = (status: string) => (argv: readonly string[]): GitReply =>
  argv.includes('status')
    ? { exitCode: 0, stdout: status, stderr: '' }
    : { exitCode: 0, stdout: 'git@github.com:healkeiser/claude-plugins.git\n', stderr: '' }
const headOf = async (ui: { drawn: () => Promise<unknown> }) => textOf(keyed(await ui.drawn(), 'main-head'))
const linksIn = (n: unknown, out: Drawn[] = []): Drawn[] => {
  if (!isDrawn(n)) return out
  if (n.type === 'Link') out.push(n)
  ;(n.children ?? []).forEach(c => linksIn(c, out))
  return out
}
const start = ($: Parameters<TestBody>[0], on: On) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  return $.session.start({ cwd: '/w/proj', surface: 'terminal', isInteractive: true })
}

test('git output reads as the statusline reads it', () => {
  expect(parseGitStatus(STATUS)).toEqual({ branch: 'feat/x', added: 2, modified: 1, deleted: 1 })
  expect(parseGitStatus('# branch.oid 0123456789abcdef\n# branch.head (detached)\n').branch).toBe('(0123456)')
  expect(remoteUrl('git@github.com:owner/repo.git\n')).toBe('https://github.com/owner/repo')
  expect(remoteUrl('https://example.com/owner/repo.git')).toBe('https://example.com/owner/repo')
  expect([folderOf('/w/proj'), folderOf('C:\\Users\\me\\my repo\\'), fileUri('C:\\Users\\me\\my repo')]).toEqual(['proj', 'my repo', 'file:///C:/Users/me/my%20repo'])
})

test('the main block names the folder, its origin, the branch and its changes', async ($, on) => {
  engine(on)
  gitReply = repoReply(STATUS)
  await start($, on)
  expect(gitCalls).toEqual([
    ['git', '-C', '/w/proj', '--no-optional-locks', 'status', '--porcelain=v2', '--branch'],
    ['git', '-C', '/w/proj', '--no-optional-locks', 'remote', 'get-url', 'origin'],
  ])
  const ui = await $.ui.mount({ ...pane(80), surface: 'terminal' })
  expect(await headOf(ui)).toMatch(/· proj ↗\uFE0E· feat\/x \+2 ~1 -1/) // pieces sit a Box gap apart, their texts read back to back
  expect(linksIn(await ui.drawn()).map(l => l.props?.href)).toEqual(['file:///w/proj', 'https://github.com/healkeiser/claude-plugins'])
  const texts = textsIn(keyed(await ui.drawn(), 'main-head'))
  expect(['feat/x', ' +2', ' ~1', ' -1'].map(x => texts.find(t => textOf(t) === x)?.props?.color)).toEqual([undefined, 'success', 'warning', 'error'])
  await ui.unmount()
  // Narrower, the link and the changes go first, then the branch.
  const mid = await $.ui.mount({ ...pane(32), surface: 'terminal' })
  expect(await headOf(mid)).toMatch(/· proj· feat\/x(?! \+)/)
  expect(await headOf(mid)).not.toMatch(/↗/)
  await mid.unmount()
  const narrow = await $.ui.mount({ ...pane(24), surface: 'terminal' })
  expect(await headOf(narrow)).not.toMatch(/feat/)
  await narrow.unmount()
})

test('a detached head shows its commit, a folder outside a repo shows alone', async ($, on) => {
  engine(on)
  gitReply = repoReply('# branch.oid 89abcdef01234567\n# branch.head (detached)\n')
  await start($, on)
  const ui = await $.ui.mount({ ...pane(80), surface: 'terminal' })
  expect(await headOf(ui)).toMatch(/· proj ↗\uFE0E· \(89abcde\)/)
  await ui.unmount()

  gitCalls = []
  gitReply = () => ({ exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' })
  await $.turn.start({ text: 'go', turnId: 'N1' })
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'N1', reason: 'answer' })
  expect(gitCalls.length).toBe(1) // no repo: origin is not asked
  const plain = await $.ui.mount({ ...pane(80), surface: 'terminal' })
  expect(await headOf(plain)).toMatch(/· proj/)
  expect(await headOf(plain)).not.toMatch(/↗|89abcde/)
  expect(linksIn(await plain.drawn()).map(l => l.props?.href)).toEqual(['file:///w/proj'])
  await plain.unmount()
})

test('git runs at start, a second after the last call that may change files, and at the end of a turn, never on a draw', async ($, on) => {
  const clock = engine(on)
  gitReply = repoReply(STATUS)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await start($, on)
  expect(gitCalls.length).toBe(2)
  for (let i = 0; i < 3; i += 1) {
    const ui = await $.ui.mount({ ...pane(80), surface: 'terminal' })
    await ui.drawn()
    await ui.advance(500)
    await ui.unmount()
  }
  expect(gitCalls.length).toBe(2)
  // Two edits half a second apart, then a read: one refresh, a second after the last edit.
  await $.tool.call({ tool: 'Bash', command: 'touch e.ts', tool_use_id: 'x1' } as never)
  await clock.advance(500)
  await $.tool.call({ tool: 'Edit', file_path: '/w/proj/a.ts', old_string: 'a', new_string: 'b', tool_use_id: 'x2' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/w/proj/a.ts', tool_use_id: 'x3' } as never)
  await clock.advance(999)
  expect(gitCalls.length).toBe(2)
  await clock.advance(1)
  await clock.advance(0)
  expect(gitCalls.length).toBe(4)
  await $.turn.start({ text: 'go', turnId: 'G1' })
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'G1', reason: 'answer' })
  expect(gitCalls.length).toBe(6)
})

test("Claude Code's Reduce motion stills the connectors, as motion: off does", async ($, on) => {
  engine(on)
  on('config.list', () => ({ value: [{ key: 'reduceMotion', label: 'Reduce motion', kind: 'boolean', value: true }] as never }))
  on('tool.check', () => ({ decision: 'allow' }))
  await $.tool.check({ tool: 'Read', input: { file_path: '/a' }, tool_use_id: 'r1' })
  await $.turn.start({ text: 'go', turnId: 'R1' })
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect((await ui.findAll({ type: 'Client' })).filter(c => (c as Drawn).props?.module === './rail.tsx')).toEqual([])
  expect(bareEmoji((await ui.findAll({ type: 'Text' })).map(t => textOf(t as Drawn)).join(''))).toEqual([])
  await ui.unmount()
})

test('a graphical meter glides to a new reading on an ease-out, and stands still when motion is off', () => {
  const runs = (on: number) => [{ cells: on, color: 'claude' }, { cells: 10 - on, color: 'subtle', isTrack: true }]
  const first = svgMeter(runs(4), 10, [], false)
  expect(first.source).not.toContain('<animate')
  expect(first.widths).toEqual([28])
  const next = svgMeter(runs(7), 10, first.widths, false)
  expect(next.source).toContain('from="28" to="49"')
  expect(next.source).toContain('keySplines="0.33 1 0.68 1"')
  expect(svgMeter(runs(7), 10, first.widths, true).source).not.toContain('<animate')
  expect(svgMeter(runs(7), 10, next.widths, false).source).not.toContain('<animate')
})

// ---------------------------------------------------------------- heat ramp and glyphs: text

const measured = async ($: Parameters<TestBody>[0], on: On) => {
  engine(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure({
    context: { window: 200_000, tokens: 128_000, percent: 64 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 82 }],
    changed: ['context', 'rateLimits'],
  } as never)
}

test('a terminal with 256 colours or more draws the status line heat ramp, one step per cell', async ($, on) => {
  mock.env(on, { COLORTERM: 'truecolor' })
  await measured($, on)
  const ui = await $.ui.mount({ ...pane(66), surface: 'terminal' })
  const meter = textsIn(keyed(await ui.drawn(), 'meter-ctx')).map(t => [textOf(t), t.props?.color])
  // 64% of ten cells: six and a half lit, each its own ramp step, the rest unlit; the value in its tens' step.
  expect(meter.slice(2)).toEqual([
    ...['#00ff00', '#5fff00', '#87ff00', '#afff00', '#d7ff00', '#ffff00'].map(c => ['━', c]),
    ['╸', '#ffd700'],
    ['───', '#4e4e4e'],
    ['64%', '#ffd700'],
    ['128k/200k', undefined],
  ])
  await ui.unmount()
})

test('a graphical surface draws a heat meter as the ramp gradient, the gate in its roles', async ($, on) => {
  await measured($, on)
  const ui = await $.ui.mount({ ...pane(66), surface: 'desktop' })
  const svgs = (await ui.findAll({ type: 'Svg' })) as Drawn[]
  const ctx = String(svgs.find(x => /^ctx /.test(String(x.props?.alt)))?.props?.source ?? '')
  expect(ctx).toContain('<linearGradient id="heat"')
  expect(ctx).toContain('stop-color="#ff0000"')
  expect(ctx).toContain('fill="url(#heat)"')
  await ui.unmount()
})

test('glyphs: text draws the pane in ASCII with classic borders', { options: { glyphs: 'text' } }, async ($, on) => {
  await measured($, on)
  await $.turn.start({ text: 'go', turnId: 'T1' })
  const ui = await $.ui.mount({ ...pane(66), surface: 'terminal' })
  const tree = await ui.drawn()
  const all = textsIn(tree).map(textOf).join('')
  expect(/^[\x20-\x7e\n]*$/.test(all)).toBe(true)
  expect(all).toContain('* working')
  const borders = boxesIn(tree).map(b => b.props?.borderStyle).filter(Boolean)
  expect(borders.length > 0 && borders.every(b => b === 'classic')).toBe(true)
  await ui.unmount()
})

test('meters show what the status line shows: the same rounding, half cells, nothing above zero empty', async ($, on) => {
  mock.env(on, { COLORTERM: 'truecolor' })
  engine(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  // [reading, shown, the ten-cell bar statusline.sh draws]
  const cases: [number, string, string][] = [
    [0, '0%', '──────────'],
    [0.4, '0%', '╸─────────'],
    [3, '3%', '╸─────────'],
    [9, '9%', '━─────────'],
    [37.5, '38%', '━━━━──────'],
    [99.6, '100%', '━━━━━━━━━━'],
    [100, '100%', '━━━━━━━━━━'],
  ]
  for (const [pct, shown, bar] of cases) {
    await $.session.measure({ context: { window: 200_000, tokens: 1_000, percent: 0.5 }, rateLimits: [{ kind: 'five_hour', percentUsed: pct }], changed: ['context', 'rateLimits'] } as never)
    const ui = await $.ui.mount({ ...pane(66), surface: 'terminal' })
    const row = textsIn(keyed(await ui.drawn(), 'meter-five_hour')).map(textOf)
    expect([row[1], row.includes(shown)]).toEqual([bar, true])
    await ui.unmount()
    // On a graphical surface the fill is the reading's share, at least half a cell above zero.
    const g = await $.ui.mount({ ...pane(66), surface: 'desktop' })
    const svg = ((await g.findAll({ type: 'Svg' })) as Drawn[]).find(x => /^5h /.test(String(x.props?.alt)))
    const lit = /fill="url\(#heat\)"/.test(String(svg?.props?.source)) ? Number(/<rect x="0" y="0" width="([\d.]+)" height="6" fill="url/.exec(String(svg?.props?.source))?.[1]) : 0
    expect(lit).toBe(Math.round(10 * 7 * (pct === 0 ? 0 : Math.min(1, Math.max(0.05, pct / 100))) * 100) / 100)
    await g.unmount()
  }
})

test('no number in the main block is cut, docked at 66 or narrowed to 40 columns', async ($, on) => {
  engine(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure({
    context: { window: 1_000_000, tokens: 87_700, percent: 8.77 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 82, resetsAt: '2026-11-01T21:05:00Z' }, { kind: 'seven_day', percentUsed: 40, resetsAt: '2026-11-04T14:41:00Z' }],
    changed: ['context', 'rateLimits'],
  } as never)
  for (const cols of [66, 40]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    const tree = await ui.drawn()
    for (const key of ['meter-ctx', 'meter-five_hour', 'meter-seven_day']) {
      // Every fixed-width box in the row holds its text whole.
      const cut = boxesIn(keyed(tree, key))
        .filter(b => typeof b.props?.width === 'number')
        .map(b => [textOf(b), b.props?.width as number] as const)
        .filter(([text, width]) => cellsOf(text) > width)
      expect(cut).toEqual([])
    }
    if (cols === 66) expect(textsIn(keyed(tree, 'meter-ctx')).map(textOf)).toContain('87.7k/1.0M')
    await ui.unmount()
  }
})

// ---------------------------------------------------------------- trends, context split, inbox

/** A context breakdown as /context gives it: content rows, then free space, the buffer and deferred schemas, which are not content. */
const BREAKDOWN = {
  categories: [
    { name: 'System prompt', tokens: 3_000, color: 'promptBorder', isDeferred: false, kind: 'used' },
    { name: 'System tools', tokens: 18_000, color: 'inactive', isDeferred: false, kind: 'used' },
    { name: 'MCP tools', tokens: 9_000, color: 'cyan_FOR_SUBAGENTS_ONLY', isDeferred: false, kind: 'used' },
    { name: 'Memory files', tokens: 4_000, color: 'claude', isDeferred: false, kind: 'used' },
    { name: 'Skills', tokens: 2_000, color: 'warning', isDeferred: false, kind: 'used' },
    { name: 'Messages', tokens: 320_000, color: 'purple_FOR_SUBAGENTS_ONLY', isDeferred: false, kind: 'used' },
    { name: 'Empty', tokens: 0, color: 'text', isDeferred: false, kind: 'used' },
    { name: 'MCP tools (deferred)', tokens: 40_000, color: 'inactive', isDeferred: true, kind: 'deferred' },
    { name: 'Autocompact buffer', tokens: 45_000, color: 'inactive', isDeferred: false, kind: 'buffer' },
    { name: 'Free space', tokens: 599_000, color: 'inactive', isDeferred: false, kind: 'free' },
  ],
  totalTokens: 356_000,
  maxTokens: 1_000_000,
  rawMaxTokens: 1_000_000,
  percentage: 36,
  isAutoCompactEnabled: false,
}

/** A host whose `session.usage` gives the breakdown above to a call that asks for one, and a running cost. */
const splitHost = (on: On, cost: () => number = () => 1) => {
  const asked: (string | undefined)[] = []
  on('session.usage', (_$, e) => {
    asked.push(e.breakdown)
    return {
      value: {
        startedAt: 0,
        rateLimits: [],
        cost: { usd: cost() },
        context: { window: 1_000_000, tokens: 356_000, percent: 36, ...(e.breakdown ? { breakdown: BREAKDOWN as never } : {}) },
      },
    }
  })
  return asked
}

const point = (at: number): TrendPoint => ({ at, ctx: at, cost: null, ms: at, out: null })

test('the trend keeps the last 30 turns, and stored junk reads as points', () => {
  let l: TrendPoint[] = []
  for (let i = 0; i < 45; i += 1) l = pushTrend(l, point(i))
  expect(l.length).toBe(TREND_MAX)
  expect([l[0]?.at, l[l.length - 1]?.at]).toEqual([15, 44])
  expect(normalizeTrend([{ at: 1, ctx: 'x', ms: 5, cost: 0.2 }, null, 3, [1]])).toEqual([{ at: 1, ctx: null, cost: 0.2, ms: 5, out: null }])
  expect(normalizeTrend(Array.from({ length: 50 }, (_, i) => ({ at: i, ms: i }))).length).toBe(TREND_MAX)
  expect(normalizeTrend('not a list')).toEqual([])
})

test('sparklines scale from zero: flat, zero, unknown, over the top and the smallest reading above zero', () => {
  expect(sparkLevels([0, 0, 0])).toEqual([0, 0, 0])
  expect(sparkLevels([5, 5, 5])).toEqual([7, 7, 7])
  expect(sparkLevels([0, 1, 100])).toEqual([0, 1, 7]) // 1 of 100 rounds to 0, but a reading above zero shows
  expect(sparkLevels([null, 50, 100])).toEqual([null, 4, 7])
  expect(sparkLevels([20, 50, 150], 100)).toEqual([1, 4, 7]) // a percentage against 100, capped
  expect(sparkLevels([null, null])).toEqual([null, null])
  expect(sparkLevels([-3, 2])).toEqual([0, 7])
  expect(sparkLevels([])).toEqual([])
  // Eight single-cell levels no terminal draws as emoji, and eight ASCII stand-ins for glyphs: text.
  expect([...SPARK].length).toBe(8)
  expect([...SPARK].every(c => cellWidth(c) === 1)).toBe(true)
  expect(bareEmoji(SPARK)).toEqual([])
  expect(/^[\x20-\x7e]{8}$/.test(SPARK_ASCII)).toBe(true)
})

test('a graphical sparkline glides each bar to its new height on the meters\' ease-out, still when motion is off', () => {
  const colors = ['claude', '#ff0000', 'subtle']
  const a = svgSpark([0, 7, null], colors, 3, [], false)
  expect(a.heights).toEqual([1, 12, 0]) // zero a one-pixel baseline, unknown nothing
  expect((a.source.match(/<rect/g) ?? []).length).toBe(2)
  expect(a.source).toContain('fill="#d97757"') // a theme key as its role's hex
  expect(a.source).toContain('width="21"')
  expect(a.source).not.toContain('<animate')
  const b = svgSpark([7, 7, null], colors, 3, a.heights, false)
  expect(b.source).toContain('<animate attributeName="height" from="1" to="12" dur="0.4s" calcMode="spline" keyTimes="0;1" keySplines="0.33 1 0.68 1" fill="freeze"/>')
  expect(b.source).toContain('attributeName="y" from="11" to="0"')
  expect((b.source.match(/<animate /g) ?? []).length).toBe(2) // the bar that moved, not the one that did not
  expect(svgSpark([7, 7, null], colors, 3, a.heights, true).source).not.toContain('<animate')
})

test('the context split keeps what fills the window, largest first', () => {
  const sp = splitOf(BREAKDOWN as never, 5)
  expect(sp?.rows.map(r => r.name)).toEqual(['Messages', 'System tools', 'MCP tools', 'Memory files', 'System prompt', 'Skills'])
  expect([sp?.window, sp?.at]).toEqual([1_000_000, 5])
  expect(splitOf(null, 0)).toBeNull()
  expect(splitOf({ rawMaxTokens: 1000 } as never, 0)).toBeNull() // a host with no categories
})

test('the inbox lists newest first, keeps each item once, holds the last 40, and reads junk leniently', () => {
  const it = (id: string, at: number): InboxItem => ({ id, at, source: 'tool', text: id, target: null })
  let l: InboxItem[] = []
  for (const [id, at] of [['a', 1], ['b', 3], ['c', 2], ['a', 9], ['d', 3]] as const) l = addInbox(l, it(id, at))
  expect(l.map(x => x.id)).toEqual(['a', 'b', 'c', 'd'])
  expect(inboxNewest(l, 10).map(x => x.id)).toEqual(['d', 'b', 'c', 'a']) // same time: the later arrival first
  expect(inboxNewest(l, 2).map(x => x.id)).toEqual(['d', 'b'])
  expect(inboxNewest(l, 0)).toEqual([])
  for (let i = 0; i < 60; i += 1) l = addInbox(l, it(`n${i}`, 10 + i))
  expect(l.length).toBe(INBOX_MAX)
  expect(l[l.length - 1]?.id).toBe('n59')
  expect(normalizeInbox([{ id: 'x', at: 'y', source: 'nope', text: 4, target: 7 }, null])).toEqual([{ id: 'x', at: 0, source: 'tool', text: '4', target: null }])
  expect(errorLine('\n  Error: boom\n    at x.ts:1')).toBe('Error: boom')
  expect(errorLine('failed: --token=abcdefghijklmnop')).not.toContain('abcdefgh')
  expect(errorLine(undefined)).toBe('')
})

test('the main block splits the context by category, with a legend, and the split is read once a main turn', async ($, on) => {
  const clock = engine(on)
  const asked = splitHost(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  // Before any breakdown there is no split: no row, nothing invented.
  const before = await $.ui.mount({ ...pane(66), surface: 'terminal' })
  expect(keyed(await before.drawn(), 'meter-split')).toBeUndefined()
  await before.unmount()
  // The first measurement reads the compaction window, and keeps that breakdown's split; later ones read nothing.
  await $.session.measure({ context: { window: 1_000_000, tokens: 356_000, percent: 35.6 }, rateLimits: [], changed: ['context'] } as never)
  await $.session.measure({ context: { window: 1_000_000, tokens: 356_000, percent: 35.6 }, rateLimits: [], changed: ['context'] } as never)
  expect(asked.filter(Boolean).length).toBe(1)
  const n = asked.filter(Boolean).length
  await $.turn.start({ text: 'go', turnId: 'S1' })
  await clock.advance(1000)
  await $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 'S1', reason: 'answer' })
  expect(asked.filter(Boolean).length - n).toBe(1)
  expect(asked.filter(Boolean).every(x => x === 'summary')).toBe(true) // never `full`, which sends requests
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane(66), surface })
    const tree = await ui.drawn()
    const row = keyed(tree, 'meter-split')
    expect(row).toBeDefined()
    const texts = textsIn(row).map(textOf)
    expect(texts[0]).toBe('mix')
    expect(texts).toContain('36%')
    expect(texts).toContain('est.')
    // A fill meter like ctx: the heat ramp per lit cell, 4 of 10 lit; the categories are the legend's.
    if (surface === 'terminal') {
      const lit = textsIn(row).filter(t => /^[━╸]+$/.test(textOf(t))).map(t => t.props?.color)
      expect(lit).toEqual(['#00ff00', '#5fff00', '#87ff00', '#afff00'])
    }
    // The legend, largest first, with each category's tokens.
    const all = textsIn(tree).map(textOf).join('|')
    expect(all).toContain('messages 320k')
    expect(all.indexOf('messages 320k') < all.indexOf('system tools ')).toBe(true)
    expect(all).not.toContain('free space')
    expect(all).not.toContain('deferred')
    await ui.unmount()
  }
})

test('the trends block draws a sparkline per figure over the last turns, the fill in its heat', async ($, on) => {
  // The fallback colours: a console without 256 colours.
  mock.env(on, { TERM: 'dumb' })
  const clock = engine(on)
  let cost = 1
  splitHost(on, () => cost)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  const turn = async (i: number, ctx: number) => {
    await $.turn.start({ text: `turn ${i}`, turnId: `T${i}` })
    cost += 0.5
    await clock.advance(1000 * i)
    const usage = { input_tokens: 10, output_tokens: 400 * i, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
    await $.turn.complete({ answer: 'ok', durationMs: 1000 * i, isAborted: false, turnId: `T${i}`, reason: 'answer', usage })
    // The measurement after the turn gives its point the fill it left.
    await $.session.measure({ context: { window: 200_000, tokens: ctx * 2000, percent: ctx }, rateLimits: [], changed: ['context'] } as never)
  }
  const none = await $.ui.mount({ ...pane(66), surface: 'terminal' })
  expect(await none.find({ text: /^trends$/ })).toBeUndefined() // no turn yet: no block, no gap
  await none.unmount()
  await turn(1, 20)
  await turn(2, 50)
  await turn(3, 90)
  const ui = await $.ui.mount({ ...pane(66), surface: 'terminal' })
  const tree = await ui.drawn()
  expect(await ui.find({ text: /^last 3 turns$/ })).toBeDefined()
  const row = (key: string) => textsIn(keyed(tree, `trend-${key}`)).map(t => [textOf(t), t.props?.color])
  // The fill against 100: 20% one step up, 50% half way, 90% near the top, each cell in its heat.
  expect(row('ctx')).toEqual([['ctx', undefined], ['▂▅▇', undefined], ['▂▅', 'claude'], ['▇', 'error'], ['90%', 'error']])
  // A flat cost draws flat at the top; time and output tokens rise.
  expect(row('cost').slice(1)).toEqual([['███', 'claude'], ['$0.50', undefined]])
  expect(row('time').slice(1)).toEqual([['▃▆█', 'claude'], ['3.0s', undefined]])
  expect(row('out').slice(1)).toEqual([['▃▆█', 'claude'], ['1.2k', undefined]])
  await ui.unmount()

  // On a graphical surface each is SVG, and the next turn glides from the last drawing.
  const svgOf = async () => {
    const d = await $.ui.mount({ ...pane(66), surface: 'desktop' })
    const svgs = (await d.findAll({ type: 'Svg' })) as Drawn[]
    // Time scales to its own largest turn, so a longer turn redraws every bar.
    const src = String(svgs.find(x => /^time over the last/.test(String(x.props?.alt)))?.props?.source ?? '')
    await d.unmount()
    return src
  }
  expect(await svgOf()).not.toContain('<animate')
  await turn(4, 30)
  expect(await svgOf()).toContain('<animate attributeName="height"')
})

test('glyphs: text draws the sparklines in ASCII', { options: { glyphs: 'text' } }, async ($, on) => {
  engine(on)
  splitHost(on)
  for (const i of [1, 2]) {
    await $.turn.start({ text: 'go', turnId: `A${i}` })
    await $.turn.complete({ answer: 'ok', durationMs: 1000 * i, isAborted: false, turnId: `A${i}`, reason: 'answer' })
  }
  const ui = await $.ui.mount({ ...pane(66), surface: 'terminal' })
  const all = textsIn(await ui.drawn()).map(textOf).join('')
  expect(/^[\x20-\x7e\n]*$/.test(all)).toBe(true)
  expect(textsIn(keyed(await ui.drawn(), 'trend-time')).map(textOf)[1]).toBe('=#')
  await ui.unmount()
})

test('the inbox gathers failures, refusals, API errors, interrupts and faults, newest first; a row jumps to its call; clear empties it', async ($, on) => {
  const clock = engine(on)
  splitHost(on)
  on('tool.check', (_$, e) => ({ decision: e.tool_use_id === 'd1' ? 'deny' : 'allow' }))
  on('tool.call', (_$, e) =>
    e.tool_use_id === 'f1' ? { isError: true as const, result: 'x', text: 'Exit code 1\nnpm ERR! missing script: test' } : { result: {}, text: 'ok' },
  )
  // The kit has no transcript to scroll from a press: the press says so in a toast instead of failing.
  const toasts: string[] = []
  on('ui.toast', (_$, e) => (toasts.push(String((e as { text?: unknown }).text ?? JSON.stringify(e))), { value: undefined }) as never)
  on('classic.StopFailure', () => ({}) as never)
  await clock.advance(3_600_000)
  await $.turn.start({ text: 'go', turnId: 'I1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' }, tool_use_id: 'd1' })
  await clock.advance(1000)
  await $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'f1' } as never)
  await clock.advance(1000)
  await $.classic.StopFailure({ error: 'rate_limit', error_details: 'Too many requests' } as never)
  await clock.advance(1000)
  // The API error ended the turn too: StopFailure already named it, so no second item.
  await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 'I1', reason: 'error' })
  await clock.advance(1000)
  await $.turn.start({ text: 'again', turnId: 'I2' })
  await $.turn.complete({ answer: '', durationMs: 5, isAborted: true, turnId: 'I2', reason: 'aborted' })

  const rowsOf = async (cols: number) => {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    const tree = await ui.drawn()
    const rows = boxesIn(tree).filter(b => String(b.props?.key ?? '').startsWith('inbox-row-'))
    // A row's words: its Texts and its Button's label, in order.
    const words = (n: unknown): string[] =>
      !isDrawn(n) ? [] : n.type === 'Text' ? [textOf(n)] : n.type === 'Button' ? [String(n.props?.label ?? '')] : (n.children ?? []).flatMap(words)
    return { ui, tree, rows: rows.map(r => words(r).join(' ')) }
  }
  const { ui, tree, rows } = await rowsOf(66)
  // (The kit raises no ui.fault, so a mod fault's item is left to the reducer tests.)
  expect(rows.length).toBe(4)
  expect(rows[0]).toMatch(/‖ turn turn interrupted$/)
  expect(rows[1]).toMatch(/✕ api rate limit · Too many requests$/)
  expect(rows[2]).toMatch(/✕ tool Bash → npm test · Exit code 1$/)
  expect(rows[3]).toMatch(/✕ deny denied by rule · Bash → rm -rf build$/)
  expect(rows[0]?.startsWith(fmtClockOf(3_604_000))).toBe(true)
  // The count in the pane's header and the block's label; the block in the error colour.
  expect(await ui.find({ text: /^✕ 4$/ })).toBeDefined()
  expect(await ui.find({ text: /^Inbox · 4$/ })).toBeDefined()
  expect(boxesIn(tree).some(b => b.props?.borderStyle === 'round' && b.props?.borderColor === 'error')).toBe(true)
  // A row whose call is in the transcript jumps there; the others are plain text.
  expect(keyed(tree, 'inbox-f1')?.type).toBe('Button')
  expect(keyed(tree, 'inbox-d1')?.type).toBe('Button')
  expect(keyed(tree, 'inbox-turn:I2')).toBeUndefined()
  await ui.press({ key: 'inbox-f1' })
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toMatch(/^flightdeck: cannot show that row/)
  expect(jumpTo({ target: 'f1' })).toEqual({ to: { requestId: 'f1' }, block: 'center' })
  expect(jumpTo({ target: null })).toBeNull()
  await ui.unmount()
  // Narrow, the source word goes and its mark stays.
  const narrow = await rowsOf(32)
  expect(narrow.rows[0]).toMatch(/^\d\d:\d\d ‖ turn interrupted$/)
  await narrow.ui.press({ key: 'inbox-clear' })
  await narrow.ui.unmount()
  // Cleared: no block, no gap, no badge.
  const after = await rowsOf(66)
  expect(after.rows).toEqual([])
  expect(await after.ui.find({ text: /^inbox/ })).toBeUndefined()
  expect(await after.ui.find({ text: /^✕ \d+$/ })).toBeUndefined()
  expect(JSON.stringify(after.tree)).not.toContain('"block-inbox"')
  await after.ui.unmount()
})

const fmtClockOf = (ms: number) => new Date(ms).toTimeString().slice(0, 5)

test('the new blocks keep one-row gaps and fit every width, and a busy session shows them all', { timeoutMs: 60_000 }, async ($, on) => {
  await busySession($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const cols of [24, 40, 64, 120]) {
      const ui = await $.ui.mount({ ...pane(cols), surface })
      const json = JSON.stringify(await ui.drawn())
      for (const key of ['block-inbox', 'block-trends', 'meter-split']) expect(`${surface} ${cols} ${key} ${json.includes(`"${key}"`)}`).toBe(`${surface} ${cols} ${key} true`)
      await ui.unmount()
    }
  }
  // Inline, the summary stays within 8 rows and carries the inbox's count.
  const mini = await $.ui.mount({ ...pane(80), props: { ...pane(80).props, placement: 'inline' as const }, surface: 'terminal' })
  const root = (await mini.drawn()) as { children?: unknown[] }
  expect((root.children ?? []).filter(Boolean).length <= 8).toBe(true)
  expect(await mini.find({ text: /^✕ \d+$/ })).toBeDefined()
  await mini.unmount()
})
