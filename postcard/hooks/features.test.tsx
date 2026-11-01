import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { marks, matches, step } from './register'

const props = (text: string) => ({ text, origin: { kind: 'composer' }, isExpanded: false }) as never
const PANE = { plugin: 'postcard', surface: 'terminal', component: 'Pane', requestId: 'prompts', props: { bodyColumns: 80 } as never } as const
const prompts = (args: string) => ({ command: 'prompts', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } })

// Stands in for the engine: records each fill, submit and toast; the box holds `draft`.
function engine(on: On, draft = '') {
  const seen = { filled: [] as string[], submitted: [] as string[], toasts: [] as string[] }
  on('prompt.read', () => ({ value: { text: draft, cursor: 0 } }) as never)
  on('prompt.fill', (_, e) => {
    seen.filled.push(e.text)
    return { isFilled: true }
  })
  on('prompt.submit', (_, e) => {
    seen.submitted.push(e.text)
    return { text: e.text }
  })
  on('ui.toast', (_, e) => {
    seen.toasts.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  return seen
}

async function three($: Engine) {
  for (const [id, text] of [['a', 'Fix the parser'], ['b', 'add tests\nfor the PARSER too'], ['c', 'ship it']]) {
    await $.ui.mount({ plugin: 'postcard', surface: 'terminal', component: 'UserMessage', requestId: id!, props: props(text!) })
  }
}

const rows = async (pane: { findAll: (q: { type: string }) => Promise<{ key: string | undefined; text: string }[]> }) =>
  (await pane.findAll({ type: 'Button' })).filter(b => /^p\d/.test(b.key ?? '')).map(b => b.text)

test('step: prev from the bottom is the newest, then older; next walks back; ends give nothing', () => {
  const ids = ['a', 'b', 'c']
  expect(step(ids, undefined, -1)).toBe('c')
  expect(step(ids, 'c', -1)).toBe('b')
  expect(step(ids, 'a', -1)).toBeUndefined()
  expect(step(ids, 'a', 1)).toBe('b')
  expect(step(ids, 'c', 1)).toBeUndefined()
  expect(step(ids, undefined, 1)).toBeUndefined()
  expect(step(ids, 'gone', -1)).toBe('c')
  expect(step([], undefined, -1)).toBeUndefined()
})

test('matches and marks: case-insensitive, special characters literal, matches flagged', () => {
  expect(matches('Fix the Parser', 'parser')).toBe(true)
  expect(matches('a.b', '.')).toBe(true)
  expect(matches('ab', '.')).toBe(false)
  expect(matches('anything', '')).toBe(true)
  expect(marks('Parse the parser', 'PARSE')).toEqual([
    { text: 'Parse', isMatch: true },
    { text: ' the ', isMatch: false },
    { text: 'parse', isMatch: true },
    { text: 'r', isMatch: false },
  ])
})

// The test kit has no transcript to scroll and no hook sees a plugin's scroll
// to a transcript row: the scroll rejects (a /prompts run then finds its hook
// skipped), which is how these tests see a jump was tried. Which row `step`
// picks is tested above.
const tried = (p: Promise<unknown>) =>
  p.then(() => 'none', (err: unknown) => (/no implementation for (ui\.scroll|command\.run)/.test(String(err)) ? 'scroll' : String(err)))

test('/prompts prev jumps to a prompt; next from the bottom and prev with none say so and scroll nothing', async ($, on) => {
  const seen = engine(on)
  expect(await tried($.command.run(prompts('prev')))).toBe('none')
  expect(seen.toasts).toEqual(['No earlier prompt.'])
  await three($)
  expect(await tried($.command.run(prompts('next')))).toBe('none')
  expect(seen.toasts).toEqual(['No earlier prompt.', 'No later prompt.'])
  expect(await tried($.command.run(prompts('prev')))).toBe('scroll')
})

test('/prompts with other words gives the usage', async ($, on) => {
  engine(on)
  expect(await $.command.run(prompts('sideways'))).toMatchObject({ text: 'Usage: /prompts, /prompts prev, /prompts next' })
})

test('the pane prev and next buttons jump too, and carry a keybinding action, not a hotkey', async ($, on) => {
  const seen = engine(on)
  await three($)
  const pane = await $.ui.mount(PANE)
  expect(await tried(pane.press({ key: 'next' }))).toBe('none')
  expect(seen.toasts).toEqual(['No later prompt.'])
  expect(await tried(pane.press({ key: 'prev' }))).toBe('scroll')
  const nav = (await pane.findAll({ type: 'Button' })).filter(b => b.key === 'prev' || b.key === 'next')
  expect(nav.map(b => b.props.action)).toEqual(['app:diffFileListUp', 'app:diffFileListDown'])
  expect(nav.map(b => b.props.hotkey)).toEqual([undefined, undefined])
})

test('search filters as you type, case-insensitive, and lights the match in the accent role', async ($, on) => {
  engine(on)
  await three($)
  const pane = await $.ui.mount(PANE)
  await pane.input({ key: 'search', text: 'parser', kind: 'change' })
  // The second prompt shows its matching line, not its first.
  expect(await rows(pane)).toEqual(['#2 for the PARSER too', '#1 Fix the parser'])
  const lit = (await pane.findAll({ type: 'Text' })).filter(t => t.props.color === 'claude' && t.text !== '⌕ ' && t.text !== 'Prompts').map(t => t.text)
  expect(lit).toEqual(['PARSER', 'parser'])
  await pane.input({ key: 'search', text: 'nothing like it', kind: 'change' })
  expect(await rows(pane)).toEqual([])
  expect((await pane.find({ type: 'Text', text: /No prompt matches/ }))).toBeDefined()
})

test('Enter in the search field jumps to the first match, or says none matches', async ($, on) => {
  const seen = engine(on)
  await three($)
  const pane = await $.ui.mount(PANE)
  expect(await tried(pane.input({ key: 'search', text: 'zzz' }))).toBe('none')
  expect(seen.toasts).toEqual(['No prompt matches.'])
  expect(await tried(pane.input({ key: 'search', text: 'PARSER' }))).toBe('scroll')
})

test('/prompts opens with an empty search', async ($, on) => {
  engine(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await three($)
  const pane = await $.ui.mount(PANE)
  await pane.input({ key: 'search', text: 'ship', kind: 'change' })
  expect(await rows(pane)).toEqual(['#3 ship it'])
  await $.command.run(prompts(''))
  expect(await rows(pane)).toHaveLength(3)
})

test('edit puts the prompt in an empty prompt box and sends nothing', async ($, on) => {
  const seen = engine(on)
  await $.ui.mount({
    plugin: 'postcard', surface: 'terminal', component: 'UserMessage', requestId: 'a',
    props: props('<pasted_content id="1">\nsudo ls\n</pasted_content id="1">'),
  })
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'e1' })
  expect(seen.filled).toEqual(['sudo ls'])
  expect(seen.submitted).toEqual([])
})

test('edit never writes over a draft in the prompt box', async ($, on) => {
  const seen = engine(on, 'half a thought')
  await three($)
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'e1' })
  expect(seen.filled).toEqual([])
  expect(seen.toasts.some(t => t.includes('draft'))).toBe(true)
})

