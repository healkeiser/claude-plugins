import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { FoldId } from '../types'
import { fenced, oneLine, tsv } from './copy'
import { layout, parseMermaid, splitMermaid, toSvg } from './mermaid'
import { asHunk, parse, spanRefs, spanWidth, wrapSpans } from './parse'
import type { QuoteLine } from './parse'
import type { CalloutType, Line, Part, Span } from './parse'
import { editorScheme, refUrl, resolvePath } from './paths'
import type { FileRef } from './paths'
import { cardFrame, nerdFont } from './kit'
import { GLYPH, ROLE, SEP, ascii, glyphSet, glyphTree, cellWidth, isAsciiGlyphs, plural, remember } from './style'

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
// The text of the main conversation's last reply, for `/gloss copy`.
const lastReply = atom({ plugin: 'gloss', key: 'lastReply' } as const, '')

const USAGE = 'Usage: /gloss copy [n] copies the nth code block of the last reply (the last when n is left out).'

// Every span of a part, for the file references it holds.
const partSpans = (p: Part): Span[] =>
  p.kind === 'lines' || p.kind === 'callout' || p.kind === 'quote' ? p.lines.flatMap(l => l.spans)
    : p.kind === 'next' || p.kind === 'heading' ? p.spans
    : p.kind === 'table' ? [...p.header.flat(), ...p.rows.flat(2)]
    : []

