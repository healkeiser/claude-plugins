import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { cellWidth } from './style'

type El = { key: string | undefined; text: string; props: Record<string, unknown> }
type Drawn = { findAll: (q: { type: string }) => Promise<El[]> }

const props = (text: string) => ({ text, origin: { kind: 'composer' }, isExpanded: false }) as never
const pane = (bodyColumns: number, surface: 'terminal' | 'desktop' = 'terminal') =>
  ({ plugin: 'postcard', surface, component: 'Pane', requestId: 'prompts', props: { bodyColumns } as never }) as const
// The stored row the engine appends as a prompt is sent; its uuid is the drawn row's id.
const sentRow = (uuid: string) =>
  ({ message: { type: 'user', role: 'user', content: [{ type: 'text', text: uuid }] }, door: 'prompt', origin: { kind: 'composer' }, uuid }) as never

async function prompts($: Engine, texts: string[]) {
  for (const [k, text] of texts.entries()) {
    await $.ui.mount({ plugin: 'postcard', surface: 'terminal', component: 'UserMessage', requestId: `m${k + 1}`, props: props(text) })
  }
}

const texts = async (d: Drawn) => (await d.findAll({ type: 'Text' })).map(t => t.text)
const boxes = async (d: Drawn) => (await d.findAll({ type: 'Box' })).map(b => b.props)
const keys = async (d: Drawn) => (await d.findAll({ type: 'Button' })).map(b => b.key)
// Each row's number column, as drawn: the dim, tabular Text that starts with `#` or a pad.
const numbers = async (d: Drawn) => (await d.findAll({ type: 'Text' })).filter(t => t.props.tabular && /^\s*#\d+$/.test(t.text)).map(t => t.text)

test('the pane follows the kit: header chip, one blank row, the search card, then the list', async $ => {
  await prompts($, ['fix the band'])
  const ui = await $.ui.mount(pane(60))
  const all = await boxes(ui)
  expect(all[0]).toMatchObject({ paddingTop: 1 })
  expect(all[1]).toMatchObject({ key: 'kit-header', height: 1, overflow: 'hidden' })
  const find = all.find(b => b.key === 'search-bar')
  expect(find).toMatchObject({ borderStyle: 'round', borderColor: 'subtle', paddingX: 1 })
  expect(all.indexOf(find!)).toBeGreaterThan(all.findIndex(b => b.height === 1 && b.key === 'gap-head'))
  expect(await texts(ui)).toContain('⌕ ')
  // The search card turns accent while a query is typed.
  await ui.input({ key: 'search', text: 'band', kind: 'change' } as never)
  expect((await boxes(ui)).find(b => b.key === 'search-bar')).toMatchObject({ borderColor: 'claude' })
})

test('the header is the Prompts title, bold in the accent as in every pane, the count, a rule, then prev and next', async $ => {
  await prompts($, ['Fix the parser', 'ship it', 'parser tests'])
  const ui = await $.ui.mount(pane(60))
  const all = await ui.findAll({ type: 'Text' })
  const label = all.find(t => t.text === 'Prompts')!
  expect(label.props).toMatchObject({ color: 'claude', weight: 'bold' })
  expect(label.props.backgroundColor).toBeUndefined()
  // Bold: the title, and the open tab as Claude Code marks its own.
  expect(all.filter(t => t.props.weight === 'bold' || t.props.bold).map(t => t.text)).toEqual(['Prompts', ' Prompts '])
  const t = all.map(x => x.text)
  expect(t[t.indexOf('Prompts') + 1]).toBe('3')
  expect(t[t.indexOf('Prompts') + 2]).toMatch(/^─+$/)
  expect((await keys(ui)).slice(0, 2)).toEqual(['prev', 'next'])

  await ui.input({ key: 'search', text: 'parser', kind: 'change' } as never)
  expect(await texts(ui)).toContain('2 of 3')
})

test('the number column is right-aligned and as wide on every row', async $ => {
  await prompts($, Array.from({ length: 12 }, (_, k) => `prompt ${k + 1}`))
  const ui = await $.ui.mount(pane(80))
  const nums = await numbers(ui)
  expect(nums).toHaveLength(12)
  expect(new Set(nums.map(cellWidth))).toEqual(new Set([3]))
  expect(nums.at(-1)).toBe(' #1')
  expect(nums[0]).toBe('#12')
  // Rows are not bold: one bold per block.
  expect((await ui.findAll({ type: 'Button' })).filter(b => b.props.weight === 'bold')).toEqual([])
})

// The kit has no transcript to scroll (features.test.tsx), so the cursor a jump
// would leave is seeded as the stored value.
test('the row last jumped to carries the ● mark, not colour alone', async ($, on) => {
  let jumped = false
  on('state.get', (_, e, next) => (jumped && (e as { key?: string }).key === 'cursor' ? ({ value: { value: 'm2', version: 1 } } as never) : next(e)))
  await prompts($, ['one', 'two', 'three'])
  const before = await $.ui.mount(pane(60))
  expect(await texts(before)).not.toContain('● ')
  await before.unmount()
  jumped = true
  const ui = await $.ui.mount(pane(60))
  const all = await ui.findAll({ type: 'Text' })
  expect(all.filter(t => t.text === '● ').map(t => t.props.color)).toEqual(['claude'])
  // The mark sits on the row of #2 alone, its number in the accent too.
  expect(all.filter(t => t.props.color === 'claude' && /#\d/.test(t.text)).map(t => t.text)).toEqual(['#2'])
  expect(all.filter(t => t.text === '  ')).toHaveLength(2)
})

test('a sent prompt shows its age, dim and right-aligned', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.session(on)
  await $.session.append(sentRow('m1'))
  await clock.advance(65 * 60_000)
  await $.session.append(sentRow('m2'))
  await clock.advance(2 * 60_000)
  await prompts($, ['older', 'newer'])
  const ui = await $.ui.mount(pane(80))
  const ages = (await ui.findAll({ type: 'Text' })).filter(t => t.props.dimColor && t.props.tabular && !t.text.includes('#'))
  expect(ages.map(t => t.text)).toEqual(['2m', '1h 07m'])
  const cols = (await boxes(ui)).filter(b => b.justifyContent === 'flex-end')
  expect(cols.map(b => b.width)).toEqual([6, 6])
})

test('narrow widths drop the age, then the actions, before cutting the words', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  mock.session(on)
  await $.session.append(sentRow('m1'))
  await clock.advance(5 * 60_000)
  await prompts($, ['a prompt with a fair number of words in it'])
  const at = async (w: number) => {
    const ui = await $.ui.mount(pane(w))
    const t = await texts(ui)
    const k = await keys(ui)
    const row = (await ui.findAll({ type: 'Button' })).find(b => b.key === 'p1')!.text
    await ui.unmount()
    return { hasAge: t.includes('5m'), hasActions: k.includes('e1'), row }
  }
  // inner = w (no card around the list), 3 cells of it the hotkey's `1: `; a row: mark 2, number 2, gap 1, words, age 1 + 2, actions 13.
  expect(await at(79)).toEqual({ hasAge: true, hasActions: true, row: '#1 a prompt with a fair number of words in it' })
  expect(await at(40)).toEqual({ hasAge: true, hasActions: true, row: '#1 a prompt with a…' })
  expect(await at(39)).toEqual({ hasAge: false, hasActions: true, row: '#1 a prompt with a f…' })
  expect(await at(37)).toEqual({ hasAge: false, hasActions: true, row: '#1 a prompt with a…' })
  expect(await at(36)).toEqual({ hasAge: false, hasActions: false, row: '#1 a prompt with a fair number…' })
})

test('the header drops its prev and next before the count', async $ => {
  await prompts($, ['one'])
  const ui = await $.ui.mount(pane(20))
  expect(await keys(ui)).not.toContain('prev')
  expect(await texts(ui)).toEqual(expect.arrayContaining(['Prompts', '1']))
})

test('a graphical surface draws no box-character rule; the meta sits right by layout', async $ => {
  await prompts($, ['one'])
  const ui = await $.ui.mount(pane(60, 'desktop'))
  expect((await texts(ui)).some(t => t.includes('─'))).toBe(false)
  expect((await keys(ui)).slice(0, 2)).toEqual(['prev', 'next'])
  expect((await boxes(ui)).some(b => b.flexGrow === 1 && b.borderStyle === undefined)).toBe(true)
})
