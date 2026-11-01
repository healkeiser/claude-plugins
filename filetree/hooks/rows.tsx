import type { ClientModule, RenderElement } from 'claude-code'

import { compareView, type MdBlock } from './compare'
import { FRAME_MS, SPINNER, sweep } from './style'

export type Seg = { t: string; c?: string; b?: boolean; s?: boolean; i?: boolean; sh?: string; dim?: boolean; one?: boolean; spin?: boolean; bg?: string; tab?: string }
export type RowSpec = { id: string; left: Seg[]; right: Seg[] }
export type RowsProps = {
  rows: RowSpec[]
  active: string
  activeBg: string
  hoverBg: string
  tones: Record<string, { bright: string[]; dim: string[] }>
  /** Motion off or Reduce motion on: no shimmer, no spinner, no timer. */
  still?: boolean
  spinner?: string[]
  pointer?: boolean
  bar?: { pos: number; size: number; thumb: string; track: string }
  preview?: { text: string; path: string; startLine: number; markdown: boolean; segments?: { title: string; source: string }[]; titleColor?: string; rows?: number; compare?: { blocks: MdBlock[]; wide: boolean; labels: [string, string] } }
}
type Local = { hover: number; phase: number; drag: boolean; ref: { stop?: () => void; unpoint?: () => void } }

const TREE_BUDGET = 70_000
const MAX_ROWS = 1_500
// The scrollbar draws its thumb alone, no track line: a mouse selection of a
// preview or a path then picks up a blank column, not a border.
const THUMB = '┃'

// style.ts `sweep`: a soft band crossing the name, so a name glows and fades rather than blinks.
const shimmer = (i: number, phase: number, len: number, palette: string[]): string =>
  palette[sweep(i, phase, len)] ?? palette[0] ?? '#f97316'

