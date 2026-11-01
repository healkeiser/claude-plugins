// Mermaid diagrams drawn without Mermaid: flowcharts and sequence diagrams are
// read into a small model, laid out on a grid of terminal cells, then drawn as
// text rows (the terminal) or as SVG (the graphical surfaces) from that grid.
import { cellWidth, clip, graphemes, graphemeWidth } from './style'

export type FlowNode = { id: string; label: string }
export type FlowEdge = { from: string; to: string; label?: string; isDashed: boolean; hasHead: boolean }
export type Step =
  | { kind: 'message'; from: string; to: string; text: string; isDashed: boolean; head: 'arrow' | 'none' | 'cross' }
  | { kind: 'note'; side: 'over' | 'left' | 'right'; over: string[]; text: string }
  | { kind: 'block'; text: string }
export type Diagram =
  | { kind: 'flow'; dir: 'TD' | 'LR'; nodes: FlowNode[]; edges: FlowEdge[] }
  | { kind: 'sequence'; actors: FlowNode[]; steps: Step[] }

// ---------------------------------------------------------------- parsing

/** A diagram model, or why the source cannot be drawn here. */
export function parseMermaid(source: string): Diagram | { error: string } {
  const lines = source.split('\n').map(l => l.replace(/%%.*$/, '').trim()).filter(Boolean)
  const head = lines[0] ?? ''
  const flow = /^(?:graph|flowchart)(?:\s+(TD|TB|LR|RL|BT))?\s*(?:;(.*))?$/i.exec(head)
  if (flow) {
    const dir = (flow[1] ?? 'TD').toUpperCase()
    if (dir === 'RL' || dir === 'BT') return { error: `${dir} flowcharts are not drawn here` }
    return parseFlow([...(flow[2]?.trim() ? [flow[2]] : []), ...lines.slice(1)], dir === 'LR' ? 'LR' : 'TD')
  }
  if (/^sequenceDiagram\b/.test(head)) return parseSequence(lines.slice(1))
  return { error: `${head.split(/\s/)[0] || 'an empty'} diagram is not drawn here` }
}

