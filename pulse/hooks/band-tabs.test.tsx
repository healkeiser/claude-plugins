import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderSurface } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { bareEmoji, cellWidth } from './style'

const T0 = 1_000_000
const STATUS = (oid: string) => [
  `# branch.oid ${oid}`, '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -0', '# stash 1',
  '1 .M N... 100644 100644 100644 a b x.ts', '? new.ts',
].join('\n')
// What gh answers: the branch's runs, and its pull request, approved, one check of two still running.
const GH_OUT = (argv: readonly string[], runs: Record<string, unknown>[]) =>
  argv[1] === 'run'
    ? JSON.stringify(runs)
    : JSON.stringify({
        number: 12, title: 'Unify the mods', state: 'OPEN', reviewDecision: 'APPROVED', url: 'u',
        statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS', conclusion: '' }],
      })
// What git answers each read: status, the diff against HEAD, the last commit (an hour before T0), the
// commits since the session began (two, once HEAD moved), the work trees.
const GIT_OUT = (argv: readonly string[], oid: string) =>
  argv.includes('status') ? STATUS(oid)
    : argv.includes('--numstat') ? '12\t3\tx.ts\n'
    : argv.includes('rev-list') ? '2\n'
    : argv.includes('--reverse') ? 'c0ffee1\0feat: one\nc0ffee2\0feat: two\n'
    : argv.includes('log') ? `abc1234\0fix: token expiry\0${Math.floor((T0 - 3_600_000) / 1000)}\n`
    : argv.includes('worktree') ? 'worktree /repo\nHEAD abc\n\nworktree /repo-b\nHEAD def\n'
    : ''

// The world beneath pulse: clock, store, usage, git, and a band row of another mod's.
// `beneath: 'empty'`: the mod beneath answers with a Box that draws nothing (a hidden band).
function engine(on: On, store: Record<string, unknown> = {}, beneath: 'row' | 'empty' = 'row') {
  const clock = mock.clock(on, { now: T0 })
  // The store in memory, kept where a test can read what the band wrote.
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  // `fiveLeft`: ms until the 5h window resets, from the turn's end. `ci`: the runs `gh run list` answers.
  const world = { cost: 1, ctx: 64, hasLimits: true, runs: [] as string[][], oid: 'abcdef1234', fiveLeft: (4 * 60 + 51) * 60_000 + 30_000, ci: [] as Record<string, unknown>[], toasts: [] as string[], hasGh: true }
  on('ui.toast', (_, e) => {
    world.toasts.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  // The last fetch, ten minutes before T0.
  on('fs.stat', () => ({ value: { kind: 'file', size: 41, mtimeMs: T0 - 600_000 } }) as never)
  on('fs.exists', () => ({ value: false }) as never)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', (_, e) => (e.tool === 'Bash' ? { result: {}, isError: true as const, text: 'boom' } : { result: {} }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: world.ctx * 10_000, window: 1_000_000, percent: world.ctx },
      // Timed from a turn's end (T0 + 67 s), where the tabs are read.
      rateLimits: world.hasLimits
        ? [
            { kind: 'five_hour', percentUsed: 82, resetsAt: new Date(T0 + 67_000 + world.fiveLeft).toISOString() },
            { kind: 'seven_day', percentUsed: 20, resetsAt: new Date(T0 + 67_000 + 3 * 86_400_000 + 22 * 3_600_000 + 30_000).toISOString() },
          ]
        : [],
      cost: { usd: world.cost },
    },
  }))
  on('process.run', (_, e) => {
    world.runs.push([...e.argv])
    // No gh installed: running it rejects, as a missing program does.
    if (e.argv[0] === 'gh' && !world.hasGh) throw new Error('ENOENT')
    return { value: { exitCode: 0, stdout: e.argv[0] === 'gh' ? GH_OUT(e.argv, world.ci) : GIT_OUT(e.argv, world.oid), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.render', ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return beneath === 'row' ? <Text>other band</Text> : <Box />
  })
  return { clock, world }
}

const pulse = (args: string) => ({ command: 'pulse', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } })

