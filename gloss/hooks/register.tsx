import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { FoldId } from '../types'
import { asHunk, parse, spanWidth, wrapSpans } from './parse'
import type { QuoteLine } from './parse'
import type { CalloutType, Line, Part, Span } from './parse'
import { GLYPH, ROLE, asciiTree, cellWidth, isAsciiGlyphs, remember } from './style'

// Theme keys, not hex (see style.ts): they follow the person's theme, `auto`
// included, which `$.config.list` only reports as "auto". The chip is the
// engine's own prompt tint behind the default text colour.
// The first list level in the accent, deeper ones in chrome: the glyph says the depth.
const BULLET_COLORS = [ROLE.accent, ROLE.chrome, ROLE.chrome] as const
const FOLD_OVER = 20
const FOLD_TO = 12

const CALLOUT: Record<CalloutType, { color: string; title: string }> = {
  note: { color: ROLE.info, title: `${GLYPH.info} Note` },
  tip: { color: ROLE.success, title: `${GLYPH.ok} Tip` },
  important: { color: ROLE.accent, title: `${GLYPH.key} Important` },
  warning: { color: ROLE.warning, title: `${GLYPH.warn} Warning` },
  caution: { color: ROLE.error, title: `${GLYPH.fail} Caution` },
}

// Code blocks the person unfolded, by message id and block index.
const expanded = atom({ plugin: 'gloss', key: 'expanded' } as const, [] as readonly FoldId[])

const widthOf = (list: Span[]) => list.reduce((n, s) => n + spanWidth(s), 0)

type Indexed = Part & { i: number }

// Pairs each heading with the part under it, so the two draw without a gap.
function sections(parts: Part[]): [Indexed | undefined, Indexed | undefined][] {
  const out: [Indexed | undefined, Indexed | undefined][] = []
  const list = parts.map((p, i) => ({ ...p, i }) as Indexed)
  for (let k = 0; k < list.length; k++) {
    const p = list[k]!
    if (p.kind !== 'heading') out.push([undefined, p])
    else if (list[k + 1] && list[k + 1]!.kind !== 'heading') out.push([p, list[++k]])
    else out.push([p, undefined])
  }
  return out
}