const refKey = (r: FileRef) => `${r.path}:${r.line}:${r.col ?? ''}`

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
  // Whether a resolved path is a file; a reply redraws often, the disk is asked once.
  const found = new Map<string, boolean>()
  let env: Promise<{ scheme: string; home: string }> | undefined

  // Whether a Nerd Font draws here (kit's nerdFont), read once a session: `glyphs: auto` draws its icons.
  let hasNerd = false
  on('session.start', async ($, e, next) => {
    hasNerd = (await nerdFont($).catch(() => 'missing' as const)) === 'ok'
    const result = await next(e)
    await $.command.register({ name: 'gloss', description: 'Copy the nth code block of the last reply (the last by default)', argumentHint: 'copy [n]' })
    return result
  })

  // Keeps the last reply's text: a prompt starts a new one, each response block adds to it.
  on('session.append', async ($, e, next) => {
    if (!e.agentId && e.door === 'prompt') await update($, lastReply, () => '')
    if (!e.agentId && e.door === 'response') {
      const text = e.message.content.flatMap(b => (b.type === 'text' && typeof b.text === 'string' ? [b.text] : [])).join('\n\n')
      if (text) await update($, lastReply, was => (was ? `${was}\n\n${text}` : text))
    }
    return next(e)
  }).catch(($, e, next) => next(e)) // a copy convenience never holds up the row

  on('command.run', { command: 'gloss' }, async ($, e) => {
    const m = /^copy(?:\s+(\d+))?$/i.exec(e.args.trim())
    if (!m) return { text: USAGE }
    const blocks = parse(await read($, lastReply)).flatMap(p => (p.kind === 'code' ? [p] : []))
    if (!blocks.length) return { text: 'The last reply has no code block.' }
    const n = m[1] ? Number(m[1]) : blocks.length
    const block = blocks[n - 1]
    if (!block) return { text: `The last reply has ${plural(blocks.length, 'code block')}: pick 1 to ${blocks.length}.` }
    const result = await $.ui.copy({ text: block.source })
    return { text: result.isCopied ? `Copied code block ${n} of ${blocks.length}${block.language ? ` (${block.language})` : ''}.` : `Copy failed (${result.reason}).` }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    // Desktop, VS Code and mobile draw replies well already (proportional type,
    // their own code blocks and tables): gloss leaves them native. DESIGN.md.
    if (e.surface !== 'terminal') {
      // Native drawing, except a mermaid fence, which becomes a picture.
      const drawn = splitMermaid(e.props.text).map(p => {
        if (p.kind === 'text') return p
        const d = parseMermaid(p.source)
        const grid = 'error' in d ? null : layout(d, 240)
        if ('error' in d || !grid) return { kind: 'text' as const, text: p.fence }
        return { ...p, svg: toSvg(grid), what: d.kind === 'flow' ? 'flowchart' : 'sequence diagram' }
      })
      if (!drawn.some(p => 'svg' in p)) return next(e)
      const { Box, Markdown, Button, Svg } = $.ui.resolve(e)
      return (
        <Box flexDirection="column" gap={1}>
          {drawn.map((p, k) =>
            'svg' in p ? (
              <Box key={`g${k}`} flexDirection="column">
                <Svg source={p.svg} alt={`Mermaid ${p.what}`} />
                <Button
                  key={`copy${k}`}
                  label="Copy mermaid source"
                  plain
                  dimColor
                  onPress={async press => {
                    const result = await $.ui.copy({ text: p.source, surface: press.surface })
                    $.ui.toast(result.isCopied ? 'Copied the mermaid source' : `Copy failed (${result.reason})`)
                  }}
                />
              </Box>
            ) : (
              <Markdown key={`g${k}`} text={p.text} />
            ),
          )}
        </Box>
      )
    }
    const cached = parsed.get(e.requestId)
    const parts = cached?.text === e.props.text ? cached.parts : parse(e.props.text)
    // Bounded: a long or resumed session must not keep every reply's parse.
    remember(parsed, e.requestId, { text: e.props.text, parts })
    const isPlain = parts.every(p => p.kind === 'markdown')
    if (isPlain) return next(e)

    const { Box, Text, Code, Markdown, Link, Button } = $.ui.resolve(e)
    const open = await read($, expanded)
    const room = (e.viewport?.columns ?? 100) - 4

    // `file:line` references link only to files that exist; checking is one
    // cached stat each, so nothing that is not a file turns into a link.
    const refs = parts.flatMap(p => spanRefs(partSpans(p)))
    const hrefs = new Map<string, string>()
    if (refs.length) {
      env ??= (async () => ({
        scheme: editorScheme({ VISUAL: await $.env.get('VISUAL'), EDITOR: await $.env.get('EDITOR'), TERM_PROGRAM: await $.env.get('TERM_PROGRAM') }),
        home: (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || '',
      }))()
      const { scheme, home } = await env
      const cwd = await $.session.cwd()
      for (const ref of refs) {
        const abs = resolvePath(cwd, ref.path, home)
        if (!found.has(abs)) remember(found, abs, await $.fs.stat(abs).then(s => s.kind === 'file', () => false))
        if (found.get(abs)) hrefs.set(refKey(ref), refUrl(abs, ref, scheme))
      }
    }

    type Choice = { key: string; label: string; text: string; what: string }
    // A row of copy choices, dim, ` · ` between: the first is the plain copy.
    const menu = (choices: Choice[]) =>
      choices.flatMap((c, k) => [
        ...(k ? [<Text key={`${c.key}.sep`} color={ROLE.chrome}>{SEP}</Text>] : []),
        <Button
          key={c.key}
          label={c.label}
          plain
          dimColor
          onPress={async press => {
            const result = await $.ui.copy({ text: c.text, surface: press.surface })
            $.ui.toast(result.isCopied ? `Copied ${c.what}` : `Copy failed (${result.reason})`)
          }}
        />,
      ])
    const menuWidth = (choices: { label: string }[]) =>
      choices.reduce((n, c) => n + cellWidth(c.label), 0) + SEP.length * Math.max(0, choices.length - 1)

    const spans = (list: Span[], at: string) =>
      list.map((s, k) =>
        s.kind === 'code' ? (
          s.ref && hrefs.has(refKey(s.ref)) ? (
            <Link key={`${at}.${k}`} href={hrefs.get(refKey(s.ref))!}>
              <Text backgroundColor={ROLE.chip}>{` ${s.text} `}</Text>
            </Link>
          ) : (
            <Text key={`${at}.${k}`} backgroundColor={ROLE.chip}>{` ${s.text} `}</Text>
          )
        ) : s.kind === 'path' ? (
          hrefs.has(refKey(s.ref)) ? (
            <Link key={`${at}.${k}`} href={hrefs.get(refKey(s.ref))!} label={s.text} />
          ) : (
            <Text key={`${at}.${k}`}>{s.text}</Text>
          )
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
        const tableChoices = [
          { key: `md${i}`, label: '⧉ md', text: part.source, what: 'the table as Markdown' },
          { key: `tsv${i}`, label: 'tsv', text: tsv(part.source), what: 'the table as TSV' },
        ]
        if (over > 0) {
          return (
            <Box key={`t${i}`} flexDirection="column">
              <Markdown text={part.source} />
              <Box flexDirection="row">{menu(tableChoices)}</Box>
            </Box>
          )
        }
        const tableWidth = widths.reduce((a, b) => a + b, 0) + 3 * (widths.length - 1) + 4
        const isBeside = tableWidth + 1 + menuWidth(tableChoices) <= room
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
            {isBeside ? (
              <Box key={`t${i}.foot`} flexDirection="row">
                {rule('╰', '┴', '╯', `t${i}.end`)}
                <Text> </Text>
                {menu(tableChoices)}
              </Box>
            ) : (
              [rule('╰', '┴', '╯', `t${i}.end`), <Box key={`t${i}.menu`} flexDirection="row">{menu(tableChoices)}</Box>]
            )}
          </Box>
        )
      }

      if (part.kind === 'next') {
        return (
          <Box key={`n${i}`} {...cardFrame(ROLE.accent)}>
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
          <Box key={`a${i}`} {...cardFrame(style.color)}>
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
        const isMermaid = part.language.toLowerCase() === 'mermaid'
        const line = isMermaid ? null : oneLine(part.source, part.language)
        // Least important last: on a narrow window the menu drops from the end.
        const choices: Choice[] = [
          { key: `copy${i}`, label: '⧉ copy', text: part.source, what: isMermaid ? 'the mermaid source' : 'the code' },
          { key: `fence${i}`, label: 'fenced', text: fenced(part.language, part.source), what: 'the block with its fence' },
          ...(line ? [{ key: `line${i}`, label: 'one line', text: line, what: 'the commands as one line' }] : []),
        ]
        while (choices.length > 1 && room - cellWidth(label) - menuWidth(choices) - 6 < 1) choices.pop()
        const head = (
          <Box flexDirection="row">
            <Text color={ROLE.chrome}>{'╭─ '}</Text>
            <Text dimColor italic>{label}</Text>
            <Text color={ROLE.chrome}>{` ${GLYPH.track.repeat(Math.max(1, room - cellWidth(label) - menuWidth(choices) - 6))} `}</Text>
            {menu(choices)}
          </Box>
        )
        const foot = <Text color={ROLE.chrome}>{`╰${GLYPH.track.repeat(Math.max(1, room - 1))}`}</Text>

        if (isMermaid) {
          const d = parseMermaid(part.source)
          const grid = 'error' in d ? null : layout(d, room)
          const why = 'error' in d ? d.error : `too wide for ${room} columns`
          return (
            <Box key={`c${i}`} flexDirection="column">
              {head}
              {grid
                ? grid.rows().map((row, k) => <Text key={`c${i}.${k}`}>{isAscii ? ascii(row) : row}</Text>)
                : [
                    <Text key={`c${i}.why`} dimColor>{`${GLYPH.info} ${why}: the source is shown`}</Text>,
                    <Code key={`c${i}.src`} source={part.source} />,
                  ]}
              {foot}
            </Box>
          )
        }
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
            {head}
            {body}
            {fold}
            {foot}
          </Box>
        )
      }

      return (
        <Box key={`l${i}`} flexDirection="column">
          {lines(part.lines, `l${i}`)}
        </Box>
      )
    }

    // A tree of our own replaces the engine's row, bullet and indent included. The bullet stays the
    // engine's `●` outside the glyph swap: a Nerd circle is larger, and rows gloss leaves to the engine
    // keep the small one, so the bullets would change size down the transcript.
    const set = glyphSet(options?.glyphs, hasNerd, e.surface)
    const body = glyphTree(
      <Box flexDirection="column" gap={1} flexGrow={1} flexShrink={1}>
        {sections(parts).map(([head, body]) =>
          head === undefined ? draw(body!) : (
            <Box key={`s${head.i}`} flexDirection="column">
              {draw(head)}
              {body ? draw(body) : null}
            </Box>
          ),
        )}
      </Box>,
      set,
    )
    return (
      <Box flexDirection="row">
        {glyphTree(
          <Box width={2} flexShrink={0}>
            <Text>{e.props.isFirstOfReply ? GLYPH.live : ' '}</Text>
          </Box>,
          set === 'nerd' ? 'plain' : set,
        )}
        {body}
      </Box>
    )
  })
}