async function startSession($: Engine) {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
}

// One main turn: a read, an edit and a failing shell command, 65 s, a cache read.
async function runTurn($: Engine, clock: { advance: (ms: number) => Promise<void> }, world: { cost: number }) {
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/parse.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'run the tests' })
  await clock.advance(65_000)
  world.cost = 1.25
  const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 900, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' }
  await $.turn.complete({ answer: '', durationMs: 65_000, isAborted: false, turnId: 't1', reason: 'answer', usage })
}

const mount = ($: Engine, surface: RenderSurface = 'terminal', cols = 100, isWorking = false) =>
  $.ui.mount({
    plugin: 'pulse', surface, component: 'AbovePrompt',
    props: { isWorking, hasSurvey: false, bodyColumns: cols, maxRows: 20, scroll: { offset: 0, bodyRows: 20 }, view: {} },
  } as never)

// What a drawn tree says, each string once, Button labels included.
const flat = (n: unknown): string => {
  if (typeof n === 'string') return n
  if (Array.isArray(n)) return n.map(flat).join('')
  if (!n || typeof n !== 'object') return ''
  const el = n as { type?: string; children?: unknown; props?: { children?: unknown; label?: unknown; source?: unknown } }
  if (el.type === 'Svg') return ''
  // A Button drawn from its children carries them as its label too: the text once.
  const label = typeof el.props?.label === 'string' ? el.props.label : ''
  const inner = flat(el.children ?? el.props?.children)
  return inner || label
}
async function look(ui: { drawn: () => Promise<unknown> }) {
  return flat(await ui.drawn())
}
// The band's own part: everything above the other mod's row.
const mine = (text: string) => text.slice(0, text.indexOf('other band'))

test('folded and idle: the last turn, its cost, the context meter and the cache countdown', async ($, on) => {
  const { clock, world } = engine(on)
  await runTurn($, clock, world)
  await clock.advance(61_000)
  const ui = await mount($)
  const text = await look(ui)
  expect(text).toContain('✓ 1m 05s')
  expect(text).toContain('3 tools')
  expect(text).toContain('$0.25')
  expect(text).toContain('ctx')
  expect(text).toContain('64%')
  // A subscription (it reports rate limits): an hour from the turn's end.
  expect(text).toContain('cache ↻ 58m 59s')
  expect(text.indexOf('✓')).toBeLessThan(text.indexOf('other band'))
  // The meter is the status line's ramp, one colour per cell.
  const colors = (await ui.findAll({ type: 'Text' })).map(t => t.props.color)
  expect(colors).toContain('#00ff00')
  expect(colors).toContain('#4e4e4e')
  expect(bareEmoji(text)).toEqual([])
  await ui.unmount()
})

test('the countdown redraws once a second, takes heat as it nears zero, then reads expired', async ($, on) => {
  const { clock, world } = engine(on)
  world.hasLimits = false
  await runTurn($, clock, world)
  // An API key: five minutes.
  let ui = await mount($)
  expect(await look(ui)).toContain('↻ 5m 00s')
  await ui.unmount()
  await clock.advance(4 * 60_000 + 50_000)
  ui = await mount($)
  expect(await look(ui)).toContain('↻ 10s')
  const hot = (await ui.findAll({ type: 'Text', text: '↻ 10s' })).map(t => t.props.color)
  expect(hot).toContain('#ff0000')
  await ui.unmount()
  await clock.advance(11_000)
  ui = await mount($)
  expect(await look(ui)).toContain('cache ○ expired')
  await ui.unmount()
})

test('folded and working: the current action, tab buttons with no digit hotkeys and the fold control', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' })
  const ui = await mount($, 'terminal', 100, true)
  const text = mine(await look(ui))
  expect(text).toContain('reading a.ts')
  expect(text).toContain('1 tool')
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.map(b => b.props.hotkey).filter(Boolean)).toEqual([])  // a bare digit in an empty prompt must stay typing, not switch tabs
  expect(buttons.map(b => b.key)).toEqual(['tab-activity', 'tab-context', 'tab-turn', 'tab-git', 'tab-checks', 'fold'])
  await ui.unmount()
})