const Rows: ClientModule<RowsProps, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  let state = surface.state
  if (state === undefined) {
    state = { hover: -1, phase: 0, drag: false, ref: {} }
    surface.setState(state)
  }
  let visible = props.rows.length
  const lit = !props.still && props.rows.some(r => r.left.some(s => s.sh || s.spin) || r.right.some(s => s.sh || s.spin))
  if (lit && !state.ref.stop) {
    state.ref.stop = surface.every(FRAME_MS, () => {
      const cur = surface.state
      if (cur) surface.setState({ ...cur, phase: cur.phase + 1 })
    })
  } else if (!lit && state.ref.stop) {
    state.ref.stop()
    state.ref.stop = undefined
  }
  if (props.pointer === false) {
    state.ref.unpoint?.()
    state.ref.unpoint = undefined
  } else state.ref.unpoint = surface.onPointer(e => {
    const cur = surface.state ?? state
    if (props.preview && (e.type === 'enter' || e.type === 'leave')) surface.post({ over: e.type === 'enter' })
    const span = Math.max(1, (props.preview?.rows ?? props.rows.length) - 1)
    const onBar = Boolean(props.bar) && e.x >= surface.columns - 1
    if (props.bar && (cur.drag || (onBar && e.type === 'down' && (e.button ?? 'left') === 'left'))) {
      if (e.type === 'up' || e.type === 'leave') {
        surface.setState({ ...cur, drag: false })
        return
      }
      if (e.type === 'down' || e.type === 'move') {
        if (!cur.drag) surface.setState({ ...cur, drag: true, hover: -1 })
        surface.post({ scrollTo: Math.max(0, Math.min(1, e.y / span)) })
        return
      }
    }
    if (e.type === 'leave' || e.y < 0 || e.y >= visible) {
      if (cur.hover !== -1) surface.setState({ ...cur, hover: -1 })
      return
    }
    if (e.type === 'move' && !e.button && cur.hover !== e.y) surface.setState({ ...cur, hover: e.y })
    const row = props.rows[e.y]
    if (e.type === 'down' && e.button === 'right' && row?.id) {
      surface.post({ copy: row.id, shift: Boolean(e.shift) })
      return
    }
    if (e.type !== 'down' || (e.button ?? 'left') !== 'left' || !row) return
    let x = 0
    for (const seg of row.left) {
      const w = [...seg.t].length
      if (seg.tab && e.x >= x && e.x < x + w) {
        surface.post({ tab: seg.tab })
        return
      }
      x += w
    }
    if (row.id) surface.post({ press: row.id, ctrl: Boolean(e.ctrl), shift: Boolean(e.shift) })
  })
  surface.onKey(e => surface.post({ key: e.key, ctrl: Boolean(e.ctrl), shift: Boolean(e.shift) }))
  if (props.preview) {
    const { Markdown, Code, Box: Column, Text: Title } = surface.elements
    const p = props.preview
    if (p.segments) {
      return (
        <Column flexDirection="column">
          {p.segments.map((g, i) => (
            <Column key={`seg-${i}`} flexDirection="column">
              {g.title ? (
                // A labelled dim rule, as gloss heads a code block: `─ path ───`.
                <Title>
                  <Title color="subtle">{'─ '}</Title>
                  <Title weight="bold" color={p.titleColor || undefined}>{g.title}</Title>
                  <Title color="subtle">{` ${'─'.repeat(Math.max(1, surface.columns - [...g.title].length - 3))}`}</Title>
                </Title>
              ) : null}
              {g.source ? <Code source={g.source} path={g.title || p.path} format="diff" wrap="truncate-end" /> : null}
            </Column>
          ))}
        </Column>
      )
    }
    const body = p.compare ? compareView(surface.elements, p.compare.blocks, p.compare.wide, p.compare.labels) : p.markdown ? <Markdown text={p.text} /> : <Code source={p.text} path={p.path} startLine={p.startLine} wrap="truncate-end" />
    if (!p.rows) return body
    const bar = props.bar
    return (
      <Column flexDirection="row" height={p.rows} overflow="hidden">
        <Column flexGrow={1} flexShrink={1} flexDirection="column" overflow="hidden">
          <Column flexShrink={0} flexDirection="column">
            {body}
          </Column>
        </Column>
        {bar ? (
          <Column flexDirection="column" flexShrink={0}>
            {Array.from({ length: p.rows }, (_, i) => {
              const on = i >= bar.pos && i < bar.pos + bar.size
              return <Title color={on ? bar.thumb || undefined : undefined}>{on ? THUMB : ' '}</Title>
            })}
          </Column>
        ) : null}
      </Column>
    )
  }
  const frames = props.spinner?.length ? props.spinner : SPINNER
  const draw = (s: Seg) => {
    if (s.spin) {
      return (
        <Text color={s.c} weight={s.b ? 'bold' : undefined}>
          {s.t + (props.still ? '●' : (frames[state.phase % frames.length] ?? ''))}
        </Text>
      )
    }
    const palette = s.sh ? (s.dim ? props.tones[s.sh]?.dim : props.tones[s.sh]?.bright) : undefined
    if (!palette) {
      return (
        <Text color={s.c || undefined} dimColor={s.c === ''} backgroundColor={s.bg} weight={s.b ? 'bold' : undefined} strikethrough={s.s} italic={s.i}>
          {s.t}
        </Text>
      )
    }
    // Stilled, a shimmer holds its solid colour.
    if (props.still) {
      return (
        <Text color={palette[0]} weight={s.b ? 'bold' : undefined}>
          {s.t}
        </Text>
      )
    }
    if (s.one) {
      return (
        <Text color={shimmer(-1, state.phase, s.t.length, palette)}>
          {s.t}
        </Text>
      )
    }
    const chars = [...s.t]
    return (
      <Text weight={s.b ? 'bold' : undefined}>
        {chars.map((ch, i) => (
          <Text color={shimmer(i, state.phase, chars.length, palette)}>{ch}</Text>
        ))}
      </Text>
    )
  }
  const rowEl = (r: RowSpec, i: number) => (
    <Box
      flexDirection="row"
      height={1}
      overflow="hidden"
      backgroundColor={r.id && r.id === props.active ? props.activeBg : r.id && i === state.hover ? props.hoverBg || undefined : undefined}
    >
      <Box flexShrink={1} overflow="hidden">
        {r.left.map(draw)}
      </Box>
      <Box flexGrow={1} />
      {r.right.map(draw)}
      {props.bar && (
        <Text color={i >= props.bar.pos && i < props.bar.pos + props.bar.size ? props.bar.thumb || undefined : undefined}>
          {i >= props.bar.pos && i < props.bar.pos + props.bar.size ? THUMB : ' '}
        </Text>
      )}
    </Box>
  )
  const drawn: RenderElement[] = []
  let size = 0
  for (const [i, spec] of props.rows.entries()) {
    const el = rowEl(spec, i)
    let cost = 1_000
    try {
      cost = JSON.stringify(el).length
    } catch {}
    if (size + cost > TREE_BUDGET || drawn.length >= MAX_ROWS) {
      visible = i
      drawn.push(<Text dimColor>{`  … ${props.rows.length - i} more rows, collapse folders or use search`}</Text>)
      break
    }
    size += cost
    drawn.push(el)
  }
  return <Box flexDirection="column">{drawn}</Box>
}

export default Rows
