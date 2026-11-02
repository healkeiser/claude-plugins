// The app kit: how a mod draws on a graphical surface (the desktop app, VS Code, mobile). The
// terminal's kit is kit.tsx; this one is the desktop app's own language, translated part for part.
//
// Its values are the Claude Design System's (CDS), read from the desktop app's own stylesheet
// (docs/cds/tokens.txt keeps the extract) and checked against screenshots of its panels: the dark
// theme's ghost hover and selection, git's colours, radii, durations and easings. A pane drawn with
// these parts sits beside the app's own Environment, Files and Usage panels without a seam.
//
// The same source as kit.tsx: edit shared/app.tsx, then run `node scripts/check-style.mjs --write`.
import type { ElementConstructor, RenderChildren, RenderElement, SvgProps } from 'claude-code'

import type { Kit } from './kit'
import { sentence, wholePct } from './style'

/**
 * The Claude Design System's dark-theme values the app kit draws with. Greys are the panels' own
 * (white at a share of opacity over the panel ground #191919); motion is CDS's durations and easings.
 */
export const CDS = {
  ground: '#191919',
  /** --cds-fill-ghost-hover: white at 7.5%. */
  ghostHover: '#2a2a2a',
  /** --cds-fill-ghost-selected: white at 15%. */
  ghostSelected: '#3b3b3b',
  /** The same selection laid over content: white at 15%, as CDS composes it. */
  ghostSelectedOver: '#ffffff26',
  /** --cds-border: white at 10%; a hairline between sections. */
  hairline: '#252525',
  /** The rule under a panel's head (Files, Environment), sampled. */
  rule: '#353535',
  /** A text field's fill and edge: the surface's own Input's, so a field drawn round it reads as one. */
  field: '#303030',
  fieldEdge: '#343434',
  text: '#efefef',
  icon: '#9c9c9c',
  clay: '#d97757',
  git: { added: '#32d74b', modified: '#ffd014', removed: '#ff2c56', conflicting: '#fa832e', untracked: '#a6a6a6', merged: '#b796ff' },
  /** --cds-radius--xs, --sm, --lg in px. */
  radius: { xs: 6, sm: 7, lg: 10 },
  /** --cds-dur-*, in seconds as SVG animation reads them. */
  dur: { fast: 0.06, snap: 0.12, base: 0.2, slow: 0.45 },
  /** --cds-ease-*, as SVG keySplines. */
  ease: { out: '0.165 0.84 0.44 1', snap: '0.32 0.72 0 1', overshoot: '0.34 1.3 0.64 1', inOut: '0.4 0 0.2 1' },
} as const

// The desktop app, VS Code and mobile draw in their own type. There a pane is drawn as the app draws its
// own panels, part for part: the Environment panel for sections (a plain title, the same size and weight
// as its rows; rows of one line, an outline icon in a grey column, the label, a grey detail after it, the
// value right; a hairline between sections), Settings > Usage for limits (the name with its reset under
// it, a long thin bar, `97% used` right) and the Context panel for a legend (a rounded colour square, the
// label, the value right). Its colours are the app's own: a usage bar blue, red near its limit, on a faint
// track; icons and details grey. The terminal keeps the parts above.

/** The app's usage colours: its bars' blue, and the red it turns near a limit. */
export const APP = { blue: '#257de0', red: '#dc3c3d', track: '#7f7f7f', icon: '#9c9c9c', hover: CDS.ghostHover, selected: CDS.ghostSelected } as const

/** Whether the surface draws in its own type (desktop, VS Code, mobile) rather than terminal cells. */
export const isGraphical = (k: Kit): boolean => !k.isTerm

const svgEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const svgOf = (k: Kit) => ('Svg' in k.els ? (k.els as unknown as { Svg: ElementConstructor<SvgProps> }).Svg : null)

/** A hairline as the Environment panel draws between its sections: 1px, faint, the pane's width. */
export function gDivider(k: Kit, key: string): RenderChildren {
  const Svg = svgOf(k)
  if (!Svg) return null
  return (
    <Svg
      key={key}
      source={`<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="1"><rect width="100%" height="1" fill="${APP.track}" fill-opacity="0.25"/></svg>`}
      alt="Separator"
      height={1}
    />
  )
}

