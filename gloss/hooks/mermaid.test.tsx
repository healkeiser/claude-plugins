import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { layout, parseMermaid, splitMermaid, toSvg } from './mermaid'
import { cellWidth } from './style'

const FLOW = 'graph TD\n  A[Start] --> B{Ok?}\n  B -- yes --> C[Ship]\n  B -->|no| D(Fix)\n  D --> B'
const SEQ = 'sequenceDiagram\n  participant A as Alice\n  A->>Bob: Hello\n  Bob-->>A: Hi\n  Note right of Bob: busy\n  loop retry\n  A-xBob: bye\n  end'

test('a flowchart reads its nodes, labels and edges', () => {
  const d = parseMermaid(FLOW)
  expect(d).toMatchObject({ kind: 'flow', dir: 'TD' })
  if ('error' in d || d.kind !== 'flow') throw new Error('not a flowchart')
  expect(d.nodes.map(n => n.label)).toEqual(['Start', 'Ok?', 'Ship', 'Fix'])
  expect(d.edges.map(e => `${e.from}>${e.to}${e.label ? `:${e.label}` : ''}`)).toEqual(['A>B', 'B>C:yes', 'B>D:no', 'D>B'])
  const chained = parseMermaid('flowchart LR; A & B --> C -.-> D["quoted <br> label"]')
  if ('error' in chained || chained.kind !== 'flow') throw new Error('not a flowchart')
  expect(chained.edges.map(e => `${e.from}>${e.to}${e.isDashed ? '~' : ''}`)).toEqual(['A>C', 'B>C', 'C>D~'])
  expect(chained.nodes.at(-1)?.label).toBe('quoted label')
})

test('a sequence diagram reads participants, messages, notes and blocks', () => {
  const d = parseMermaid(SEQ)
  if ('error' in d || d.kind !== 'sequence') throw new Error('not a sequence diagram')
  expect(d.actors.map(a => a.label)).toEqual(['Alice', 'Bob'])
  expect(d.steps.map(s => s.kind)).toEqual(['message', 'message', 'note', 'block', 'message', 'block'])
  expect(d.steps[1]).toMatchObject({ isDashed: true, head: 'arrow' })
  expect(d.steps[4]).toMatchObject({ head: 'cross' })
})

test('unsupported diagrams and unreadable lines say why', () => {
  expect(parseMermaid('pie title Pets\n "Dogs" : 3')).toEqual({ error: 'pie diagram is not drawn here' })
  expect(parseMermaid('graph RL\n A --> B')).toEqual({ error: 'RL flowcharts are not drawn here' })
  expect('error' in parseMermaid('graph TD\n A --> [oops')).toBe(true)
})

test('a flowchart lays out as boxes joined by lines and arrowheads, within the width', () => {
  const d = parseMermaid(FLOW)
  if ('error' in d) throw new Error(d.error)
  const rows = layout(d, 60)!.rows()
  const all = rows.join('\n')
  expect(all).toContain('│ Start │')
  expect(all).toContain('▾')
  expect(all).toContain('▴') // the edge back up to B
  expect(all).toContain('yes')
  expect(rows.every(r => cellWidth(r) <= 60)).toBe(true)
  expect(layout(d, 12)).toBeNull()
})

test('LR lays out left to right with a label on its edge', () => {
  const d = parseMermaid('flowchart LR\n  A[Client] -->|HTTP| B(Server)')
  if ('error' in d) throw new Error(d.error)
  expect(layout(d, 80)!.rows()).toEqual([
    '╭────────╮         ╭────────╮',
    '│ Client ├──HTTP──▸│ Server │',
    '╰────────╯         ╰────────╯',
  ])
})

test('a sequence diagram draws lifelines, arrows both ways and a self-call', () => {
  const d = parseMermaid('sequenceDiagram\n  A->>B: go\n  B-->>A: done\n  A->>A: think')
  if ('error' in d) throw new Error(d.error)
  const all = layout(d, 80)!.rows().join('\n')
  expect(all).toMatch(/├─+▸┤/)
  expect(all).toMatch(/├◂·+┤/)
  expect(all).toContain('├◂─╯')
})

test('the SVG drawing has a box per node and an arrowhead per arrow', () => {
  const d = parseMermaid(FLOW)
  if ('error' in d) throw new Error(d.error)
  const svg = toSvg(layout(d, 200)!)
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg.match(/<rect /g)?.length).toBe(4)
  expect(svg.match(/<polygon /g)?.length).toBe(4)
  expect(svg).toContain('>Start</text>')
})

test('splitMermaid keeps the text around each fence', () => {
  expect(splitMermaid('Look:\n\n```mermaid\ngraph TD\nA-->B\n```\n\nDone.').map(p => p.kind)).toEqual(['text', 'mermaid', 'text'])
})

const mountAt = ($: Engine, text: string, columns = 100, surface = 'terminal') =>
  $.ui.mount({
    plugin: 'gloss', surface, component: 'AssistantMessage',
    props: { text, isFirstOfReply: true }, viewport: { columns, rows: 40 },
  } as never)

const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text?: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')

test('the terminal draws the diagram in the open block, its source still copyable', async ($, on) => {
  const copied: string[] = []
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  const source = 'graph LR\n  A --> B'
  const ui = await mountAt($, '```mermaid\n' + source + '\n```')
  const all = await texts(ui)
  expect(all.some(t => t.includes('│ A ├'))).toBe(true)
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  await ui.press({ key: 'copy0' })
  expect(copied).toEqual([source])
})

test('an unsupported or too-wide diagram falls back to its source with a note', async $ => {
  const pie = await mountAt($, '```mermaid\npie\n  "a" : 1\n```')
  expect((await texts(pie)).some(t => t.includes('pie diagram is not drawn here: the source is shown'))).toBe(true)
  expect(await pie.find({ type: 'Code' })).toBeDefined()
  const wide = await mountAt($, '```mermaid\ngraph LR\n  A[a long first label] --> B[a long second label] --> C[a long third label]\n```', 40)
  expect((await texts(wide)).some(t => t.includes('too wide for 36 columns'))).toBe(true)
})

test('glyphs: text draws the diagram in ASCII', { options: { glyphs: 'text' } }, async $ => {
  const ui = await mountAt($, '```mermaid\nsequenceDiagram\n  A->>B: go\n  B-->>A: done\n```')
  expect(/^[\x20-\x7e]*$/.test((await texts(ui)).join(''))).toBe(true)
})

test('a graphical surface draws the diagram as SVG and the rest natively', async $ => {
  const ui = await mountAt($, 'Here:\n\n```mermaid\ngraph TD\n  A --> B\n```\n\nDone.', 100, 'desktop')
  const svg = await ui.find({ type: 'Svg' })
  expect(String(svg?.props.source)).toContain('<svg')
  expect((await ui.findAll({ type: 'Markdown' })).length).toBe(2)
})
