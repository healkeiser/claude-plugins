import { expect, test } from 'claude-code/testing'

import { parse, parseInline, wrapSpans } from './parse'

test('fences become code parts with their language', () => {
  const parts = parse('Run this:\n\n```bash\nnpm test\n```\n\nDone.')
  expect(parts).toEqual([
    { kind: 'markdown', text: 'Run this:' },
    { kind: 'code', language: 'bash', source: 'npm test' },
    { kind: 'markdown', text: 'Done.' },
  ])
})

test('inline code, bold and links split into spans', () => {
  expect(parseInline('Edit `a.ts` **now**, see [docs](https://x.io)')).toEqual([
    { kind: 'text', text: 'Edit ' },
    { kind: 'code', text: 'a.ts' },
    { kind: 'text', text: ' ' },
    { kind: 'text', text: 'now', bold: true },
    { kind: 'text', text: ', see ' },
    { kind: 'link', label: 'docs', href: 'https://x.io' },
  ])
})

test('tables parse into header, rows and alignment', () => {
  const [part] = parse('| a | b |\n|---|--:|\n| `x` | y |')
  expect(part?.kind === 'table' && part.align).toEqual(['left', 'right'])
  expect(part?.kind === 'table' && part.rows[0]![0]).toEqual([{ kind: 'code', text: 'x' }])
})

test('a bold line opens a heading over the lines under it', () => {
  const parts = parse('**What changed:**\n- one\n- two')
  expect(parts.map(p => p.kind)).toEqual(['heading', 'lines'])
})

test('bullets change glyph by depth; ordered items keep their numbers', () => {
  const [part] = parse('- a\n  - b\n    - c\n      - d\n- e\n  1. f\n  2. g')
  expect(part?.kind === 'lines' && part.lines.map(l => l.prefix)).toEqual(['• ', '  ◦ ', '    ▪ ', '      • ', '• ', '  1. ', '  2. '])
  expect(part?.kind === 'lines' && part.lines.map(l => l.depth)).toEqual([0, 1, 2, 3, 0, 1, 1])
})

test('task items draw as open and done marks without their brackets', () => {
  const [part] = parse('- [ ] write it\n- [x] test it')
  expect(part?.kind === 'lines' && part.lines.map(l => [l.prefix, l.marker, l.spans])).toEqual([
    ['○ ', 'open', [{ kind: 'text', text: 'write it' }]],
    ['✔ ', 'done', [{ kind: 'text', text: 'test it' }]],
  ])
})

test('a line under an item hangs under its text', () => {
  const [part] = parse('- first\n  more of it')
  expect(part?.kind === 'lines' && part.lines[1]).toEqual({ prefix: '  ', isHeading: false, spans: [{ kind: 'text', text: 'more of it' }] })
})

test('a plain quote keeps its nesting level; a callout stays a callout', () => {
  const [part] = parse('> outer\n>> inner')
  expect(part?.kind === 'quote' && part.lines.map(l => [l.level, l.spans])).toEqual([
    [1, [{ kind: 'text', text: 'outer' }]],
    [2, [{ kind: 'text', text: 'inner' }]],
  ])
  expect(parse('> [!TIP]\n> hi')[0]?.kind).toBe('callout')
})

test('a rule alone on a line is its own part; a setext underline is not', () => {
  for (const r of ['---', '***', '___', '- - -']) expect(parse(`a\n\n${r}\n\nb`).map(p => p.kind)).toEqual(['markdown', 'rule', 'markdown'])
  expect(parse('a\n***\nb').map(p => p.kind)).toEqual(['markdown', 'rule', 'markdown'])
  expect(parse('Title\n---').map(p => p.kind)).toEqual(['markdown'])
})

test('strikethrough splits into its own span', () => {
  expect(parseInline('was ~~old~~ new')).toEqual([
    { kind: 'text', text: 'was ' },
    { kind: 'text', text: 'old', strike: true },
    { kind: 'text', text: ' new' },
  ])
  expect(parse('was ~~old~~')[0]?.kind).toBe('lines')
})

test('list items keep their marker', () => {
  const [part] = parse('- run `ls`\n2. then `cd`')
  expect(part?.kind === 'lines' && part.lines.map(l => l.prefix)).toEqual(['• ', '2. '])
})

test('wrapSpans breaks at spaces and splits a word longer than a line', () => {
  const text = (spans: ReturnType<typeof parseInline>, width: number) =>
    wrapSpans(spans, width).map(l => l.map(s => (s.kind === 'link' ? s.label : s.text)).join(''))
  expect(text(parseInline('the quick `brown` foxes'), 9)).toEqual(['the quick', 'brown', 'foxes'])
  expect(text(parseInline('abcdefghij'), 4)).toEqual(['abcd', 'efgh', 'ij'])
})

test('an indented fence (inside a list item) is code, without the indent', () => {
  const parts = parse('1. Run it:\n\n    ```\n    ! cd ~/x && uv run a.py\n      nested\n    ```\n2. Done.')
  expect(parts.find(p => p.kind === 'code')).toEqual({ kind: 'code', language: '', source: '! cd ~/x && uv run a.py\n  nested' })
})

test('CRLF line ends are not copied', () => {
  expect(parse('```sh\r\necho hi\r\n```')[0]).toEqual({ kind: 'code', language: 'sh', source: 'echo hi' })
})