/** A pane on a graphical surface: its sections one under the other, a hairline between each two. */
export function gPane(k: Kit, ...children: RenderChildren[]): RenderElement {
  const { Box } = k.els
  const shown = children.filter(c => c !== null && c !== undefined && c !== false)
  return (
    <Box key="g-pane" flexDirection="column" gap="md" paddingY="sm">
      {shown.flatMap((c, i) => (i ? [gDivider(k, `g-rule-${i}`), c] : [c]))}
    </Box>
  )
}

/**
 * A section as the Environment panel heads one: its title plain, the rows' size and weight, a muted tag
 * beside it, a meta right; its rows under.
 */
export function gSection(
  k: Kit,
  o: { key: string; title: string; tag?: string; meta?: RenderChildren },
  ...children: RenderChildren[]
): RenderChildren {
  const { Box, Text } = k.els
  return (
    <Box key={o.key} flexDirection="column" gap="sm">
      <Box flexDirection="row" alignItems="center" gap="sm">
        <Text wrap="truncate-end">{sentence(o.title)}</Text>
        {o.tag ? <Text dimColor wrap="truncate-end">{o.tag}</Text> : null}
        <Box flexGrow={1} />
        {o.meta === undefined ? null : typeof o.meta === 'string' ? <Text dimColor wrap="truncate-end">{o.meta}</Text> : o.meta}
      </Box>
      {children.filter(c => c !== null && c !== undefined && c !== false)}
    </Box>
  )
}

/** Outline icons in the Environment panel's manner (Lucide's shapes, ISC licence), 24 units square. */
const ICON = {
  model: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
  effort: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  mode: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  branch: '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  cost: '<circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/>',
  timer: '<path d="M10 2h4"/><path d="m12 14 3-3"/><circle cx="12" cy="14" r="8"/>',
  edit: '<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/>',
  error: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  agent: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/>',
  tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  fileText: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8M16 13H8M16 17H8"/>',
  fileCode: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m10 13-2 2 2 2M14 17l2-2-2-2"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  locate: '<line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="m2 2 20 20"/>',
  columns: '<path d="M3 5h18M3 12h18M3 19h18"/><path d="M17 3v4M17 10v4M17 17v4"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  collapse: '<path d="m7 20 5-5 5 5"/><path d="m7 4 5 5 5-5"/>',
  clear: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  chevronUp: '<path d="m18 15-6-6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
} as const
export type IconName = keyof typeof ICON
/** An icon's 24-unit outline markup, for a drawing that composes icons (a tree row's chevron and file). */
export const iconPaths = (name: IconName): string => ICON[name]

/** An outline icon, 16px, in the grey the Environment panel draws its icons in. */
export function gIcon(k: Kit, key: string, name: IconName, color: string = APP.icon): RenderChildren {
  const Svg = svgOf(k)
  if (!Svg) return null
  return (
    <Svg
      key={key}
      source={`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`}
      alt={name}
      width={16}
      height={16}
    />
  )
}

/**
 * An icon button as the app's panel heads draw theirs (Files: search, list, more): the outline icon
 * alone, 16px in a 28px square, no chrome; on, it sits on a rounded light square. Only a Button takes a
 * press, so a plain one, its face blank, lies over the icon; its label names the action.
 */
export function gIconButton(k: Kit, o: { key: string; icon: IconName; label: string; isOn?: boolean; action?: string; onPress: () => unknown }): RenderChildren {
  const Svg = svgOf(k)
  const { Box, Button, Text } = k.els
  if (!Svg) return null
  const ink = o.isOn ? '#efefef' : APP.icon
  return (
    <Box key={`${o.key}-box`} position="relative" flexShrink={0}>
      <Svg
        source={
          `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">` +
          (o.isOn ? `<rect width="28" height="28" rx="6" fill="#3b3b3b"/>` : '') +
          `<g transform="translate(6 6) scale(0.6667)" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[o.icon]}</g></svg>`
        }
        alt={o.label}
        width={28}
        height={28}
      />
      <Box position="absolute" top={0} left={0} right={0} bottom={0} flexDirection="column" overflow="hidden">
        <Button key={o.key} plain {...(o.action ? { action: o.action } : {})} onPress={o.onPress}>
          <Text color="#00000000">{'\u00a0\u00a0'}</Text>
        </Button>
      </Box>
    </Box>
  )
}

