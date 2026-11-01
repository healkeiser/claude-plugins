export type Part =
  | { kind: 'code'; language: string; source: string }
  | { kind: 'markdown'; text: string }
  | { kind: 'lines'; lines: Line[] }
  | { kind: 'callout'; type: CalloutType; lines: Line[] }
  | { kind: 'next'; spans: Span[] }
  | { kind: 'heading'; spans: Span[] }
  | { kind: 'table'; header: Span[][]; rows: Span[][][]; align: Align[]; source: string }

export type Align = 'left' | 'center' | 'right'

export type CalloutType = 'note' | 'tip' | 'important' | 'warning' | 'caution'

export type Line = { prefix: string; isHeading: boolean; spans: Span[] }

export type Span =
  | { kind: 'text'; text: string; bold?: boolean; italic?: boolean }
  | { kind: 'code'; text: string }
  | { kind: 'link'; label: string; href: string }

// Any indent: a fence inside a list item sits under its bullet, often 3+ spaces in.
const FENCE = /^([ \t]*)(`{3,}|~{3,})\s*([\w+#.-]*)/

// Splits a reply into code fences and prose; prose blocks holding inline code
// become our own lines, every other block stays with the engine's Markdown.
export function parse(text: string): Part[] {
  const parts: Part[] = []
  const prose: string[] = []
  const lines = text.split('\n')

  const flushProse = () => {
    if (prose.length) parts.push(...parseProse(prose.join('\n')))
    prose.length = 0
  }

  for (let i = 0; i < lines.length; i++) {
    const open = FENCE.exec(lines[i]!)
    if (!open) {
      prose.push(lines[i]!)
      continue
    }
    const indent = open[1]!.length
    const marker = open[2]!
    const body: string[] = []
    let j = i + 1
    while (j < lines.length && !lines[j]!.trimStart().startsWith(marker)) body.push(lines[j++]!)
    flushProse()
    // Drop the fence's own indent from each line (CommonMark), so a copied
    // command starts at its first character, not at the list's indentation.
    const strip = (l: string) => l.replace(new RegExp(`^[ \\t]{0,${indent}}`), '').replace(/\r$/, '')
    parts.push({ kind: 'code', language: open[3] ?? '', source: body.map(strip).join('\n') })
    i = j
  }
  flushProse()
  return merge(parts)
}

const HEADING = /^\s*(?:#{1,6}\s+(.+?)\s*#*|\*\*([^*\n]+)\*\*)\s*$/
const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_RULE = /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*(:?-{2,}:?\s*)?\|?\s*$/

const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim())

function parseTable(blockLines: string[]): Part | null {
  if (blockLines.length < 2 || !blockLines.every(l => TABLE_ROW.test(l)) || !TABLE_RULE.test(blockLines[1]!)) return null
  const align = cells(blockLines[1]!).map((c): Align =>
    c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left')
  const header = cells(blockLines[0]!)
  const rows = blockLines.slice(2).map(r => {
    const row = cells(r)
    return header.map((_, k) => parseInline(row[k] ?? ''))
  })
  return { kind: 'table', header: header.map(h => parseInline(h)), rows, align, source: blockLines.join('\n') }
}

function parseProse(text: string): Part[] {
  return text.split(/\n\s*\n/).map(b => b.replace(/^\n+|\n+$/g, '')).filter(b => b.trim()).flatMap(parseBlock)
}

// A heading line opens a block: it becomes its own part, and the lines under it
// are read again as a block of their own.
function parseBlock(block: string): Part[] {
  const blockLines = block.split('\n')
  const heading = HEADING.exec(blockLines[0]!)
  if (heading) {
    const rest = blockLines.slice(1).join('\n')
    return [{ kind: 'heading', spans: parseInline(heading[1] ?? heading[2]!) }, ...(rest.trim() ? parseBlock(rest) : [])]
  }
  const table = parseTable(blockLines)
  if (table) return [table]
  return [parseOther(block, blockLines)]
}

function parseOther(block: string, blockLines: string[]): Part {
    const callout = /^\s*>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i.exec(blockLines[0]!)
    if (callout && blockLines.every(l => /^\s*>/.test(l))) {
      const body = blockLines.slice(1).map(l => l.replace(/^\s*>\s?/, ''))
      return { kind: 'callout', type: callout[1]!.toLowerCase() as CalloutType, lines: body.map(parseLine) }
    }

    const nextLine = /^\s*(?:\*\*)?Next:(?:\*\*)?\s*(.*)$/s.exec(block)
    if (nextLine) return { kind: 'next', spans: parseInline(nextLine[1]!.replace(/\s*\n\s*/g, ' ')) }

    // Tables, quotes and indented blocks are the engine's to draw.
    const isSimple = block.includes('`') &&
      blockLines.every(l => !/^\s*(\||>)/.test(l) && !/^ {4,}\S/.test(l) && !/^\s*([-*_])\s*\1\s*\1/.test(l))
    return isSimple
      ? { kind: 'lines', lines: blockLines.map(parseLine) }
      : { kind: 'markdown', text: block }
}