test('unfolded: a rounded card with a header and each tab', async ($, on) => {
  const { clock, world } = engine(on)
  await startSession($)
  await runTurn($, clock, world)
  await clock.advance(2000)
  const ui = await mount($)
  await ui.press({ key: 'fold' })
  const card = (await ui.findAll({ type: 'Box' })).find(b => b.props.borderStyle === 'round')
  expect(card).toBeDefined()

  let text = mine(await look(ui))
  expect(text).toContain('Pulse')
  expect(text).toContain('✓ reading a.ts')
  expect(text).toContain('✕ run the tests')
  expect(text).toContain('editing parse.ts')

  await ui.press({ key: 'tab-context' })
  text = mine(await look(ui))
  expect(text).toContain(' 64%')
  expect(text).toContain('640k/1.0M')
  expect(text).toContain('5h')
  expect(text).toContain('↻ 4h 51m')
  expect(text).toContain('7d')
  expect(text).toContain('↻ 3d 22h')
  expect(text).toContain('cache')
  expect(text).toContain('1h')

  await ui.press({ key: 'tab-turn' })
  text = mine(await look(ui))
  expect(text).toContain('last turn  1m 05s')
  expect(text).toContain('◇ 1 read')
  expect(text).toContain('parse.ts')
  expect(text).toContain('✕ 1')
  expect(text).toContain('$0.25')
  expect(text).toContain('session $1.25')

  await ui.press({ key: 'tab-git' })
  text = mine(await look(ui))
  // Branch, upstream and sync, stash; lines and where files stand; the last commit; the most changed file.
  for (const part of ['main', '→ origin/main', '⇡2', 'stash 1', '+12', '-3', '1 unstaged', '1 untracked', 'abc1234', 'fix: token expiry', 'ago', 'x.ts']) {
    expect(text).toContain(part)
  }
  expect(bareEmoji(text)).toEqual([])

  // The open tab's own key folds the band again.
  await ui.press({ key: 'tab-git' })
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.borderStyle === 'round')).toBe(false)
  await ui.unmount()
})

test('the active tab is inverse and bold, as Claude Code marks its pane tabs; the others dim', async ($, on) => {
  engine(on)
  const ui = await mount($)
  await ui.press({ key: 'tab-turn' })
  expect(await ui.find({ type: 'Text', text: ' Turn ' })).toMatchObject({ props: { inverse: true } })
  expect(await ui.find({ type: 'Text', text: ' Git ' })).toMatchObject({ props: { dimColor: true } })
  await ui.unmount()
})

test('the open tab and the unfolded state come back from the store in a new session', async ($, on) => {
  const store: Record<string, unknown> = { band: { isOpen: true, tab: 'git' } }
  engine(on, store)
  await startSession($)
  const ui = await mount($)
  // The Git tab is open: its rows, or its placeholder while git is still read.
  expect(mine(await look(ui))).toMatch(/reading git status|branch/)
  await ui.press({ key: 'tab-context' })
  await ui.unmount()
  expect(store.band).toMatchObject({ isOpen: true, tab: 'context' })
})

test('/pulse band off hides the band to the rows beneath; on and toggle bring it back', async ($, on) => {
  engine(on)
  const off = await $.command.run(pulse('band off'))
  expect(off.text).toContain('hidden')
  let ui = await mount($)
  expect(await look(ui)).toBe('other band')
  await ui.unmount()
  await $.command.run(pulse('band toggle'))
  ui = await mount($)
  expect(await look(ui)).not.toBe('other band')
  await ui.unmount()
  const wrong = await $.command.run(pulse('nope'))
  expect(wrong.text).toContain('Usage')
})

test('the band option off hides it; /pulse band on shows it for the session', { options: { band: 'off' } }, async ($, on) => {
  engine(on)
  let ui = await mount($)
  expect(await look(ui)).toBe('other band')
  await ui.unmount()
  await $.command.run(pulse('band on'))
  ui = await mount($)
  expect(await look(ui)).toContain('idle')
  await ui.unmount()
})

