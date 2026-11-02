// The tree as the desktop app draws its own Files panel (sampled from it, dark theme): rows of 32px,
// a grey outline chevron for a folder and an outline file icon for a file in the same slot, 12px a
// level, the name in the text colour, a rounded grey on hover and a lighter one on the selected row.
// Nothing here is drawn in cells: the desktop lays a `Client` out as a terminal grid, so the tree there
// is native Boxes, with a plain Button laid over each row for the press (only a Button takes one).
//
// Motion is SVG animation (SMIL), so no tick runs: a folder's chevron turns as it opens, a file Claude
// is reading or writing pulses a dot in its tone, a running git action spins.
import type { ElementConstructor, RenderChildren, SvgProps } from 'claude-code'

import { APP, CDS, gGround, gSheen, gSkeleton, gWorkingDot, type IconName, iconPaths } from './app'
import type { Kit } from './kit'

/** The app's own row colours, sampled from its Files panel. */
export const ROW = { hover: CDS.ghostHover, selected: CDS.ghostSelected, overlay: CDS.ghostSelectedOver, ink: CDS.text, icon: '#999999', indent: 12 } as const

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

/** The row's lead: its indent, then a file's outline icon; a folder's lead is its indent alone. */
function lead(r: AppRow): string {
  const x = r.depth * ROW.indent
  const w = x + (r.kind === 'dir' ? 0 : 16) || 1
  const body =
    r.kind === 'dir'
      ? ''
      : `<g transform="translate(${x} 0) scale(0.6667)" fill="none" stroke="${ROW.icon}" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">${iconPaths(fileKind(r.name))}</g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="16" viewBox="0 0 ${w} 16">${body}</svg>`
}

/**
 * One row of the tree. Its press is a real Button whose face is the folder's disclosure (▸ ▾, as the
 * app's Environment panel discloses) and the name, so the app's own rounded hover and focus ring sit on
 * exactly what is clicked; nothing is laid over the row. The indent and a file's icon lead it, the
 * column and git's marks follow it, and the selection lies over the whole row (white at 15%, rounded).
 * Lean on purpose: a pane's whole drawing is held to 100,000 characters.
 */
export function appRow(k: Kit, r: AppRow, onPress: () => unknown): RenderChildren {
  const { Box, Text, Button } = k.els
  if (!('Svg' in k.els)) return null
  const { Svg } = k.els as unknown as { Svg: ElementConstructor<SvgProps> }
  const disclose = r.kind === 'dir' ? (r.isOpen ? '▾' : '▸') : ''
  return (
    <Box key={`row-${r.id}`} position="relative" flexDirection="row" alignItems="center" gap="xs" paddingX="xs" flexShrink={0}>
      <Svg source={lead(r)} alt={r.kind === 'dir' ? 'Folder' : 'File'} width={r.depth * ROW.indent + (r.kind === 'dir' ? 0 : 16) || 1} height={16} />
      <Box flexShrink={1} overflow="hidden">
        <Button key={`open-${r.id}`} plain onPress={onPress}>
          {disclose ? <Text dimColor>{`${disclose} `}</Text> : null}
          <Text
            {...(r.color ? { color: r.color } : r.isDim ? { dimColor: true } : {})}
            {...(r.isGone ? { strikethrough: true } : {})}
          >
            {r.name}
          </Text>
        </Button>
      </Box>
      {r.pulse ? gWorkingDot(k, `dot-${r.id}`, r.pulse, 12, r.isStill) : null}
      <Box flexGrow={1} />
      {r.isLoading ? gSkeleton(k, `skel-${r.id}`) : r.meta ? <Text dimColor size="footnote" tabular>{r.meta}</Text> : null}
      {r.badges.map((b, i) => (
        <Text key={`b-${i}`} size="footnote" tabular {...(b.color ? { color: b.color } : { dimColor: true })}>
          {b.text}
        </Text>
      ))}
      {r.isSelected ? (
        <Box position="absolute" top={0} left={0} right={0} bottom={0}>
          {gGround(k, `sel-${r.id}`, ROW.overlay)}
        </Box>
      ) : null}
      {r.pulse && !r.isStill ? (
        <Box position="absolute" top={0} left={0} right={0} bottom={0} flexDirection="column">
          {gSheen(k, `sheen-${r.id}`, r.pulse)}
        </Box>
      ) : null}
    </Box>
  )
}