// Joins neighbouring blocks of one kind so spacing stays even.
function merge(parts: Part[]): Part[] {
  const out: Part[] = []
  for (const p of parts) {
    const last = out[out.length - 1]
    if (p.kind === 'markdown' && last?.kind === 'markdown') last.text += '\n\n' + p.text
    else out.push(p)
  }
  return out
}

function parseLine(line: string): Line {
  const heading = /^\s*#{1,6}\s+(.*)$/.exec(line)
  if (heading) return { prefix: '', isHeading: true, spans: parseInline(heading[1]!) }
  const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)
  if (item) {
    const marker = /\d/.test(item[2]!) ? item[2]! : '•'
    return { prefix: `${item[1]}${marker} `, isHeading: false, spans: parseInline(item[3]!) }
  }
  return { prefix: '', isHeading: false, spans: parseInline(line) }
}

const INLINE = /(`+)([^`]|[^`].*?[^`])\1(?!`)|\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:[^)\s]+|file:[^)\s]+)\)|(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])|(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)/g

export function parseInline(text: string): Span[] {
  const spans: Span[] = []
  let at = 0
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > at) spans.push({ kind: 'text', text: text.slice(at, m.index) })
    if (m[1]) spans.push({ kind: 'code', text: m[2]!.trim() || m[2]! })
    else if (m[3]) spans.push({ kind: 'text', text: m[3], bold: true })
    else if (m[4]) spans.push({ kind: 'link', label: m[4], href: m[5]! })
    else spans.push({ kind: 'text', text: m[6] ?? m[7] ?? '', italic: true })
    at = m.index! + m[0].length
  }
  if (at < text.length) spans.push({ kind: 'text', text: text.slice(at) })
  return spans
}

// shortcut: counts one cell per character, so wide glyphs (CJK, emoji) misalign
// a column; measure display width if tables with them show up.
export const spanWidth = (s: Span) => (s.kind === 'code' ? s.text.length + 2 : s.kind === 'link' ? s.label.length : s.text.length)

// Breaks spans into lines at most `width` cells wide, at spaces where it can and
// mid-word where a word is longer than a line. A link too long for a line loses
// its target and wraps as text.
export function wrapSpans(spans: Span[], width: number): Span[][] {
  const words: { span: Span; isSpaced: boolean }[] = []
  let isSpaced = false
  for (const s of spans) {
    if (s.kind !== 'text') {
      words.push({ span: s, isSpaced })
      isSpaced = false
      continue
    }
    for (const bit of s.text.split(/(\s+)/)) {
      if (/^\s+$/.test(bit)) isSpaced = true
      else if (bit) {
        words.push({ span: { ...s, text: bit }, isSpaced })
        isSpaced = false
      }
    }
  }

  const chunks = (s: Span): Span[] => {
    if (spanWidth(s) <= width) return [s]
    const plain = s.kind === 'link' ? { kind: 'text' as const, text: s.label } : s
    const step = Math.max(1, plain.kind === 'code' ? width - 2 : width)
    const out: Span[] = []
    for (let at = 0; at < plain.text.length; at += step) out.push({ ...plain, text: plain.text.slice(at, at + step) })
    return out
  }

  const lines: Span[][] = [[]]
  let used = 0
  for (const word of words) {
    chunks(word.span).forEach((piece, n) => {
      const w = spanWidth(piece)
      const gap = n === 0 && word.isSpaced && used > 0 ? 1 : 0
      if (used > 0 && used + gap + w > width) {
        lines.push([])
        used = 0
      } else if (gap) {
        lines[lines.length - 1]!.push({ kind: 'text', text: ' ' })
        used += 1
      }
      lines[lines.length - 1]!.push(piece)
      used += w
    })
  }
  return lines
}

// A diff fence written by hand often has no `@@` header, which Code's diff
// format needs: add one counted from the lines, and mark bare lines as context.
export function asHunk(source: string): string {
  if (/^@@ /m.test(source)) return source
  const lines = source.split('\n').filter(l => !/^(---|\+\+\+) /.test(l))
    .map(l => (/^[+\- ]/.test(l) ? l : ` ${l}`))
  const before = lines.filter(l => !l.startsWith('+')).length
  const after = lines.filter(l => !l.startsWith('-')).length
  return [`@@ -1,${before} +1,${after} @@`, ...lines].join('\n')
}