test('a survey holds the band: pulse yields', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({
    plugin: 'pulse', surface: 'terminal', component: 'AbovePrompt',
    props: { isWorking: false, hasSurvey: true, bodyColumns: 100, maxRows: 20, scroll: { offset: 0, bodyRows: 20 }, view: {} },
  } as never)
  expect(await look(ui)).toBe('other band')
  await ui.unmount()
})

test('unfolded, other bands still draw beneath the card', async ($, on) => {
  engine(on, { band: { isOpen: true, tab: 'activity' } })
  await startSession($)
  const ui = await mount($)
  const text = await look(ui)
  expect(text.indexOf('Pulse')).toBeLessThan(text.indexOf('other band'))
  await ui.unmount()
})

test('git is read at start, a second after an edit and at the end of a turn, never on a draw', async ($, on) => {
  const { clock, world } = engine(on)
  await startSession($)
  await clock.settle()
  // One read: a status, then the diff and the last commit it allows.
  const reads = () => world.runs.filter(a => a.includes('status')).length
  expect(reads()).toBe(1)
  expect(world.runs[0]).toEqual(['git', '-C', '/repo', '--no-optional-locks', 'status', '--porcelain=v2', '--branch', '--show-stash'])
  for (let i = 0; i < 5; i++) {
    const ui = await mount($)
    await ui.press({ key: 'tab-git' })
    await ui.unmount()
  }
  expect(reads()).toBe(1)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Write', file_path: '/repo/b.ts', content: 'x' })
  expect(reads()).toBe(1)
  await clock.advance(1000)
  // Two edits within the second: one read.
  expect(reads()).toBe(2)
})

test('idle and stilled: nothing moves between ticks; the countdown changes once a second', async ($, on) => {
  const { clock, world } = engine(on)
  await runTurn($, clock, world)
  const a = await mount($)
  const first = await look(a)
  await a.unmount()
  await clock.advance(100)
  const b = await mount($)
  expect(await look(b)).toBe(first)
  await b.unmount()
  await clock.advance(1000)
  const c = await mount($)
  expect(await look(c)).not.toBe(first)
  await c.unmount()
})

test('motion off: a working band stands still, the time still counts', { options: { motion: 'off' } }, async ($, on) => {
  const { clock } = engine(on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  const a = mine(await look(await mount($, 'terminal', 100, true)))
  expect(a.startsWith('● thinking')).toBe(true)
  await clock.advance(1000)
  const b = mine(await look(await mount($, 'terminal', 100, true)))
  expect(b.startsWith('● thinking')).toBe(true)
  expect(b).toContain('1s')
})

test('narrow widths drop the tabs, then the cost and tool count, and never wrap the row', async ($, on) => {
  const { clock, world } = engine(on)
  await runTurn($, clock, world)
  const at = async (cols: number) => {
    const ui = await mount($, 'terminal', cols)
    const text = mine(await look(ui))
    const tabs = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('tab-')).length
    await ui.unmount()
    // The tabs carry no hotkeys, so no `1: ` is drawn before them.
    return { text, tabs, cells: cellWidth(text) }
  }
  const wide = await at(120)
  expect(wide.tabs).toBe(5)
  expect(wide.text).toContain('$0.25')
  const mid = await at(70)
  expect(mid.tabs).toBe(0)
  expect(mid.text).toContain('ctx')
  expect(mid.text).not.toContain('$0.25')
  for (const cols of [120, 70, 50, 30, 20]) {
    const r = await at(cols)
    expect(r.cells).toBeLessThanOrEqual(cols)
    expect(r.text).toContain('✓')
  }
  const narrow = await at(20)
  expect(narrow.text).not.toContain('ctx')
})

