import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { asHunk, parse } from './parse'

const mount = ($: Engine, text: string) =>
  $.ui.mount({ plugin: 'gloss', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true } })

test('a Next: paragraph becomes its own part', () => {
  expect(parse('Done.\n\nNext: run `npm test`.')).toEqual([
    { kind: 'markdown', text: 'Done.' },
    { kind: 'next', spans: [{ kind: 'text', text: 'run ' }, { kind: 'code', text: 'npm test' }, { kind: 'text', text: '.' }] },
  ])
})

test('a GitHub callout keeps its type and body', () => {
  const [part] = parse('> [!WARNING]\n> This deletes `X:`')
  expect(part?.kind).toBe('callout')
  expect(part?.kind === 'callout' && part.type).toBe('warning')
})

test('a headerless diff gets a counted hunk header', () => {
  expect(asHunk('-old\n+new\nsame')).toBe('@@ -1,2 +1,2 @@\n-old\n+new\n same')
})

test('a table draws its header and a column rule', async $ => {
  const ui = await mount($, '| Spot | Now |\n|---|---|\n| band | `empty` |')
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts).toContain('Spot')
  // `empty` as a chip is 7 cells wide, so the second column is 7.
  expect(texts).toContain('├──────┼─────────┤')
})

test('a table wider than the window keeps its border and narrows a column', async $ => {
  const long = 'word '.repeat(60).trim()
  const ui = await $.ui.mount({
    plugin: 'gloss', surface: 'terminal', component: 'AssistantMessage',
    props: { text: `| Mod | What |\n|---|---|\n| a | ${long} |`, isFirstOfReply: true },
    viewport: { columns: 80, rows: 40 },
  } as never)
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts).toContain('Mod')
  expect(texts.some(t => t.includes('┼'))).toBe(true)
})

test('long blocks fold and unfold', async $ => {
  const source = Array.from({ length: 30 }, (_, n) => `line ${n + 1}`).join('\n')
  const ui = await mount($, '```text\n' + source + '\n```')
  expect((await ui.find({ key: 'fold0' }))?.text).toContain('show all 30 lines')
  await ui.press({ key: 'fold0' })
  expect((await ui.find({ key: 'fold0' }))?.text).toContain('fold')
})

test('a code block has no side border, so a mouse selection copies only code', async $ => {
  const ui = await mount($, '```sh\n! cd ~/x\n```')
  const boxes = await ui.findAll({ type: 'Box' })
  expect(boxes.some(b => (b as { props?: { borderStyle?: string } }).props?.borderStyle)).toBe(false)
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts.some(t => t.startsWith('╭─ '))).toBe(true)
  expect(texts.some(t => t.startsWith('╰─'))).toBe(true)
  expect((await ui.find({ type: 'Code' }))?.props?.startLine).toBeUndefined()
})