export const register: Register = (on, options) => {
  const isAscii = isAsciiGlyphs(options?.glyphs)
  // Each message's last parse: a fold toggle or resize redraws every message,
  // and only a message still streaming has new text to parse.
  const parsed = new Map<string, { text: string; parts: Part[] }>()

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    // Desktop, VS Code and mobile draw replies well already (proportional type,
    // their own code blocks and tables): gloss leaves them native. DESIGN.md.
    if (e.surface !== 'terminal') return next(e)
    const cached = parsed.get(e.requestId)
    const parts = cached?.text === e.props.text ? cached.parts : parse(e.props.text)
    // Bounded: a long or resumed session must not keep every reply's parse.
    remember(parsed, e.requestId, { text: e.props.text, parts })
    const isPlain = parts.every(p => p.kind === 'markdown')
    if (isPlain) return next(e)

    const { Box, Text, Code, Markdown, Link, Button } = $.ui.resolve(e)
    const open = await read($, expanded)
    const room = (e.viewport?.columns ?? 100) - 4

    const spans = (list: Span[], at: string) =>
      list.map((s, k) =>
        s.kind === 'code' ? (
          <Text key={`${at}.${k}`} backgroundColor={ROLE.chip}>{` ${s.text} `}</Text>
        ) : s.kind === 'link' ? (
          <Link key={`${at}.${k}`} href={s.href} label={s.label} />
        ) : (
          <Text key={`${at}.${k}`} weight={s.bold ? 'bold' : undefined} italic={s.italic} strikethrough={s.strike}>
            {s.text}
          </Text>
        ),
      )

    const markerColor = (line: Line) =>
      line.marker === 'done' ? ROLE.success
        : line.marker === 'open' ? ROLE.chrome
        : line.marker ? BULLET_COLORS[(line.depth ?? 0) % BULLET_COLORS.length]
        : undefined

    // The prefix sits in its own fixed column, so a wrapped item hangs under its
    // text rather than under its bullet.
    const lines = (list: Line[], at: string) =>
      list.map((line, j) =>
        line.prefix ? (
          <Box key={`${at}.${j}`} flexDirection="row">
            <Box width={line.prefix.length} flexShrink={0}>
              <Text color={markerColor(line)}>{line.prefix}</Text>
            </Box>
            <Box flexShrink={1}>
              <Text weight={line.isHeading ? 'bold' : undefined}>{spans(line.spans, `${at}.${j}`)}</Text>
            </Box>
          </Box>
        ) : (
          <Text key={`${at}.${j}`} weight={line.isHeading ? 'bold' : undefined}>
            {spans(line.spans, `${at}.${j}`)}
          </Text>
        ),
      )

    // Wrapped by hand at the viewport width, so every row carries its bars.
    const quote = (list: QuoteLine[], at: string) =>
      list.flatMap((line, j) => {
        const bars = `${GLYPH.bar} `.repeat(line.level)
        const rows = wrapSpans(line.spans, Math.max(8, room - bars.length - line.prefix.length))
        return rows.map((row, k) => (
          <Text key={`${at}.${j}.${k}`}>
            <Text dimColor>{bars}</Text>
            <Text color={k === 0 ? markerColor(line) : undefined}>{k === 0 ? line.prefix : ' '.repeat(line.prefix.length)}</Text>
            {spans(row, `${at}.${j}.${k}`)}
          </Text>
        ))
      })

    const draw = (part: Indexed) => {
      const i = part.i

      if (part.kind === 'markdown') return <Markdown key={`m${i}`} text={part.text} />

      if (part.kind === 'rule') {
        return <Text key={`r${i}`} dimColor>{GLYPH.track.repeat(Math.max(1, room))}</Text>
      }

      if (part.kind === 'quote') {
        return (
          <Box key={`q${i}`} flexDirection="column">
            {quote(part.lines, `q${i}`)}
          </Box>
        )
      }

      if (part.kind === 'heading') {
        return (
          <Box key={`h${i}`} flexDirection="column">
            <Text color={ROLE.accent} weight="bold">{spans(part.spans, `h${i}`)}</Text>
            <Text dimColor>{GLYPH.track.repeat(Math.max(0, Math.min(room, widthOf(part.spans))))}</Text>
          </Box>
        )
      }

      if (part.kind === 'table') {
        const widths = part.header.map((h, k) =>
          Math.max(widthOf(h), ...part.rows.map(r => widthOf(r[k] ?? []))))
        // Too wide: take the overflow from the widest columns, whose cells then
        // wrap; the engine's own table is the fallback only when that can't fit.
        const MIN_COL = 12
        let over = widths.reduce((a, b) => a + b, 0) + 3 * (widths.length - 1) + 4 - room
        while (over > 0) {
          const k = widths.indexOf(Math.max(...widths))
          if (widths[k]! <= MIN_COL) break
          const cut = Math.min(over, widths[k]! - MIN_COL)
          widths[k] = widths[k]! - cut
          over -= cut
        }
        if (over > 0) return <Markdown key={`t${i}`} text={part.source} />
        // Drawn line by line, so every wrapped line carries its column rules.
        const rule = (l: string, m: string, r: string, at: string) => (
          <Text key={at} color={ROLE.chrome}>{`${l}─${widths.map(w => '─'.repeat(w)).join(`─${m}─`)}─${r}`}</Text>
        )
        const row = (cells: Span[][], at: string, isHead: boolean) => {
          const wrapped = cells.map((cell, k) => wrapSpans(cell, widths[k]!))
          const height = Math.max(...wrapped.map(w => w.length))
          return Array.from({ length: height }, (_, j) => (
            <Text key={`${at}.${j}`} color={isHead ? ROLE.accent : undefined} weight={isHead ? 'bold' : undefined}>
              {wrapped.map((lines, k) => {
                const line = lines[j] ?? []
                const room = widths[k]! - line.reduce((n, s) => n + spanWidth(s), 0)
                const align = part.align[k] ?? 'left'
                const before = align === 'right' ? room : align === 'center' ? Math.floor(room / 2) : 0
                return (
                  <Text key={`${at}.${j}.${k}`}>
                    <Text color={ROLE.chrome}>{k === 0 ? '│ ' : ' │ '}</Text>
                    {' '.repeat(before)}
                    {spans(line, `${at}.${j}.${k}`)}
                    {' '.repeat(room - before)}
                  </Text>
                )
              })}
              <Text color={ROLE.chrome}>{' │'}</Text>
            </Text>
          ))
        }
        return (
          <Box key={`t${i}`} flexDirection="column" flexShrink={0}>
            {rule('╭', '┬', '╮', `t${i}.top`)}
            {row(part.header, `t${i}.h`, true)}
            {part.rows.flatMap((r, j) => [rule('├', '┼', '┤', `t${i}.r${j}`), ...row(r, `t${i}.${j}`, false)])}
            {rule('╰', '┴', '╯', `t${i}.end`)}
          </Box>
        )
      }

      if (part.kind === 'next') {
        return (
          <Box key={`n${i}`} borderStyle="round" borderColor={ROLE.accent} paddingX={1}>
            <Text>
              <Text color={ROLE.accent} weight="bold">{`${GLYPH.next} Next  `}</Text>
              {spans(part.spans, `n${i}`)}
            </Text>
          </Box>
        )
      }

      if (part.kind === 'callout') {
        const style = CALLOUT[part.type]
        return (
          <Box key={`a${i}`} flexDirection="column" borderStyle="round" borderColor={style.color} paddingX={1}>
            <Text color={style.color} weight="bold">{style.title}</Text>
            {lines(part.lines, `a${i}`)}
          </Box>
        )
      }

      if (part.kind === 'code') {
        const isDiff = part.language === 'diff' || part.language === 'patch'
        const all = part.source.split('\n')
        const foldId = `${e.requestId}:${i}`
        const isFolded = all.length > FOLD_OVER && !open.includes(foldId)
        const shown = isFolded ? all.slice(0, FOLD_TO).join('\n') : part.source
        // Open sides, no padding, no line-number gutter: a mouse selection of the
        // code rows copies the code alone. The rules above and below frame it.
        const label = part.language || 'code'
        const COPY = '⧉ copy'
        const copy = (
          <Button
            key={`copy${i}`}
            label={COPY}
            plain
            dimColor
            onPress={async press => {
              const result = await $.ui.copy({ text: part.source, surface: press.surface })
              $.ui.toast(result.isCopied ? 'Copied to clipboard' : `Copy failed (${result.reason})`)
            }}
          />
        )
        const body = isDiff ? (
          <Code source={asHunk(part.source)} format="diff" />
        ) : (
          <Code source={shown} language={part.language || undefined} />
        )
        const fold = all.length > FOLD_OVER && !isDiff ? (
          <Button
            key={`fold${i}`}
            label={isFolded ? `▾ show all ${all.length} lines` : '▴ fold'}
            plain
            dimColor
            onPress={() =>
              update($, expanded, ids =>
                ids.includes(foldId) ? ids.filter(id => id !== foldId) : [...ids, foldId],
              )
            }
          />
        ) : null
        return (
          <Box key={`c${i}`} flexDirection="column">
            <Box flexDirection="row">
              <Text color={ROLE.chrome}>{'╭─ '}</Text>
              <Text dimColor italic>{label}</Text>
              <Text color={ROLE.chrome}>{` ${GLYPH.track.repeat(Math.max(1, room - cellWidth(label) - COPY.length - 6))} `}</Text>
              {copy}
            </Box>
            {body}
            {fold}
            <Text color={ROLE.chrome}>{`╰${GLYPH.track.repeat(Math.max(1, room - 1))}`}</Text>
          </Box>
        )
      }

      return (
        <Box key={`l${i}`} flexDirection="column">
          {lines(part.lines, `l${i}`)}
        </Box>
      )
    }

    // A tree of our own replaces the engine's row, bullet and indent included.
    const tree = (
      <Box flexDirection="row">
      <Box width={2} flexShrink={0}>
        <Text>{e.props.isFirstOfReply ? GLYPH.live : ' '}</Text>
      </Box>
      <Box flexDirection="column" gap={1} flexGrow={1} flexShrink={1}>
        {sections(parts).map(([head, body]) =>
          head === undefined ? draw(body!) : (
            <Box key={`s${head.i}`} flexDirection="column">
              {draw(head)}
              {body ? draw(body) : null}
            </Box>
          ),
        )}
      </Box>
      </Box>
    )
    return isAscii ? asciiTree(tree) : tree
  })
}