test('desktop: SVG meters that glide, wider buttons, the same glyphs', async ($, on) => {
  const { clock, world } = engine(on)
  await runTurn($, clock, world)
  const ui = await mount($, 'desktop')
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.map(b => b.props.label)).toEqual(['Activity', 'Context & cache', 'Turn', 'Git', 'Checks', 'Expand'])
  expect(buttons.every(b => b.props.plain === undefined)).toBe(true)
  const svg = await ui.find({ type: 'Svg' })
  expect(String(svg?.props.source)).toContain('linearGradient')
  expect(svg?.props.isInteractive).toBe(true)
  expect(await look(ui)).toContain('✓ 1m 05s')
  await ui.press({ key: 'fold' })
  await ui.press({ key: 'tab-context' })
  expect((await ui.findAll({ type: 'Button' })).find(b => b.key === 'tab-context')?.props.variant).toBe('primary')
  const first = (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.source))
  // The open band draws its readings as Settings > Usage draws them: a thin bar per reading.
  expect(first.some(s => s.includes('<title>Context: 64% used'))).toBe(true)
  // Every tab draws on desktop: hover reveals sit inside keyed rows.
  for (const key of ['tab-activity', 'tab-turn', 'tab-git']) {
    await ui.press({ key })
    expect(await look(ui)).toContain('Collapse')
  }
  await ui.press({ key: 'tab-context' })
  await ui.unmount()
  world.ctx = 81
  const again = await mount($, 'desktop')
  const glided = (await again.findAll({ type: 'Svg' })).map(s => String(s.props.source))
  expect(glided.some(s => s.includes('<title>Context: 81% used') && s.includes('#dc3c3d'))).toBe(true)
  await again.unmount()
})

test('glyphs text: ASCII stand-ins and a classic border', { options: { glyphs: 'text' } }, async ($, on) => {
  const { clock, world } = engine(on, { band: { isOpen: true, tab: 'activity' } })
  await startSession($)
  await runTurn($, clock, world)
  const ui = await mount($)
  const text = mine(await look(ui))
  expect(text).not.toContain('✓')
  expect(text).toContain('v reading a.ts')
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.borderStyle === 'classic')).toBe(true)
  await ui.unmount()
})

test('/pulse band off is written to the store, so it outlives the session', async ($, on) => {
  const store: Record<string, unknown> = {}
  engine(on, store)
  await $.command.run(pulse('band off'))
  expect(store.band).toMatchObject({ band: 'off' })
})

test('a new session whose store says off starts with the band hidden', async ($, on) => {
  engine(on, { band: { isOpen: false, tab: 'activity', band: 'off' } })
  await startSession($)
  const ui = await mount($)
  expect(await look(ui)).toBe('other band')
  await ui.unmount()
})

// Rows a drawn tree takes as a terminal lays it out: a Text, Button or Svg one,
// a column Box the sum of its children, a row Box the tallest, plus its border,
// vertical padding and margins; an empty Box, an engine node or '' none.
const rowsOf = (n: unknown): number => {
  if (typeof n === 'string') return n === '' ? 0 : 1
  if (Array.isArray(n)) return n.reduce((sum: number, c) => sum + rowsOf(c), 0)
  if (!n || typeof n !== 'object') return 0
  const el = n as { type?: string; children?: unknown[]; props?: Record<string, unknown> }
  if (el.type === 'Text') return flat(el) === '' ? 0 : 1
  if (el.type === 'Button' || el.type === 'Svg') return 1
  if (el.type !== 'Box') return 0
  const p = el.props ?? {}
  const kids = (el.children ?? []).filter(c => c !== null && c !== undefined)
  const inner = p.flexDirection === 'row' ? Math.max(0, ...kids.map(rowsOf)) : kids.reduce((sum: number, c) => sum + rowsOf(c), 0)
  const num = (k: string) => (typeof p[k] === 'number' ? (p[k] as number) : 0)
  return inner + (p.borderStyle ? 2 : 0) + 2 * num('paddingY') + num('paddingTop') + num('paddingBottom') + num('marginTop') + num('marginBottom') + 2 * num('marginY')
}

