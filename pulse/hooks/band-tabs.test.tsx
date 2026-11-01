import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderSurface } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { bareEmoji, cellWidth } from './style'

const T0 = 1_000_000
const STATUS = ['# branch.oid abcdef1234', '# branch.head main', '1 .M N... 100644 100644 100644 a b x.ts', '? new.ts'].join('\n')

// The world beneath pulse: clock, store, usage, git, and a band row of another mod's.
function engine(on: On, store: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: T0 })
  // The store in memory, kept where a test can read what the band wrote.
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  const world = { cost: 1, ctx: 64, hasLimits: true, runs: [] as string[][] }
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
            { kind: 'five_hour', percentUsed: 82, resetsAt: new Date(T0 + 67_000 + (4 * 60 + 51) * 60_000 + 30_000).toISOString() },
            { kind: 'seven_day', percentUsed: 20, resetsAt: new Date(T0 + 67_000 + 3 * 86_400_000 + 22 * 3_600_000 + 30_000).toISOString() },
          ]
        : [],
      cost: { usd: world.cost },
    },
  }))
  on('process.run', (_, e) => {
    world.runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: STATUS, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>other band</Text>
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
  const label = typeof el.props?.label === 'string' ? el.props.label : ''
  return label + flat(el.children ?? el.props?.children)
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

test('folded and working: the current action, tab buttons with hotkeys and the fold control', async ($, on) => {
  engine(on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' })
  const ui = await mount($, 'terminal', 100, true)
  const text = mine(await look(ui))
  expect(text).toContain('reading a.ts')
  expect(text).toContain('1 tool')
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.map(b => b.props.hotkey).filter(Boolean)).toEqual(['1', '2', '3', '4'])
  expect(buttons.map(b => b.key)).toEqual(['tab-activity', 'tab-context', 'tab-turn', 'tab-git', 'fold'])
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
  expect(text).toContain('pulse · activity')
  expect(text).toContain('✓ reading a.ts')
  expect(text).toContain('✕ run the tests')
  expect(text).toContain('editing parse.ts')

  await ui.press({ key: 'tab-context' })
  text = mine(await look(ui))
  expect(text).toContain('pulse · context')
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
  expect(text).toContain('main')
  expect(text).toContain('+1')
  expect(text).toContain('~1')
  expect(bareEmoji(text)).toEqual([])

  // The open tab's own key folds the band again.
  await ui.press({ key: 'tab-git' })
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.borderStyle === 'round')).toBe(false)
  await ui.unmount()
})

test('the active tab is the accent, the others dim', async ($, on) => {
  engine(on)
  const ui = await mount($)
  await ui.press({ key: 'tab-turn' })
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.find(b => b.key === 'tab-turn')?.props.dimColor).toBeUndefined()
  expect(buttons.find(b => b.key === 'tab-git')?.props.dimColor).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^turn$/ })).toMatchObject({ props: { color: 'claude' } })
  await ui.unmount()
})

test('the open tab and the unfolded state come back from the store in a new session', async ($, on) => {
  const store: Record<string, unknown> = { band: { isOpen: true, tab: 'git' } }
  engine(on, store)
  await startSession($)
  const ui = await mount($)
  expect(mine(await look(ui))).toContain('pulse · git')
  await ui.press({ key: 'tab-context' })
  await ui.unmount()
  expect(store.band).toEqual({ isOpen: true, tab: 'context' })
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
  expect(text.indexOf('pulse · activity')).toBeLessThan(text.indexOf('other band'))
  await ui.unmount()
})

test('git is read at start, a second after an edit and at the end of a turn, never on a draw', async ($, on) => {
  const { clock, world } = engine(on)
  await startSession($)
  await clock.settle()
  expect(world.runs).toHaveLength(1)
  expect(world.runs[0]).toEqual(['git', '-C', '/repo', '--no-optional-locks', 'status', '--porcelain=v2', '--branch'])
  for (let i = 0; i < 5; i++) {
    const ui = await mount($)
    await ui.press({ key: 'tab-git' })
    await ui.unmount()
  }
  expect(world.runs).toHaveLength(1)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Write', file_path: '/repo/b.ts', content: 'x' })
  expect(world.runs).toHaveLength(1)
  await clock.advance(1000)
  // Two edits within the second: one read.
  expect(world.runs).toHaveLength(2)
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
    // Plain Buttons draw `1: ` before their label.
    return { text, tabs, cells: cellWidth(text) + tabs * 3 }
  }
  const wide = await at(120)
  expect(wide.tabs).toBe(4)
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
  expect(buttons.map(b => b.props.label)).toEqual(['Activity', 'Context & cache', 'Turn', 'Git', 'Expand'])
  expect(buttons.every(b => b.props.plain === undefined)).toBe(true)
  const svg = await ui.find({ type: 'Svg' })
  expect(String(svg?.props.source)).toContain('linearGradient')
  expect(svg?.props.isInteractive).toBe(true)
  expect(await look(ui)).toContain('✓ 1m 05s')
  await ui.press({ key: 'fold' })
  await ui.press({ key: 'tab-context' })
  expect((await ui.findAll({ type: 'Button' })).find(b => b.key === 'tab-context')?.props.variant).toBe('primary')
  const first = (await ui.findAll({ type: 'Svg' })).map(s => String(s.props.source))
  expect(first.some(s => s.includes('<title>context 64% used'))).toBe(true)
  // Every tab draws on desktop: hover reveals sit inside keyed rows.
  for (const key of ['tab-activity', 'tab-turn', 'tab-git']) {
    await ui.press({ key })
    expect(await look(ui)).toContain('pulse')
  }
  await ui.press({ key: 'tab-context' })
  await ui.unmount()
  world.ctx = 81
  const again = await mount($, 'desktop')
  const glided = (await again.findAll({ type: 'Svg' })).map(s => String(s.props.source))
  expect(glided.some(s => s.includes('<title>context 81% used') && s.includes('<animate'))).toBe(true)
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