test('re-send submits the prompt as it was, only on its press', async ($, on) => {
  const seen = engine(on)
  await three($)
  const pane = await $.ui.mount(PANE)
  // Drawing, typing a search and jumping send nothing.
  await pane.input({ key: 'search', text: 'ship', kind: 'change' })
  expect(await tried(pane.press({ key: 'p3' }))).toBe('scroll')
  expect(seen.submitted).toEqual([])
  await pane.press({ key: 's3' })
  expect(seen.submitted).toEqual(['ship it'])
  expect(seen.filled).toEqual([])
})

test('digit hotkeys live only on the pane rows; cards and command output carry none', async ($, on) => {
  engine(on)
  const card = await $.ui.mount({ plugin: 'postcard', surface: 'terminal', component: 'UserMessage', requestId: 'a', props: props('one') })
  expect(await card.findAll({ type: 'Button' })).toEqual([])
  const out = await $.ui.mount({
    plugin: 'postcard', surface: 'terminal', component: 'CommandOutput',
    props: { command: 'cost', args: '', text: 'x', isErrored: false },
  } as never)
  expect(await out.findAll({ type: 'Button' })).toEqual([])
  const pane = await $.ui.mount(PANE)
  const withKeys = (await pane.findAll({ type: 'Button' })).filter(b => b.props.hotkey !== undefined)
  expect(withKeys.map(b => [b.key, b.props.hotkey])).toEqual([['p1', '1']])
})

test('mobile, which draws no Input, still lists prompts', async ($, on) => {
  engine(on)
  await three($)
  const pane = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await pane.find({ type: 'Input' })).toBeUndefined()
  expect(await rows(pane)).toHaveLength(3)
})

test('a prompt queued while a turn runs is listed once: the queued card is not a prompt of its own', async ($, on) => {
  engine(on)
  // Stand in for the engine beneath the plugins: a turn starts, a row is stored, the clock reads.
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  mock.session(on)
  mock.clock(on, { now: 0 })
  await $.ui.mount({ plugin: 'postcard', surface: 'terminal', component: 'UserMessage', requestId: 'a', props: props('Fix the parser') })
  await $.turn.start({ text: 'Fix the parser', turnId: 'T1' } as never)
  // Typed while the turn runs: drawn as a queued card, under the queue row's own id.
  await $.ui.mount({ plugin: 'postcard', surface: 'terminal', component: 'UserMessage', requestId: 'q1', props: props('and the lexer') })
  // Delivered: stored with door `delivery`, then drawn again as a sent prompt under that uuid.
  await $.session.append({ message: { type: 'user', role: 'user', content: [{ type: 'text', text: 'and the lexer' }] }, door: 'delivery', origin: { kind: 'composer' }, uuid: 'd1' } as never)
  await $.ui.mount({ plugin: 'postcard', surface: 'terminal', component: 'UserMessage', requestId: 'd1', props: props('and the lexer') })
  const pane = await $.ui.mount(PANE)
  expect(await rows(pane)).toEqual(['#2 and the lexer', '#1 Fix the parser'])
})