/**
 * A row's ground as the app's lists round theirs (--cds-radius--xs): two rounded caps and a filled
 * middle that stretches, so it spans any width (an SVG has no width of its own to stretch to). Drawn as
 * a layer of its row: `position: absolute` Boxes paint over the flow, so the row's content is a later layer.
 */
export function gGround(k: Kit, key: string, color: string, height = 32): RenderChildren {
  if (!('Svg' in k.els)) return null
  const { Box } = k.els
  const { Svg } = k.els as unknown as { Svg: ElementConstructor<SvgProps> }
  const r = CDS.radius.xs
  const cap = (side: 'l' | 'r') => (
    <Svg
      key={`${key}-${side}`}
      source={`<svg xmlns="http://www.w3.org/2000/svg" width="${r}" height="${height}" viewBox="0 0 ${r} ${height}"><rect x="${side === 'l' ? 0 : -r}" width="${2 * r}" height="${height}" rx="${r}" fill="${color}"/></svg>`}
      alt="Row"
      width={r}
      height={height}
    />
  )
  return (
    <Box key={key} flexDirection="row" flexGrow={1}>
      {cap('l')}
      <Box flexGrow={1} backgroundColor={color} />
      {cap('r')}
    </Box>
  )
}

/** A box `tall` pixels high and 1 wide, in the flow: it gives a row of absolute layers its height. */
export function gStrut(k: Kit, key: string, tall: number): RenderChildren {
  if (!('Svg' in k.els)) return null
  const { Svg } = k.els as unknown as { Svg: ElementConstructor<SvgProps> }
  return <Svg key={key} source={`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="${tall}"/>`} alt="Spacer" width={1} height={tall} />
}

/**
 * Tabs as the app draws its own pane tabs (Files, Flightdeck, Prompts): 28px, the label in the text
 * colour, the active one on a rounded ghost-selected ground, every one with the ghost hover under the
 * pointer. Each tab is layers: its label in the flow (transparent, for its width), the ground, the
 * label, the press, whose Button keeps the key `tab-<id>`.
 */
export function gTabs(k: Kit, o: { items: readonly { id: string; label: string }[]; active: string | null; onPick: (id: string) => void }): RenderChildren {
  const { Box, Text } = k.els
  const layer = { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 }
  return (
    <Box key="kit-tabs" flexDirection="row" gap="xs" flexShrink={0} marginBottom="sm">
      {o.items.map(t => (
        <Box key={`tabbox-${t.id}`} position="relative" flexDirection="row" alignItems="center" paddingX="sm" flexShrink={0}>
          {gStrut(k, `tabh-${t.id}`, 28)}
          <Text color="#00000000">{sentence(t.label)}</Text>
          {t.id === o.active ? <Box {...layer}>{gGround(k, `tabg-${t.id}`, CDS.ghostSelected, 28)}</Box> : null}
          <Box {...layer} flexDirection="row" alignItems="center" justifyContent="center">
            <Text>{sentence(t.label)}</Text>
          </Box>
          <Box {...layer}>{gPress(k, `tabp-${t.id}`, () => o.onPick(t.id), `tab-${t.id}`)}</Box>
        </Box>
      ))}
    </Box>
  )
}

/** The rule under a panel's head, edge to edge: 1px, the head's border grey. */
export function gRule(k: Kit, key: string): RenderChildren {
  if (!('Svg' in k.els)) return null
  const { Svg } = k.els as unknown as { Svg: ElementConstructor<SvgProps> }
  return <Svg key={key} source={`<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="1"><rect width="100%" height="1" fill="${CDS.rule}"/></svg>`} alt="Separator" height={1} />
}

const FIELD_H = 28

/** The height a field takes in the flow: its layers are absolute, so this gives the row its 28px. */
export function gFieldSpacer(k: Kit, key: string): RenderChildren {
  if (!('Svg' in k.els)) return null
  const { Svg } = k.els as unknown as { Svg: ElementConstructor<SvgProps> }
  return <Svg key={key} source={`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="${FIELD_H}"/>`} alt="Field" width={1} height={FIELD_H} />
}

/**
 * A text field's body as the app draws one (--cds-fill-field, --cds-radius--xs): rounded caps and a
 * stretching middle, filled, as wide as its row.
 */
