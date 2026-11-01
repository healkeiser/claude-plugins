// Markdown before and after: the file split into blocks (paragraphs, headings,
// lists, fenced code), the two versions matched block by block, and drawn
// rendered side by side or stacked, each changed block marked in its role.
import type { ClientElements, RenderElement } from 'claude-code'

export type MdKind = 'same' | 'add' | 'del' | 'mod'
export type MdBlock = { kind: MdKind; before: string; after: string }

/** Columns from which the two versions sit side by side; below it they stack. */
export const WIDE_COLUMNS = 90
/** The most block pairs the matcher compares before it calls the middle one change. */
const LCS_CELLS = 4_000_000

/** The blocks of a Markdown text: runs of lines between blank lines, a heading alone, a fenced block whole. */
export function mdBlocks(text: string): string[] {
  const out: string[] = []
  let cur: string[] = []
  let fence = ''
  const flush = () => {
    if (cur.length) out.push(cur.join('\n'))
    cur = []
  }
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const mark = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1] ?? ''
    if (fence) {
      cur.push(line)
      if (mark && mark[0] === fence[0] && mark.length >= fence.length && /^ {0,3}(`+|~+)\s*$/.test(line)) {
        fence = ''
        flush()
      }
    } else if (mark) {
      flush()
      fence = mark
      cur.push(line)
    } else if (!line.trim()) flush()
    else if (/^ {0,3}#{1,6}(\s|$)/.test(line)) {
      flush()
      out.push(line)
    } else cur.push(line)
  }
  flush()
  return out
}

/**
 * The two versions' blocks matched in order (longest common subsequence):
 * a block in both is `same`; in a run of changes between two matches, the
 * removed and added blocks pair up in order as `mod`, the rest `del` or `add`.
 */
export function blockDiff(a: readonly string[], b: readonly string[]): MdBlock[] {
  let s = 0
  while (s < a.length && s < b.length && a[s] === b[s]) s++
  let e = 0
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++
  const ma = a.slice(s, a.length - e)
  const mb = b.slice(s, b.length - e)
  const ops: ['=' | '-' | '+', string][] = []
  const n = ma.length
  const m = mb.length
  if ((n + 1) * (m + 1) > LCS_CELLS) {
    // shortcut: a huge middle is one change, every block removed then added; a finer match would need a linear-space diff.
    ops.push(...ma.map((x): ['-', string] => ['-', x]), ...mb.map((x): ['+', string] => ['+', x]))
  } else {
    const w = m + 1
    const lcs = new Uint32Array((n + 1) * w)
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--) lcs[i * w + j] = ma[i] === mb[j] ? (lcs[(i + 1) * w + j + 1] ?? 0) + 1 : Math.max(lcs[(i + 1) * w + j] ?? 0, lcs[i * w + j + 1] ?? 0)
    let i = 0
    let j = 0
    while (i < n || j < m) {
      if (i < n && j < m && ma[i] === mb[j]) {
        ops.push(['=', ma[i] ?? ''])
        i++
        j++
      } else if (j >= m || (i < n && (lcs[(i + 1) * w + j] ?? 0) >= (lcs[i * w + j + 1] ?? 0))) ops.push(['-', ma[i++] ?? ''])
      else ops.push(['+', mb[j++] ?? ''])
    }
  }
  const out: MdBlock[] = a.slice(0, s).map(x => ({ kind: 'same', before: x, after: x }))
  let dels: string[] = []
  let adds: string[] = []
  const settle = () => {
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
      const before = dels[k]
      const after = adds[k]
      out.push(before !== undefined && after !== undefined ? { kind: 'mod', before, after } : before !== undefined ? { kind: 'del', before, after: '' } : { kind: 'add', before: '', after: after ?? '' })
    }
    dels = []
    adds = []
  }
  for (const [op, x] of ops) {
    if (op === '-') dels.push(x)
    else if (op === '+') adds.push(x)
    else {
      settle()
      out.push({ kind: 'same', before: x, after: x })
    }
  }
  settle()
  out.push(...a.slice(a.length - e).map((x): MdBlock => ({ kind: 'same', before: x, after: x })))
  return out
}

/** How many blocks of each change, for the note above the view. */
export function tally(blocks: readonly MdBlock[]): Record<Exclude<MdKind, 'same'>, number> {
  const t = { add: 0, del: 0, mod: 0 }
  for (const b of blocks) if (b.kind !== 'same') t[b.kind]++
  return t
}

/** Rows a block takes, roughly: its longer side wide, both sides of a change stacked, a blank row after. */
export function blockRows(b: MdBlock, wide: boolean): number {
  const lines = (s: string) => (s ? s.split('\n').length : 0)
  return (wide || b.kind !== 'mod' ? Math.max(lines(b.before), lines(b.after)) : lines(b.before) + lines(b.after) + 1) + 1
}

/** The blocks from `top` that fill about `rows` rows (at least one), and the top clamped. */
export function mdWindow(blocks: readonly MdBlock[], top: number, rows: number, wide: boolean): { blocks: MdBlock[]; top: number } {
  const from = Math.max(0, Math.min(top, blocks.length - 1))
  let used = 0
  let to = from
  while (to < blocks.length && (to === from || used < rows)) used += blockRows(blocks[to++] as MdBlock, wide)
  return { blocks: blocks.slice(from, to), top: from }
}

/** Indices where a run of changed blocks starts: where j and k jump. */
export function changeMarks(blocks: readonly MdBlock[]): number[] {
  return blocks.flatMap((b, i) => (b.kind !== 'same' && blocks[i - 1]?.kind !== b.kind ? [i] : []))
}

// Roles and glyphs per DESIGN.md: added success `+`, removed error `-`, modified warning `~`.
const MARK: Record<MdKind, [string, string]> = { same: ['', ' '], add: ['success', '+'], del: ['error', '-'], mod: ['warning', '~'] }

type El = Pick<ClientElements, 'Box' | 'Text' | 'Markdown'>

/**
 * The view: wide, a `before` and an `after` column with each block's pair on
 * one row; narrow, one column where a change shows its old block (dim) over
 * its new one. A changed block's gutter carries its glyph in its role colour.
 */
export function compareView(el: El, blocks: readonly MdBlock[], wide: boolean, labels: [string, string] = ['before', 'after']): RenderElement {
  const { Box, Text, Markdown } = el
  const side = (key: string, kind: MdKind, text: string, dim = false) => (
    <Box key={key} flexDirection="row" flexGrow={1} flexShrink={1} width={wide ? '50%' : undefined}>
      <Box width={2} flexShrink={0}>
        <Text color={text ? MARK[kind][0] || undefined : undefined}>{text ? MARK[kind][1] : ' '}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
        {text ? <Markdown text={text} dimColor={dim || undefined} /> : null}
      </Box>
    </Box>
  )
  if (wide) {
    return (
      <Box flexDirection="column" rowGap={1}>
        <Box key="labels" flexDirection="row" gap={1}>
          {labels.map((l, i) => (
            <Box key={`label-${i}`} width="50%" flexShrink={1}>
              <Text color="subtle" weight="bold">{`  ${l}`}</Text>
            </Box>
          ))}
        </Box>
        {blocks.map((b, i) => (
          <Box key={`b-${i}`} flexDirection="row" gap={1}>
            {side(`l-${i}`, b.kind === 'add' ? 'same' : b.kind, b.before)}
            {side(`r-${i}`, b.kind === 'del' ? 'same' : b.kind, b.after)}
          </Box>
        ))}
      </Box>
    )
  }
  return (
    <Box flexDirection="column" rowGap={1}>
      {blocks.map((b, i) =>
        b.kind === 'mod' ? (
          <Box key={`b-${i}`} flexDirection="column">
            {side(`o-${i}`, 'mod', b.before, true)}
            {side(`n-${i}`, 'mod', b.after)}
          </Box>
        ) : (
          side(`b-${i}`, b.kind, b.kind === 'del' ? b.before : b.after)
        ),
      )}
    </Box>
  )
}
