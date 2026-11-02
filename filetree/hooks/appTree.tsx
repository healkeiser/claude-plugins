// The tree as the desktop app draws its own Files panel, from its code (the app's file-tree rows: a
// `treeitem` of height --cds-h-control, 32px, rounded, its padding 8px + 12px a level, a 4px gap; a
// folder shows its caret alone, turned when open, a file its type's icon; 1px guides at each level in
// --cds-border; the row's own hover is --cds-fill-ghost-hover, the selected row --cds-fill-ghost-selected).
// Nothing here is drawn in cells: the desktop lays a `Client` out as a terminal grid, so the tree is
// native Boxes. The press is a hit zone over the row (app.tsx's gHit) and the hover a layer the surface
// shows itself (gHover), as the upstream filetree draws its desktop rows: no Button lies over a row.
//
// Motion is SVG animation (SMIL), so no tick runs: a folder's chevron turns as it opens, a file Claude
// is reading or writing pulses a dot in its tone, a running git action spins.
import type { ElementConstructor, RenderChildren, SvgProps } from 'claude-code'

import { CDS, gGround, gHit, gHover, gHoverGround, gSheen, gSkeleton, gWorkingDot, type IconName, iconPaths } from './app'
import type { Kit } from './kit'

/** The app's own row colours, sampled from its Files panel. */
export const ROW = { tall: 32, pad: 8, indent: 12, icon: '#999999', guide: CDS.hairline } as const

export type AppRow = {
  id: string
  name: string
  depth: number
  kind: 'dir' | 'file' | 'link'
  isOpen: boolean
  /** The chevron turns from shut to open as this drawing loads: the folder opened a moment ago. */
  isOpening: boolean
  isSelected: boolean
  /** The name's colour: a git status's, or none for the text colour. */
  color?: string
  /** The name struck through: deleted. */
  isGone?: boolean
  isDim?: boolean
  /** A tone's hex while Claude reads or writes it: a dot pulses beside the name. */
  pulse?: string
  /** Grey, right: the column the person picked (a date, an age, a size, lines). */
  meta?: string
  /** The figure for `meta` is still being read: a skeleton stands in its place. */
  isLoading?: boolean
  /** Motion off or Reduce motion on: the dot holds still and no sheen crosses the row. */
  isStill?: boolean
  /** Right, always: git's letter, line counts, edit heat. */
  badges: { text: string; color?: string }[]
}

const fileKind = (name: string): IconName =>
  /\.(md|mdx|markdown|txt|rst|docx?|odt|rtf|pdf)$/i.test(name)
    ? 'fileText'
    : /\.(png|jpe?g|gif|webp|svg|bmp|ico|tiff?|exr|hdr|psd)$/i.test(name)
      ? 'image'
      : /\.(m?[jt]sx?|c[jt]s|py|rs|go|rb|java|kt|swift|c|cc|cpp|h|hpp|cs|php|sh|ps1|lua|json|ya?ml|toml|html?|css|scss|vue|svelte|sql)$/i.test(name)
        ? 'fileCode'
        : 'file'

/** The row's lead, in one drawing: its padding and indent, a guide per level, then the caret or the file icon. */
function lead(r: AppRow): string {
  const x = ROW.pad + r.depth * ROW.indent
  const w = x + 16
  const y = (ROW.tall - 16) / 2
  // A guide at each level, under the middle of its folder's caret (the app's --file-tree-guides).
  const guides = Array.from({ length: r.depth }, (_, i) => `<rect x="${ROW.pad + i * ROW.indent + 7.5}" width="1" height="${ROW.tall}" fill="${ROW.guide}"/>`).join('')
  const draw = (body: string) => `<g transform="translate(${x} ${y}) scale(0.6667)" fill="none" stroke="${ROW.icon}" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">${body}</g>`
  let body: string
  if (r.kind === 'dir') {
    // The caret points right, and down when open: turned about its centre, on the app's snap easing.
    const turn = r.isOpen && r.isOpening
      ? `<animateTransform attributeName="transform" type="rotate" from="0 12 12" to="90 12 12" dur="${CDS.dur.base}s" calcMode="spline" keyTimes="0;1" keySplines="${CDS.ease.snap}" fill="freeze"/>`
      : ''
    const rest = r.isOpen && !r.isOpening ? ' transform="rotate(90 12 12)"' : ''
    body = draw(`<g${rest}><path d="m9 18 6-6-6-6"/>${turn}</g>`)
  } else body = draw(iconPaths(fileKind(r.name)))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${ROW.tall}" viewBox="0 0 ${w} ${ROW.tall}">${guides}${body}</svg>`
}

/**
 * One row of the tree, the whole row its press. A surface paints a `position: absolute` Box over the
 * flow, so the content is in the flow and layers lie over it: the selection (white at 15%, rounded), the
 * hover (white at 7.5%, rounded, shown by the surface while the pointer is on the row), a sheen while
 * Claude is on the file, and last the hit zone. Lean on purpose: a pane's drawing is held to 100,000
 * characters.
 */
export function appRow(k: Kit, r: AppRow, onPress: () => unknown): RenderChildren {
  const { Box, Text } = k.els
  if (!('Svg' in k.els)) return null
  const { Svg } = k.els as unknown as { Svg: ElementConstructor<SvgProps> }
  const key = `row-${r.id}`
  const layer = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const
  return (
    <Box key={key} position="relative" flexDirection="row" alignItems="center" gap="xs" paddingRight="sm" flexShrink={0}>
      <Svg source={lead(r)} alt={r.kind === 'dir' ? 'Folder' : 'File'} width={ROW.pad + r.depth * ROW.indent + 16} height={ROW.tall} {...(r.isOpening ? { isInteractive: true } : {})} />
      <Box flexShrink={1} overflow="hidden">
        <Text
          wrap="truncate-end"
          {...(r.color ? { color: r.color } : r.isDim ? { dimColor: true } : {})}
          {...(r.isGone ? { strikethrough: true } : {})}
        >
          {r.name}
        </Text>
      </Box>
      {r.pulse ? gWorkingDot(k, `dot-${r.id}`, r.pulse, 12, r.isStill) : null}
      <Box flexGrow={1} />
      {r.isLoading ? gSkeleton(k, `skel-${r.id}`) : r.meta ? <Text dimColor size="footnote" tabular>{r.meta}</Text> : null}
      {r.badges.map((b, i) => (
        <Text key={`b-${i}`} size="footnote" tabular {...(b.color ? { color: b.color } : { dimColor: true })}>
          {b.text}
        </Text>
      ))}
      {r.isSelected ? <Box {...layer}>{gGround(k, `sel-${r.id}`, CDS.ghostSelectedOver, ROW.tall)}</Box> : gHover(k, gHoverGround(k, ROW.tall))}
      {r.pulse && !r.isStill ? (
        <Box {...layer} flexDirection="column">
          {gSheen(k, `sheen-${r.id}`, r.pulse, ROW.tall)}
        </Box>
      ) : null}
      {gHit(k, key, onPress)}
    </Box>
  )
}