export function gField(k: Kit, key: string): RenderChildren {
  if (!('Svg' in k.els)) return null
  const { Box } = k.els
  const { Svg } = k.els as unknown as { Svg: ElementConstructor<SvgProps> }
  const r = CDS.radius.xs
  const tall = FIELD_H
  const cap = (side: 'l' | 'r') => (
    <Svg
      key={`${key}-${side}`}
      source={
        `<svg xmlns="http://www.w3.org/2000/svg" width="${r + 1}" height="${tall}" viewBox="0 0 ${r + 1} ${tall}">` +
        `<rect x="${side === 'l' ? 0 : -r - 1}" width="${2 * r + 2}" height="${tall}" rx="${r}" fill="${CDS.field}"/></svg>`
      }
      alt="Field"
      width={r + 1}
      height={tall}
    />
  )
  return (
    <Box key={key} flexDirection="row" flexGrow={1}>
      {cap('l')}
      <Box flexGrow={1} backgroundColor={CDS.field} />
      {cap('r')}
    </Box>
  )
}

/**
 * A press over a whole region, as a layer of it: one plain Button, its face blank, as wide as the
 * region. Its own hover is the app's ghost hover (white at 7.5%, rounded), so the row needs no other.
 * Its face is one blank cell: the Button stretches to the region on its own, and a longer face would
 * overflow into the app's ellipsis.
 */
export function gPress(k: Kit, key: string, onPress: () => unknown, buttonKey = `${key}-b`): RenderChildren {
  const { Box, Button, Text } = k.els
  return (
    <Box key={key} flexDirection="column" flexGrow={1} overflow="hidden">
      <Button key={buttonKey} plain onPress={onPress}>
        <Text color="#00000000">{'\u00a0\u00a0'}</Text>
      </Button>
    </Box>
  )
}

/** A thin bar with round ends, as wide as its box: `segments` (shares of the whole, 0 to 1, each a hex colour) over a faint track. */
export function gBar(k: Kit, o: { key: string; alt: string; segments: readonly { share: number; color: string }[] }): RenderChildren {
  const Svg = svgOf(k)
  if (!Svg) return null
  let x = 0
  const before = barWidths.get(o.key) ?? []
  const widths: number[] = []
  const rects = o.segments
    .filter(sg => sg.share > 0)
    .map((sg, i) => {
      const w = Math.max(1.2, Math.min(100 - x, sg.share * 100))
      widths.push(w)
      // A reading that changed glides from where it was, as the app's bars do (--cds-dur-slow, ease-out).
      const from = before[i]
      const glide = from !== undefined && Math.abs(from - w) > 0.05 ? `<animate attributeName="width" from="${from.toFixed(2)}%" to="${w.toFixed(2)}%" dur="${CDS.dur.slow}s" calcMode="spline" keyTimes="0;1" keySplines="${CDS.ease.out}" fill="freeze"/>` : ''
      const r = `<rect x="${x.toFixed(2)}%" width="${w.toFixed(2)}%" height="6" fill="${sg.color}">${glide}</rect>`
      x += w
      return r
    })
    .join('')
  barWidths.set(o.key, widths)
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="6"><title>${svgEsc(o.alt)}</title>` +
    `<defs><clipPath id="c"><rect width="100%" height="6" rx="3"/></clipPath></defs>` +
    `<g clip-path="url(#c)"><rect width="100%" height="6" fill="${APP.track}" fill-opacity="0.2"/>${rects}</g></svg>`
  return <Svg key={o.key} source={source} alt={o.alt} height={6} isInteractive />
}

/** Each bar's last widths, by key: a new reading glides from them. */
const barWidths = new Map<string, number[]>()

// ---------------------------------------------------------------- motion, as the app moves
//
// The app's own keyframes, redrawn as SVG animation (a mod has no CSS): the same shapes, durations and
// easings as its stylesheet's `cds-*` animations. Each is drawn `isInteractive`, where animation runs.

/**
 * The app's working dot (cds-working-dot-halo): a dot with a halo that breathes out to 1.5× and back
 * every 2.5s, ease-in-out. For anything running: a turn, an agent, a file Claude is on.
 */
export function gWorkingDot(k: Kit, key: string, color: string = CDS.clay, size = 12, isStill = false): RenderChildren {
  const Svg = svgOf(k)
  if (!Svg) return null
  const c = size / 2
  const r = size / 4
  const ease = `calcMode="spline" keyTimes="0;0.5;1" keySplines="0.42 0 0.58 1;0.42 0 0.58 1"`
  return (
    <Svg
      key={key}
      source={
        `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
        (isStill
          ? ''
          : `<circle cx="${c}" cy="${c}" r="${r}" fill="${color}" opacity="0">` +
            `<animate attributeName="r" values="${r};${r * 1.5 * 1.33};${r}" dur="2.5s" repeatCount="indefinite" ${ease}/>` +
            `<animate attributeName="opacity" values="0;0.3;0" dur="2.5s" repeatCount="indefinite" ${ease}/></circle>`) +
        `<circle cx="${c}" cy="${c}" r="${r}" fill="${color}"/></svg>`
      }
      alt="Working"
      width={size}
      height={size}
      isInteractive
    />
  )
}