const SHAPES: readonly [string, string][] = [
  ['(((', ')))'], ['((', '))'], ['([', '])'], ['[[', ']]'], ['[(', ')]'], ['{{', '}}'],
  ['[/', ']'], ['[\\', ']'], ['[', ']'], ['(', ')'], ['{', '}'], ['>', ']'],
]
const ID = /^\s*([\p{L}\p{N}_$][\p{L}\p{N}_$.-]*?)(?=\s*(?:$|&|[[({>]|<?(?:--|==|-\.)|:::))/u
const EDGE = /^\s*(<?)(-{2,}|={2,}|-\.+-|~{3,})([>xo]?)\s*(?:\|([^|]*)\|\s*)?/
// `A -- text --> B` and kin, rewritten as `A -->|text| B`.
const TEXT_EDGE = /(?<![-=.<])(--|==|-\.)\s+([^|>\n]+?)\s+(-{2,}[>xo]?|={2,}[>xo]?|\.-+[>xo]?)(?=\s|[\p{L}\p{N}_$])/gu

const cleanLabel = (s: string) =>
  s.trim().replace(/^"(.*)"$/s, '$1').replace(/^`(.*)`$/s, '$1').replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim()

function parseFlow(lines: string[], dir: 'TD' | 'LR'): Diagram | { error: string } {
  const nodes = new Map<string, FlowNode>()
  const edges: FlowEdge[] = []
  const node = (id: string, label?: string) => {
    const known = nodes.get(id)
    if (!known) nodes.set(id, { id, label: label ?? id })
    else if (label !== undefined) known.label = label
  }
  const statements = lines.flatMap(l => l.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/)).map(s => s.trim()).filter(Boolean)
  for (const raw of statements) {
    if (/^(subgraph|end|classDef|class|style|linkStyle|click|direction|accTitle|accDescr)\b/.test(raw)) continue
    let rest = raw.replace(TEXT_EDGE, (_, a: string, text: string, c: string) => `${a === '-.' ? `-.${c.slice(1)}` : c}|${text}|`)
    // One node: its id, then its shape and label if it has one.
    const readNode = (): string | undefined => {
      const id = ID.exec(rest)
      if (!id) return undefined
      rest = rest.slice(id[0].length)
      const shape = SHAPES.find(([open]) => rest.startsWith(open))
      let label: string | undefined
      if (shape) {
        const end = rest.indexOf(shape[1], shape[0].length)
        if (end < 0) return undefined
        label = cleanLabel(rest.slice(shape[0].length, end).replace(/[/\\]$/, ''))
        rest = rest.slice(end + shape[1].length)
      }
      rest = rest.replace(/^:::[\w-]+/, '')
      node(id[1]!, label)
      return id[1]!
    }
    const readGroup = (): string[] | undefined => {
      const first = readNode()
      if (!first) return undefined
      const group = [first]
      while (/^\s*&/.test(rest)) {
        rest = rest.replace(/^\s*&/, '')
        const next = readNode()
        if (!next) return undefined
        group.push(next)
      }
      return group
    }
    let from = readGroup()
    if (!from) return { error: `cannot read "${clip(raw, 40)}"` }
    for (;;) {
      const edge = EDGE.exec(rest)
      if (!edge) break
      rest = rest.slice(edge[0].length)
      const to = readGroup()
      if (!to) return { error: `cannot read "${clip(raw, 40)}"` }
      if (!edge[2]!.startsWith('~')) {
        const label = edge[4] ? cleanLabel(edge[4]) : undefined
        for (const f of from) for (const t of to) {
          edges.push({ from: f, to: t, ...(label ? { label } : {}), isDashed: edge[2]!.includes('.'), hasHead: edge[3] !== '' })
        }
      }
      from = to
    }
    if (rest.trim()) return { error: `cannot read "${clip(raw, 40)}"` }
  }
  if (!nodes.size) return { error: 'the flowchart has no nodes' }
  return { kind: 'flow', dir, nodes: [...nodes.values()], edges }
}

const MESSAGE = /^(.+?)\s*(--?)(>>|>|x|\))\s*[+-]?\s*(.+?)\s*:\s*(.*)$/

function parseSequence(lines: string[]): Diagram | { error: string } {
  const actors = new Map<string, FlowNode>()
  const actor = (id: string, label?: string) => {
    if (!actors.has(id)) actors.set(id, { id, label: label ?? id })
    else if (label) actors.get(id)!.label = label
  }
  const steps: Step[] = []
  for (const line of lines) {
    const declared = /^(?:participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/i.exec(line)
    if (declared) {
      actor(declared[1]!, declared[2] && cleanLabel(declared[2]))
      continue
    }
    if (/^(autonumber|activate|deactivate|title|box|create|destroy|links?|properties|details)\b/i.test(line)) continue
    const block = /^(loop|alt|else|opt|par|and|critical|break|rect)\b\s*(.*)$/i.exec(line)
    if (block) {
      steps.push({ kind: 'block', text: block[1]!.toLowerCase() === 'rect' ? '' : `${block[1]!.toLowerCase()} ${block[2]}`.trim() })
      continue
    }
    if (/^end$/i.test(line)) {
      steps.push({ kind: 'block', text: '' })
      continue
    }
    const note = /^note\s+(over|left of|right of)\s+([^:]+):\s*(.*)$/i.exec(line)
    if (note) {
      const over = note[2]!.split(',').map(s => s.trim())
      over.forEach(id => actor(id))
      const side = note[1]!.toLowerCase()
      steps.push({ kind: 'note', side: side === 'over' ? 'over' : side === 'left of' ? 'left' : 'right', over, text: cleanLabel(note[3]!) })
      continue
    }
    const m = MESSAGE.exec(line)
    if (!m) return { error: `cannot read "${clip(line, 40)}"` }
    actor(m[1]!)
    actor(m[4]!)
    steps.push({
      kind: 'message', from: m[1]!, to: m[4]!, text: cleanLabel(m[5]!), isDashed: m[2] === '--',
      head: m[3] === 'x' ? 'cross' : m[3] === '>' ? 'none' : 'arrow',
    })
  }
  if (!actors.size) return { error: 'the sequence diagram has no participants' }
  return { kind: 'sequence', actors: [...actors.values()], steps }
}

// ---------------------------------------------------------------- the grid

const U = 1
const D = 2
const L = 4
const R = 8
const LINE: Record<number, string> = {
  [U]: '│', [D]: '│', [U | D]: '│', [L]: '─', [R]: '─', [L | R]: '─',
  [D | R]: '╭', [D | L]: '╮', [U | R]: '╰', [U | L]: '╯',
  [U | D | R]: '├', [U | D | L]: '┤', [L | R | D]: '┬', [L | R | U]: '┴', [U | D | L | R]: '┼',
}

/** Cells of line directions, box glyphs and text: what both drawings read. */
export class Grid {
  readonly mask: number[]
  readonly dash: boolean[]
  readonly chars: (string | undefined)[]
  readonly boxes: { x: number; y: number; w: number; label: string }[] = []
  readonly texts: { x: number; y: number; text: string }[] = []
  readonly heads: { x: number; y: number; dir: 'u' | 'd' | 'l' | 'r' | 'x' }[] = []

  constructor(readonly w: number, readonly h: number) {
    this.mask = Array(w * h).fill(0)
    this.dash = Array(w * h).fill(false)
    this.chars = Array(w * h).fill(undefined)
  }

  private at(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? y * this.w + x : -1
  }

  /** An orthogonal line through the points, joined where it meets others. */
  path(points: readonly [number, number][], isDashed = false) {
    for (let k = 1; k < points.length; k++) {
      let [x, y] = points[k - 1]!
      const [tx, ty] = points[k]!
      while (x !== tx || y !== ty) {
        const [dx, dy] = x !== tx ? [Math.sign(tx - x), 0] : [0, Math.sign(ty - y)]
        const here = this.at(x, y)
        const there = this.at(x + dx, y + dy)
        if (here >= 0) this.mask[here]! |= dx > 0 ? R : dx < 0 ? L : dy > 0 ? D : U
        if (there >= 0) this.mask[there]! |= dx > 0 ? L : dx < 0 ? R : dy > 0 ? U : D
        if (isDashed && here >= 0 && there >= 0) {
          this.dash[here] = true
          this.dash[there] = true
        }
        x += dx
        y += dy
      }
    }
  }

  put(x: number, y: number, text: string) {
    let cx = x
    for (const g of graphemes(text)) {
      const i = this.at(cx, y)
      if (i >= 0) this.chars[i] = g
      for (let k = 1; k < graphemeWidth(g); k++) if (this.at(cx + k, y) >= 0) this.chars[this.at(cx + k, y)] = ''
      cx += graphemeWidth(g)
    }
  }

  text(x: number, y: number, text: string) {
    this.put(x, y, text)
    this.texts.push({ x, y, text })
  }

  /** Whether `width` cells from x hold nothing yet. */
  isFree(x: number, y: number, width: number) {
    for (let k = 0; k < width; k++) {
      const i = this.at(x + k, y)
      if (i < 0 || this.chars[i] !== undefined || this.mask[i]) return false
    }
    return true
  }

  box(x: number, y: number, w: number, label: string) {
    this.put(x, y, `╭${'─'.repeat(w - 2)}╮`)
    this.put(x, y + 1, `│ ${label}${' '.repeat(Math.max(0, w - 3 - cellWidth(label)))}│`)
    this.put(x, y + 2, `╰${'─'.repeat(w - 2)}╯`)
    this.boxes.push({ x, y, w, label })
  }

  head(x: number, y: number, dir: 'u' | 'd' | 'l' | 'r' | 'x') {
    this.put(x, y, { u: '▴', d: '▾', l: '◂', r: '▸', x: '✕' }[dir])
    this.heads.push({ x, y, dir })
  }

  /** The grid as text rows, trailing spaces dropped. */
  rows(): string[] {
    return Array.from({ length: this.h }, (_, y) => {
      let row = ''
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x
        const ch = this.chars[i]
        const m = this.mask[i]!
        row += ch ?? (m ? (this.dash[i] && (m === (L | R) || m === (U | D)) ? '·' : LINE[m]!) : ' ')
      }
      return row.trimEnd()
    })
  }
}

// ---------------------------------------------------------------- layout

const LABEL_MAX = 28
const EDGE_LABEL_MAX = 18

type Item = { id: string; isDummy: boolean; w: number }
type Chain = { items: string[]; edge: FlowEdge; isBack: boolean }

// Ranks by longest path after turning back edges round, then a chain of
// one-cell dummies for every rank an edge crosses, so each segment joins
// neighbouring ranks and no line crosses a box.
function rank(d: Extract<Diagram, { kind: 'flow' }>, labelOf: (n: FlowNode) => string) {
  const ids = d.nodes.map(n => n.id)
  const out = new Map<string, string[]>(ids.map(id => [id, []]))
  const edges = d.edges.filter(e => e.from !== e.to)
  edges.forEach(e => out.get(e.from)!.push(e.to))
  const state = new Map<string, 1 | 2>()
  const back = new Set<FlowEdge>()
  const visit = (id: string) => {
    state.set(id, 1)
    for (const e of edges) {
      if (e.from !== id) continue
      if (state.get(e.to) === 1) back.add(e)
      else if (!state.has(e.to)) visit(e.to)
    }
    state.set(id, 2)
  }
  ids.forEach(id => state.has(id) || visit(id))
  const flows = edges.map(e => (back.has(e) ? { a: e.to, b: e.from, e } : { a: e.from, b: e.to, e }))
  const r = new Map<string, number>(ids.map(id => [id, 0]))
  for (let pass = 0; pass < ids.length; pass++) {
    let moved = false
    for (const f of flows) {
      if (r.get(f.b)! <= r.get(f.a)!) {
        r.set(f.b, r.get(f.a)! + 1)
        moved = true
      }
    }
    if (!moved) break
  }
  const items = new Map<string, Item>(d.nodes.map(n => [n.id, { id: n.id, isDummy: false, w: cellWidth(labelOf(n)) + 4 }]))
  const layers: string[][] = Array.from({ length: Math.max(...r.values()) + 1 }, () => [])
  ids.forEach(id => layers[r.get(id)!]!.push(id))
  const chains: Chain[] = flows.map((f, k) => {
    const chain = [f.a]
    for (let at = r.get(f.a)! + 1; at < r.get(f.b)!; at++) {
      const id = `~${k}.${at}`
      items.set(id, { id, isDummy: true, w: 1 })
      layers[at]!.push(id)
      chain.push(id)
    }
    chain.push(f.b)
    return { items: chain, edge: f.e, isBack: back.has(f.e) }
  })
  // Order each rank by where its parents sit, so lines cross less.
  const pos = new Map<string, number>()
  layers.forEach((layer, k) => {
    if (k > 0) {
      const parents = (id: string) => chains.flatMap(c => c.items.flatMap((x, j) => (c.items[j + 1] === id ? [pos.get(x)!] : [])))
      const score = (id: string) => {
        const p = parents(id)
        return p.length ? p.reduce((a, b) => a + b, 0) / p.length : Infinity
      }
      const first = new Map(layer.map((id, j) => [id, j]))
      layer.sort((a, b) => score(a) - score(b) || first.get(a)! - first.get(b)!)
    }
    layer.forEach((id, j) => pos.set(id, j))
  })
  return { layers, items, chains }
}

function drawFlow(d: Extract<Diagram, { kind: 'flow' }>, room: number): Grid | null {
  const labels = new Map(d.nodes.map(n => [n.id, clip(n.label, Math.min(LABEL_MAX, Math.max(4, room - 4)))]))
  const labelOf = (n: FlowNode) => labels.get(n.id)!
  const { layers, items, chains } = rank(d, labelOf)
  const edgeLabel = (c: Chain) => (c.edge.label ? clip(c.edge.label, EDGE_LABEL_MAX) : '')
  const xy = new Map<string, { x: number; y: number }>()

  if (d.dir === 'TD') {
    const widths = layers.map(l => l.reduce((n, id) => n + items.get(id)!.w, 0) + 2 * (l.length - 1))
    const W = Math.max(...widths)
    if (W > room) return null
    const g = new Grid(W, layers.length * 6 - 3)
    layers.forEach((layer, k) => {
      let x = Math.floor((W - widths[k]!) / 2)
      for (const id of layer) {
        xy.set(id, { x, y: k * 6 })
        x += items.get(id)!.w + 2
      }
    })
    const cx = (id: string) => xy.get(id)!.x + Math.floor(items.get(id)!.w / 2)
    for (const id of items.keys()) {
      const { x, y } = xy.get(id)!
      if (items.get(id)!.isDummy) g.path([[x, y], [x, y + 2]])
      else g.box(x, y, items.get(id)!.w, labels.get(id)!)
    }
    for (const c of chains) {
      c.items.slice(1).forEach((b, j) => {
        const a = c.items[j]!
        const ya = xy.get(a)!.y + 2
        g.path([[cx(a), ya], [cx(a), ya + 2], [cx(b), ya + 2], [cx(b), ya + 4]], c.edge.isDashed)
        if (!items.get(a)!.isDummy) g.put(cx(a), ya, '┬')
      })
      if (c.edge.hasHead) {
        if (c.isBack) g.head(cx(c.items[0]!), xy.get(c.items[0]!)!.y + 3, 'u')
        else g.head(cx(c.items.at(-1)!), xy.get(c.items.at(-1)!)!.y - 1, 'd')
      }
    }
    for (const c of chains) {
      const text = edgeLabel(c)
      if (!text) continue
      const end = c.isBack ? c.items[0]! : c.items.at(-1)!
      const y = c.isBack ? xy.get(end)!.y + 3 : xy.get(end)!.y - 1
      const spots = [cx(end) + 2, cx(end) - 2 - cellWidth(text)]
      const x = spots.find(s => g.isFree(s - 1, y, cellWidth(text) + 2))
      if (x !== undefined) g.text(x, y, text)
    }
    return g
  }

  // LR: ranks are columns, each gap wide enough for the labels that end in it.
  const colW = layers.map(l => Math.max(...l.map(id => items.get(id)!.w)))
  const gaps = layers.map((_, k) =>
    Math.max(5, ...chains.filter(c => {
      const end = c.isBack ? c.items[1] : c.items.at(-1)
      return end && layers[k + 1]?.includes(end) && edgeLabel(c)
    }).map(c => cellWidth(edgeLabel(c)) + 5)))
  const X: number[] = []
  layers.forEach((_, k) => X.push(k === 0 ? 0 : X[k - 1]! + colW[k - 1]! + gaps[k - 1]!))
  const W = X.at(-1)! + colW.at(-1)!
  if (W > room) return null
  const heights = layers.map(l => l.reduce((n, id) => n + (items.get(id)!.isDummy ? 1 : 3), 0) + (l.length - 1))
  const H = Math.max(...heights)
  const g = new Grid(W, H)
  layers.forEach((layer, k) => {
    let y = Math.floor((H - heights[k]!) / 2)
    for (const id of layer) {
      xy.set(id, { x: X[k]!, y })
      y += (items.get(id)!.isDummy ? 1 : 3) + 1
    }
  })
  const cy = (id: string) => xy.get(id)!.y + (items.get(id)!.isDummy ? 0 : 1)
  const col = (id: string) => layers.findIndex(l => l.includes(id))
  for (const id of items.keys()) {
    const { x, y } = xy.get(id)!
    if (items.get(id)!.isDummy) g.path([[x, y], [x + colW[col(id)]! - 1, y]])
    else g.box(x, y, items.get(id)!.w, labels.get(id)!)
  }
  for (const c of chains) {
    const text = edgeLabel(c)
    const last = c.items.length - 2
    c.items.slice(1).forEach((b, j) => {
      const a = c.items[j]!
      const k = col(a)
      const sx = items.get(a)!.isDummy ? X[k]! + colW[k]! - 1 : X[k]! + items.get(a)!.w - 1
      const m = X[k]! + colW[k]! + 1
      const isFlat = cy(a) === cy(b)
      g.path([[sx, cy(a)], [m, cy(a)], [m, cy(b)], [X[k + 1]!, cy(b)]], c.edge.isDashed)
      if (!items.get(a)!.isDummy) g.put(sx, cy(a), '├')
      // The label centred on the run of line beside its arrowhead.
      if (text && j === (c.isBack ? 0 : last)) {
        const [lo, hi, y] = c.isBack ? [sx + 2, isFlat ? X[k + 1]! - 1 : m - 1, cy(a)] : [isFlat ? sx + 1 : m + 1, X[k + 1]! - 2, cy(b)]
        const room = hi - lo + 1
        if (cellWidth(text) <= room) g.text(lo + Math.floor((room - cellWidth(text)) / 2), y, text)
      }
    })
    if (c.edge.hasHead) {
      const first = c.items[0]!
      const end = c.items.at(-1)!
      if (c.isBack) g.head(X[col(first)]! + items.get(first)!.w, cy(first), 'l')
      else g.head(X[col(end)]! - 1, cy(end), 'r')
    }
  }
  return g
}

function drawSequence(d: Extract<Diagram, { kind: 'sequence' }>, room: number): Grid | null {
  const n = d.actors.length
  const labels = d.actors.map(a => clip(a.label, Math.min(LABEL_MAX, Math.max(4, room - 4))))
  const index = new Map(d.actors.map((a, k) => [a.id, k]))
  const boxW = labels.map(l => cellWidth(l) + 4)
  const texts = d.steps.map(s => (s.kind === 'block' ? s.text : clip(s.text, Math.max(4, room - 6))))
  // Distance from each lifeline to the next, widened until every label fits.
  const gap = Array.from({ length: n }, (_, k) => (k < n - 1 ? Math.ceil(boxW[k]! / 2) + Math.ceil(boxW[k + 1]! / 2) + 1 : 0))
  let tail = Math.ceil(boxW[n - 1]! / 2)
  d.steps.forEach((s, k) => {
    const need = cellWidth(texts[k]!) + 4
    if (s.kind === 'message') {
      const [a, b] = [index.get(s.from)!, index.get(s.to)!].sort((p, q) => p - q) as [number, number]
      if (a === b) {
        if (a === n - 1) tail = Math.max(tail, need + 2)
        else gap[a] = Math.max(gap[a]!, need + 2)
      } else {
        const span = gap.slice(a, b).reduce((p, q) => p + q, 0)
        if (span < need) gap[b - 1]! += need - span
      }
    } else if (s.kind === 'note' && s.over.length === 1 && s.side !== 'left') {
      const a = index.get(s.over[0]!)!
      if (a === n - 1) tail = Math.max(tail, need)
      else gap[a] = Math.max(gap[a]!, need)
    }
  })
  const X = [Math.floor(boxW[0]! / 2)]
  for (let k = 1; k < n; k++) X.push(X[k - 1]! + gap[k - 1]!)
  const W = X[n - 1]! + tail
  if (W > room) return null
  const H = 3 + d.steps.reduce((h, s) => h + (s.kind === 'message' ? (s.from === s.to ? 3 : 2) : 1), 0) + 1
  const g = new Grid(W, H)
  d.actors.forEach((_, k) => {
    g.path([[X[k]!, 2], [X[k]!, H - 1]])
    g.box(X[k]! - Math.floor(boxW[k]! / 2), 0, boxW[k]!, labels[k]!)
    g.put(X[k]!, 2, '┬')
  })
  let y = 3
  d.steps.forEach((s, k) => {
    const text = texts[k]!
    if (s.kind === 'block') {
      g.path([[0, y], [W - 1, y]])
      if (text) g.text(0, y, `${text} `)
      y += 1
    } else if (s.kind === 'note') {
      const at = s.over.map(id => X[index.get(id)!]!)
      const mid = Math.round((Math.min(...at) + Math.max(...at)) / 2)
      const x = s.side === 'right' ? mid + 2 : s.side === 'left' ? mid - 2 - cellWidth(text) : s.over.length > 1 ? mid - Math.floor(cellWidth(text) / 2) : mid + 2
      g.text(Math.max(0, x), y, text)
      y += 1
    } else if (s.from === s.to) {
      const x = X[index.get(s.from)!]!
      g.text(x + 2, y, text)
      g.path([[x, y + 1], [x + 3, y + 1], [x + 3, y + 2], [x, y + 2]], s.isDashed)
      if (s.head !== 'none') g.head(x + 1, y + 2, s.head === 'cross' ? 'x' : 'l')
      y += 3
    } else {
      const a = X[index.get(s.from)!]!
      const b = X[index.get(s.to)!]!
      const left = Math.min(a, b)
      g.text(left + 1 + Math.max(0, Math.floor((Math.abs(b - a) - 1 - cellWidth(text)) / 2)), y, text)
      g.path([[a, y + 1], [b, y + 1]], s.isDashed)
      if (s.head !== 'none') g.head(b > a ? b - 1 : b + 1, y + 1, s.head === 'cross' ? 'x' : b > a ? 'r' : 'l')
      y += 2
    }
  })
  return g
}

/** The diagram on a grid at most `room` cells wide, or null when it cannot fit. */
export function layout(d: Diagram, room: number): Grid | null {
  return d.kind === 'flow' ? drawFlow(d, room) : drawSequence(d, room)
}

// ---------------------------------------------------------------- SVG

// Mid-tones that read on light and dark (DESIGN.md: each role's SVG hex).
const SVG_ACCENT = '#d97757'
const SVG_CHROME = '#9ca3af'
const SVG_TEXT = '#6b7280'
const CW = 8
const CH = 18

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The grid as an SVG picture: rounded boxes, lines and arrowheads, the labels in a monospace face. */
export function toSvg(g: Grid): string {
  const c = (x: number, y: number) => [(x + 0.5) * CW, (y + 0.5) * CH] as const
  const solid: string[] = []
  const dashed: string[] = []
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const i = y * g.w + x
      const m = g.mask[i]!
      const [px, py] = c(x, y)
      if (m & R) (g.dash[i] && g.dash[i + 1] ? dashed : solid).push(`M${px} ${py}h${CW}`)
      if (m & D) (g.dash[i] && g.dash[i + g.w] ? dashed : solid).push(`M${px} ${py}v${CH}`)
    }
  }
  const heads = g.heads.map(({ x, y, dir }) => {
    const [px, py] = c(x, y)
    if (dir === 'x') return `<path d="M${px - 4} ${py - 4}l8 8M${px + 4} ${py - 4}l-8 8" stroke="${SVG_CHROME}" stroke-width="1.5"/>`
    const tip = { u: [px, py - CH], d: [px, py + CH], l: [px - CW, py], r: [px + CW, py] }[dir]
    const side = dir === 'u' || dir === 'd' ? [[px - 4, py], [px + 4, py]] : [[px, py - 4], [px, py + 4]]
    return `<polygon points="${tip.join(',')} ${side.map(p => p.join(',')).join(' ')}" fill="${SVG_CHROME}"/>`
  })
  const boxes = g.boxes.map(b => {
    const [x, y] = c(b.x, b.y)
    const w = (b.w - 1) * CW
    return `<rect x="${x}" y="${y}" width="${w}" height="${2 * CH}" rx="6" fill="${SVG_ACCENT}" fill-opacity="0.08" stroke="${SVG_ACCENT}" stroke-width="1.5"/>` +
      `<text x="${x + w / 2}" y="${y + CH}" text-anchor="middle" dominant-baseline="central" fill="${SVG_TEXT}">${esc(b.label)}</text>`
  })
  const texts = g.texts.map(t => `<text x="${t.x * CW}" y="${(t.y + 0.5) * CH}" dominant-baseline="central" fill="${SVG_TEXT}">${esc(t.text)}</text>`)
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${g.w * CW}" height="${g.h * CH}" viewBox="0 0 ${g.w * CW} ${g.h * CH}" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="12">`,
    solid.length ? `<path d="${solid.join('')}" stroke="${SVG_CHROME}" stroke-width="1.5" fill="none"/>` : '',
    dashed.length ? `<path d="${dashed.join('')}" stroke="${SVG_CHROME}" stroke-width="1.5" stroke-dasharray="3 3" fill="none"/>` : '',
    ...boxes, ...heads, ...texts,
    '</svg>',
  ].join('')
}

/** A reply cut at its mermaid fences: the text between as written, each fence's source on its own. */
export function splitMermaid(text: string): ({ kind: 'text'; text: string } | { kind: 'mermaid'; source: string; fence: string })[] {
  const out: ({ kind: 'text'; text: string } | { kind: 'mermaid'; source: string; fence: string })[] = []
  const lines = text.split('\n')
  let prose: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const open = /^[ \t]*(`{3,}|~{3,})\s*mermaid\s*$/.exec(lines[i]!)
    if (!open) {
      prose.push(lines[i]!)
      continue
    }
    let j = i + 1
    while (j < lines.length && !lines[j]!.trimStart().startsWith(open[1]!)) j++
    if (prose.join('').trim()) out.push({ kind: 'text', text: prose.join('\n') })
    prose = []
    out.push({ kind: 'mermaid', source: lines.slice(i + 1, j).join('\n'), fence: lines.slice(i, j + 1).join('\n') })
    i = j
  }
  if (prose.join('').trim()) out.push({ kind: 'text', text: prose.join('\n') })
  return out
}