test('the band takes its own rows and no more: folded one, unfolded the card, nothing for an empty band beneath', async ($, on) => {
  const { clock, world } = engine(on, {}, 'empty')
  await startSession($)
  await runTurn($, clock, world)
  const ui = await mount($, 'terminal', 120)
  expect(rowsOf(await ui.drawn())).toBe(1)
  await ui.press({ key: 'tab-turn' })
  // Border 2, header, a blank row, tabs, a blank row, then last turn, tools, edits, errors, cost.
  expect(rowsOf(await ui.drawn())).toBe(11)
  await ui.unmount()
})

test("the turn tab counts the main turn's calls only, the same set its breakdown reads", async ($, on) => {
  const { clock, world } = engine(on, { band: { isOpen: true, tab: 'turn' } })
  await startSession($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' })
  // A subagent's calls, during the turn and after it ends (a background agent).
  await $.tool.call({ tool: 'Bash', command: 'npm test', agentId: 'ag1' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' } as never)
  await clock.advance(5000)
  world.cost = 1.25
  await $.turn.complete({ answer: '', durationMs: 5000, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.tool.call({ tool: 'Bash', command: 'npm test', agentId: 'ag1' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/other.ts', old_string: 'a', new_string: 'b', agentId: 'ag1' })
  const ui = await mount($)
  const text = mine(await look(ui))
  expect(text).toMatch(/tools\s+2\s+◇ 1 read {2}· {2}1 TaskUpdate/)
  expect(text).not.toContain('shell')
  expect(text).not.toContain('other.ts')
  expect(text).not.toMatch(/·\s+·/)
  await ui.unmount()
})

test('edits list only the files of that turn, cut with … at the card width, never wrapped', async ($, on) => {
  const { clock, world } = engine(on, { band: { isOpen: true, tab: 'turn' } })
  await startSession($)
  await runTurn($, clock, world)
  await $.turn.start({ text: 'again', turnId: 't2' })
  for (let i = 0; i < 12; i += 1) await $.tool.call({ tool: 'Edit', file_path: `/repo/src/module-${i}.ts`, old_string: 'a', new_string: 'b' })
  await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 't2', reason: 'answer' })
  const cols = 60
  const ui = await mount($, 'terminal', cols)
  const edits = (await ui.findAll({ type: 'Text' })).map(t => t.text).find(t => t.startsWith('module-0.ts'))
  expect(edits).toBeDefined()
  expect(edits!.endsWith('…')).toBe(true)
  // The label column (7), the value (6) and the gap (3) inside the card's border and padding.
  expect(cellWidth(edits!)).toBeLessThanOrEqual(cols - 4 - 7 - 6 - 3)
  expect(mine(await look(ui))).not.toContain('parse.ts')
  await ui.unmount()
})

test('the Git tab: the commits made this session, the last fetch, the work trees, and files in a column of their own when wide', async ($, on) => {
  const { clock, world } = engine(on, { band: { isOpen: true, tab: 'git' } })
  await startSession($)
  await clock.settle()
  // Two commits later: HEAD moved, git is read again after an edit.
  world.oid = 'fedcba9876'
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' })
  await clock.advance(1000)
  let ui = await mount($, 'terminal', 90)
  let text = mine(await look(ui))
  // Words, not a line of dots.
  expect(text).toContain('2 commits since it began, then uncommitted work')
  expect(text).not.toMatch(/[●○]─/)
  expect(text).toContain('fetched 10m ago')
  expect(text).toContain('2 worktrees')
  expect(world.runs.some(a => a.includes('rev-list') && a.includes('abcdef1234..fedcba9876'))).toBe(true)
  // Narrow: the files stack under the state.
  expect(await ui.find({ key: 'git-columns' })).toBeUndefined()
  await ui.unmount()
  // Wide: the files beside it, untracked ones after the changed.
  ui = await mount($, 'terminal', 140)
  expect(await ui.find({ key: 'git-columns' })).toBeDefined()
  text = mine(await look(ui))
  expect(text).toContain('x.ts')
  expect(text).toContain('new.ts')
  expect(text).toContain('new')
  await ui.unmount()
})

test('the Context tab forecasts a limit that fills before its reset, in error, as flightdeck and the status line do', async ($, on) => {
  const { clock, world } = engine(on, { band: { isOpen: true, tab: 'context' } })
  // The 5h window: 82% used with 3h left, two hours gone: 2.05×, full before the reset.
  world.fiveLeft = 3 * 3_600_000
  await startSession($)
  await runTurn($, clock, world)
  const ui = await mount($, 'terminal', 120)
  const full = (await ui.findAll({ type: 'Text' })).find(t => /^ {3}full \d\d:\d\d$/.test(t.text))
  expect(full?.props.color).toBe('error')
  // The week, 20% used with most of it to go: no forecast.
  expect((await ui.findAll({ type: 'Text' })).filter(t => /full/.test(t.text))).toHaveLength(1)
  await ui.unmount()
})

test('the Checks tab: the last test Claude ran and how it ended, the branch CI runs and its pull request; a run that finishes raises a toast', async ($, on) => {
  const { clock, world } = engine(on, { band: { isOpen: true, tab: 'checks' } })
  const run = (status: string, conclusion: string) => ({ databaseId: 7, workflowName: 'ci', status, conclusion, createdAt: '2026-11-01T20:00:00Z', headSha: 'abcdef1234', url: 'u7' })
  world.ci = [run('in_progress', '')]
  await startSession($)
  await clock.settle()
  // The shell beneath fails every Bash call: the tests failed.
  await $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'b1' } as never)
  await clock.settle()
  const ui = await mount($, 'terminal', 120)
  const text = mine(await look(ui))
  for (const part of ['test', '✕ npm test', 'ci', '● ci', '#12', 'Unify the mods', 'approved', '1/2 checks, 1 running']) expect(text).toContain(part)
  expect(text).not.toContain('types')
  await ui.unmount()
  // The run is polled while it goes; once it passes, a toast says so, and polling stops.
  world.ci = [run('completed', 'success')]
  await clock.advance(60_000)
  expect(world.toasts).toContain('CI ci ✓ passed on main')
  const reads = world.runs.filter(a => a[0] === 'gh' && a[1] === 'run').length
  await clock.advance(120_000)
  expect(world.runs.filter(a => a[0] === 'gh' && a[1] === 'run').length).toBe(reads)
})

test('the Checks tab says why there is no CI when gh is missing', async ($, on) => {
  const { clock, world } = engine(on, { band: { isOpen: true, tab: 'checks' } })
  world.hasGh = false
  await startSession($)
  await clock.settle()
  const ui = await mount($, 'terminal', 120)
  expect(mine(await look(ui))).toContain('gh is not installed')
  await ui.unmount()
})

test('the plan: a progress meter, never dots, its count and the step under way, first in the Activity tab and in the folded row while working', async ($, on) => {
  const { clock } = engine(on, { band: { isOpen: true, tab: 'activity' } })
  await startSession($)
  await $.turn.start({ text: 'go', turnId: 'P1' })
  // The tool beneath answers TodoWrite as it does; the hook reads its input.
  await $.tool.call({
    tool: 'TodoWrite', tool_use_id: 'w1',
    todos: [
      { content: 'Parse', activeForm: 'Parsing', status: 'completed' },
      { content: 'Write tests', activeForm: 'Writing tests', status: 'in_progress' },
      { content: 'Ship', activeForm: 'Shipping', status: 'pending' },
    ],
  } as never)
  await clock.settle()
  const ui = await mount($, 'terminal', 100)
  const text = mine(await look(ui))
  expect(text).toContain('plan')
  expect(text).toContain('1/3')
  expect(text).toContain('Writing tests')
  expect(text).toMatch(/━+╸?─+/)
  expect(text).not.toMatch(/[●○•◦]{2,}/)
  await ui.unmount()
  // Folded while working: `plan 1/3` in the row.
  const folded = await mount($, 'terminal', 120, true)
  await folded.press({ key: 'fold' })
  expect(mine(await look(folded))).toContain('plan 1/3')
  await folded.unmount()
})