/**
 * The app's shimmer (cds-shimmer-text-band): a soft band of light crossing its region every 3s, held at
 * each end, on cubic-bezier(.714,.121,.211,.888). Drawn as a layer over a row, in a tone, faint.
 */
export function gSheen(k: Kit, key: string, color: string, tall = 32): RenderChildren {
  const Svg = svgOf(k)
  if (!Svg) return null
  const id = `s${key.replace(/[^a-zA-Z0-9]/g, '').slice(-12)}`
  return (
    <Svg
      key={key}
      source={
        `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${tall}">` +
        `<defs><linearGradient id="${id}" x1="0" x2="1" y1="0" y2="0.2"><stop offset="0" stop-color="${color}" stop-opacity="0"/>` +
        `<stop offset="0.5" stop-color="${color}" stop-opacity="0.16"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient>` +
        `<clipPath id="${id}c"><rect width="100%" height="${tall}" rx="${CDS.radius.xs}"/></clipPath></defs>` +
        `<g clip-path="url(#${id}c)"><rect y="0" width="50%" height="${tall}" fill="url(#${id})">` +
        `<animate attributeName="x" values="-50%;-50%;100%;100%" keyTimes="0;0.15;0.85;1" dur="3s" repeatCount="indefinite" calcMode="spline" keySplines="0 0 1 1;0.714 0.121 0.211 0.888;0 0 1 1"/>` +
        `</rect></g></svg>`
      }
      alt="Claude is on this"
      height={tall}
      isInteractive
    />
  )
}

/**
 * The app's skeleton (cds-skeleton-breathe and cds-skeleton-sweep): a rounded placeholder that breathes
 * to 60% and back while a sheen sweeps it every 2s; for a figure still being read (a size, a line count).
 */
export function gSkeleton(k: Kit, key: string, width = 36, tall = 8): RenderChildren {
  const Svg = svgOf(k)
  if (!Svg) return null
  return (
    <Svg
      key={key}
      source={
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${tall}" viewBox="0 0 ${width} ${tall}">` +
        `<defs><linearGradient id="k" x1="0" x2="1"><stop offset="0.35" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.12"/><stop offset="0.65" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
        `<clipPath id="kc"><rect width="${width}" height="${tall}" rx="${tall / 2}"/></clipPath></defs>` +
        `<g clip-path="url(#kc)"><rect width="${width}" height="${tall}" fill="#ffffff" fill-opacity="0.08">` +
        `<animate attributeName="opacity" values="1;0.6;1" dur="2s" repeatCount="indefinite"/></rect>` +
        `<rect width="${width}" height="${tall}" fill="url(#k)"><animate attributeName="x" from="${-width}" to="${width}" dur="2s" repeatCount="indefinite"/></rect></g></svg>`
      }
      alt="Loading"
      width={width}
      height={tall}
      isInteractive
    />
  )
}

/** The app's spinner (spin): a quarter arc turning on a faint ring, 0.8s a turn. */
export function gSpinner(k: Kit, key: string, color: string = APP.icon, size = 14): RenderChildren {
  const Svg = svgOf(k)
  if (!Svg) return null
  const c = size / 2
  const r = c - 1.5
  return (
    <Svg
      key={key}
      source={
        `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-opacity="0.25" stroke-width="1.5"/>` +
        `<path d="M${c} ${c - r}a${r} ${r} 0 0 1 ${r} ${r}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round">` +
        `<animateTransform attributeName="transform" type="rotate" from="0 ${c} ${c}" to="360 ${c} ${c}" dur="0.8s" repeatCount="indefinite"/></path></svg>`
      }
      alt="Running"
      width={size}
      height={size}
      isInteractive
    />
  )
}

/** A usage reading's colour, as the app's: blue, red from 80%. */
export const usageColor = (pct: number): string => (pct >= 80 ? APP.red : APP.blue)

/**
 * A chart row as Settings > Usage draws one: the name, a grey line under it, a coloured note under that,
 * the chart (a bar, a sparkline) in the middle as wide as is left, the value right in grey or a colour.
 */
export function gChartRow(
  k: Kit,
  o: { key: string; label: string; sub?: string; note?: string; noteColor?: string; chart: RenderChildren; value: string; valueColor?: string },
): RenderChildren {
  const { Box, Text } = k.els
  return (
    <Box key={o.key} flexDirection="row" alignItems="center" gap="lg">
      <Box flexDirection="column" width="36%" flexShrink={0}>
        <Text wrap="truncate-end">{o.label}</Text>
        {o.sub ? <Text dimColor size="footnote" wrap="truncate-end">{o.sub}</Text> : null}
        {o.note ? <Text size="footnote" wrap="wrap" {...(o.noteColor ? { color: o.noteColor } : { dimColor: true })}>{o.note}</Text> : null}
      </Box>
      <Box flexGrow={1} flexShrink={1} overflow="hidden">
        {o.chart}
      </Box>
      <Box flexShrink={0} justifyContent="flex-end">
        <Text size="footnote" tabular wrap="truncate-end" {...(o.valueColor ? { color: o.valueColor } : { dimColor: true })}>
          {o.value}
        </Text>
      </Box>
    </Box>
  )
}

/**
 * A usage row as Settings > Usage draws one: the name, a grey line under it (when it resets), a long thin
 * bar in the middle, `97% used` right in grey. `note` adds a coloured line (a forecast) under the grey one.
 */
export function gUsage(k: Kit, o: { key: string; label: string; sub?: string; note?: string; noteColor?: string; pct: number }): RenderChildren {
  const used = `${wholePct(o.pct)}% used`
  return gChartRow(k, {
    ...o,
    value: used,
    chart: gBar(k, { key: `${o.key}-bar`, alt: `${o.label}: ${used}${o.sub ? `, ${o.sub}` : ''}`, segments: [{ share: Math.min(1, Math.max(0, o.pct / 100)), color: usageColor(o.pct) }] }),
  })
}

/**
 * A row as the Environment panel draws one, on one line: an icon (or another lead) in its own column,
 * the label, a grey detail after it, the value right in grey (or a colour), digits of one width.
 */
export function gRow(
  k: Kit,
  o: { key: string; label: string; sub?: string; value?: string; valueColor?: string; lead?: RenderChildren; icon?: IconName },
): RenderChildren {
  const { Box, Text } = k.els
  const lead = o.icon ? gIcon(k, `${o.key}-icon`, o.icon) : o.lead
  return (
    <Box key={o.key} flexDirection="row" alignItems="center" gap="md">
      {lead ? (
        <Box flexShrink={0} alignItems="center" justifyContent="center">
          {lead}
        </Box>
      ) : null}
      <Box flexGrow={1} flexShrink={1} overflow="hidden">
        <Text wrap="truncate-end">
          {o.label}
          {o.sub ? <Text dimColor>{` · ${o.sub}`}</Text> : null}
        </Text>
      </Box>
      {o.value ? (
        <Box flexShrink={0}>
          <Text tabular {...(o.valueColor ? { color: o.valueColor } : { dimColor: true })}>
            {o.value}
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}

/** A colour swatch as the Context panel's legend draws one: a small rounded square. */
export function gSwatch(k: Kit, key: string, color: string, alt = 'swatch'): RenderChildren {
  const Svg = svgOf(k)
  if (!Svg) return null
  return <Svg key={key} source={`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" rx="2.5" fill="${color}"/></svg>`} alt={alt} width={10} height={10} />
}

/** A legend row as the Context panel draws one: its swatch, the label, the value right in grey. */
export const gLegend = (k: Kit, o: { key: string; color: string; label: string; value: string }): RenderChildren =>
  gRow(k, { key: o.key, lead: gSwatch(k, `${o.key}-sw`, o.color, o.label), label: o.label, value: o.value })
