// The healkeiser mods' shared components: every pane, band and card draws its
// chrome through these, so a header, a tab, a search bar, a meter and a footer
// look and sit the same in every mod. DESIGN.md says why. The source is
// shared/kit.tsx; each mod keeps a copy written by
// `node scripts/check-style.mjs --write`. Edit shared/, never a mod's copy.
import type { ElementConstructor, EngineInterface, RenderChildren, RenderElement, SvgProps } from 'claude-code'

import { GLYPH, ROLE, cellWidth, heat, heatHex, heatRuns, meter, padCells, sentence, wholePct } from './style'

/** The elements a surface draws with, as `$.ui.resolve(e)` returns them. */
export type Els = ReturnType<EngineInterface['ui']['resolve']>

/** What every part draws with: the surface's elements, whether it is a terminal, and whether it draws the heat ramp. */
export type Kit = { els: Els; isTerm: boolean; ramp: boolean; ascii: boolean }

export const kit = (els: Els, surface: string, o: { ramp?: boolean; ascii?: boolean } = {}): Kit => ({
  els,
  isTerm: surface === 'terminal',
  ramp: o.ramp ?? true,
  ascii: o.ascii ?? false,
})

/**
 * The one spacing scale, in rows and cells. A pane: `top` blank rows, the
 * header, `block` blank rows, then tabs or the search bar, then the body.
 */
export const SPACE = { top: 1, block: 1, padX: 1, gap: 1, keys: 2 } as const

// ---------------------------------------------------------------- header

/** A header action: a word or a glyph, lit in the accent while `isOn`. `node` draws it instead (a surface Client). */
export type Action = {
  id: string
  label: string
  isOn?: boolean
  hotkey?: string
  /** A keybinding action (`app:...`) the person's chord presses from the prompt. */
  action?: string
  /** A press; a promise it returns is awaited by the surface. */
  onPress?: () => unknown
  node?: RenderChildren
}

/**
 * A one-glyph button's face: a cell of air a side, so the pointer's target is
 * three cells and the hover highlight centres on the glyph (fonts draw these
 * symbols narrower than their cell). Words stay as they are.
 */
export const iconLabel = (label: string): string => (cellWidth(label) === 1 ? ` ${label} ` : label)

/** The gap between two header actions: none between padded glyphs, `SPACE.gap` beside a word. */
const actionGap = (a: { label: string }) => (cellWidth(a.label) === 1 ? 0 : SPACE.gap)

/** The cells a row of actions takes. */
export const actionsWidth = (actions: readonly Action[]): number =>
  actions.reduce((n, a, i) => n + cellWidth(iconLabel(a.label)) + (i ? actionGap(a) : 0), 0)

function actionNode(k: Kit, a: Action): RenderChildren {
  if (a.node) return a.node
  const { Button, Text } = k.els
  const press = a.onPress ?? (() => undefined)
  const bind = { ...(a.hotkey ? { hotkey: a.hotkey } : {}), ...(a.action ? { action: a.action } : {}) }
  if (!k.isTerm) return <Button key={a.id} label={a.label} {...bind} {...(a.isOn ? { variant: 'primary' as const } : {})} onPress={press} />
  return (
    // A Button drawn with a label draws the label, never its children: children only where they carry a colour.
    a.isOn ? (
      <Button key={a.id} plain {...bind} onPress={press}>
        <Text color={ROLE.accent}>{iconLabel(a.label)}</Text>
      </Button>
    ) : (
      <Button key={a.id} plain {...bind} dimColor label={iconLabel(a.label)} onPress={press} />
    )
  )
}

/**
 * A header's title: bold, in its role colour, no fill. A filled title read as
 * one of Claude Code's own pane tabs, which sit right above it.
 */
export function title(k: Kit, text: string, role: string = ROLE.accent): RenderChildren {
  const { Box, Text } = k.els
  return (
    <Box flexShrink={0}>
      <Text color={role} weight="bold">
        {sentence(text)}
      </Text>
    </Box>
  )
}

/** A rule that fills what its row leaves, cut at its box. On a graphical surface, space. */
export function rule(k: Kit, key: string, role: string = ROLE.chrome): RenderChildren {
  const { Box, Text } = k.els
  if (!k.isTerm) return <Box key={key} flexGrow={1} />
  return (
    // Shrinks a thousand times faster than anything beside it: the rule gives up its room before a detail loses a cell.
    <Box key={key} flexGrow={1} flexShrink={1000} height={1} overflow="hidden" marginX={SPACE.gap}>
      <Text color={role}>{GLYPH.track.repeat(400)}</Text>
    </Box>
  )
}

/**
 * Every pane's first row, and a band card's: the title (never pressable, so no
 * pane's title reacts to the pointer), a detail in
 * chrome, a rule, the actions right. Always exactly one row: a long detail is
 * cut from its start, a hint (a hovered action's words) takes the rule's place
 * and is cut at its end, so nothing ever wraps or moves the row.
 */
export function header(
  k: Kit,
  o: {
    title: string
    role?: string
    detail?: string
    /** Drawn after the detail, before the rule: a status such as `● working`. */
    status?: RenderChildren
    actions?: readonly Action[]
    hint?: string
  },
): RenderChildren {
  const { Box, Text, Button } = k.els
  const role = o.role ?? ROLE.accent
  const actions = o.actions ?? []
  // A graphical surface: as the Environment panel heads itself. The title plain in the text colour, the
  // detail grey beside it, a status, then the actions as the app's own buttons, right. No rule; a hovered
  // action's words stand grey before the actions, cut to the row.
  if (!k.isTerm) {
    return (
      <Box key="kit-header" flexDirection="row" alignItems="center" gap="sm" flexShrink={0}>
        <Text wrap="truncate-end">{sentence(o.title)}</Text>
        {o.detail ? <Text dimColor wrap="truncate-start">{o.detail}</Text> : null}
        {o.status ?? null}
        <Box flexGrow={1} />
        {o.hint ? (
          <Box key="kit-hint" flexShrink={1000} overflow="hidden">
            <Text dimColor wrap="truncate-end">{o.hint}</Text>
          </Box>
        ) : null}
        {actions.map(a => a.node ?? <Button key={a.id} label={a.label} {...(a.isOn ? { variant: 'primary' as const } : {})} onPress={a.onPress ?? (() => undefined)} />)}
      </Box>
    )
  }
  return (
    <Box key="kit-header" flexDirection="row" height={1} overflow="hidden" flexShrink={0}>
      {title(k, o.title, role)}
      {o.detail ? (
        <Box flexShrink={1} marginLeft={SPACE.gap} overflow="hidden">
          <Text color={ROLE.chrome} wrap="truncate-start">
            {o.detail}
          </Text>
        </Box>
      ) : null}
      {o.status ? (
        <Box flexShrink={0} marginLeft={SPACE.gap}>
          {o.status}
        </Box>
      ) : null}
      {o.hint ? (
        <Box key="kit-hint" flexGrow={1} flexShrink={1000} height={1} overflow="hidden" marginX={SPACE.gap} justifyContent="flex-end">
          <Text color={ROLE.chrome} italic wrap="truncate-end">
            {o.hint}
          </Text>
        </Box>
      ) : (
        rule(k, 'kit-rule')
      )}
      {actions.length ? (
        <Box flexDirection="row" flexShrink={0}>
          {actions.map((a, i) => (
            <Box key={`kit-act-box-${a.id}`} flexShrink={0} {...(i && actionGap(a) ? { marginLeft: actionGap(a) } : {})}>
              {actionNode(k, a)}
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  )
}

// ---------------------------------------------------------------- tabs

export type TabItem = { id: string; label: string; hotkey?: string }

/** The cells a row of tabs takes: each pill its label and a cell a side, `SPACE.gap` apart. */
export const tabsWidth = (items: readonly { label: string }[]): number =>
  items.reduce((n, t, i) => n + cellWidth(t.label) + 2 + (i ? SPACE.gap : 0), 0)

/**
 * Tabs read as Claude Code's own pane tabs: the active one inverse and bold,
 * the rest dim, each with a cell of air a side. On a graphical surface,
 * buttons with the active one primary.
 */
export function tabs(k: Kit, o: { items: readonly TabItem[]; active: string | null; onPick: (id: string) => void; role?: string }): RenderChildren {
  const { Box, Text, Button } = k.els
  const role = o.role ?? ROLE.accent
  return (
    <Box key="kit-tabs" flexDirection="row" columnGap={SPACE.gap} flexShrink={0}>
      {o.items.map(t => {
        const isActive = t.id === o.active
        if (!k.isTerm) {
          return <Button key={`tab-${t.id}`} label={sentence(t.label)} {...(isActive ? { variant: 'primary' as const } : {})} onPress={() => o.onPick(t.id)} />
        }
        return (
          <Button key={`tab-${t.id}`} plain {...(t.hotkey ? { hotkey: t.hotkey } : {})} onPress={() => o.onPick(t.id)}>
            {isActive ? <Text inverse weight="bold">{` ${sentence(t.label)} `}</Text> : <Text dimColor>{` ${sentence(t.label)} `}</Text>}
          </Button>
        )
      })}
    </Box>
  )
}

// ---------------------------------------------------------------- search

/**
 * The search bar: a rounded card, three rows, the border lit in the accent
 * while it holds a query, `⌕` before the field, the match count and a clear
 * button after it. Null where the surface has no field (mobile).
 */
export function search(
  k: Kit,
  o: {
    id?: string
    value: string
    placeholder: string
    onInput: (v: string) => void
    onSubmit?: (v: string) => void
    submitLabel?: string
    autoFocus?: boolean
    /** Shown dim at the right while there is a query: `3 of 12`. */
    count?: string
    onClear?: () => void
    /** No border: the bar is one row (filetree's `spacing: off`). */
    isBare?: boolean
  },
): RenderChildren {
  if (!('Input' in k.els)) return null
  const { Box, Text, Button, Input } = k.els
  const id = o.id ?? 'search'
  const isLive = o.value !== ''
  // A graphical surface draws its own field: no frame, no glyph, the count beside it.
  if (!k.isTerm) {
    return (
      <Box key={`${id}-bar`} flexDirection="row" alignItems="center" gap="sm" flexShrink={0}>
        <Box flexGrow={1}>
          <Input
            key={id}
            placeholder={sentence(o.placeholder)}
            value={o.value}
            submitLabel={sentence(o.submitLabel ?? 'jump')}
            {...(o.autoFocus ? { autoFocus: true } : {})}
            onInput={(v: string) => o.onInput(v)}
            onSubmit={(v: string) => o.onSubmit?.(v)}
          />
        </Box>
        {isLive && o.count ? <Text dimColor size="footnote">{o.count}</Text> : null}
      </Box>
    )
  }
  return (
    <Box
      key={`${id}-bar`}
      flexDirection="row"
      flexShrink={0}
      {...(o.isBare ? {} : { borderStyle: 'round' as const, borderColor: isLive ? ROLE.accent : ROLE.chrome, paddingX: SPACE.padX })}
    >
      {k.ascii ? null : <Text color={isLive ? ROLE.accent : ROLE.chrome}>{'⌕ '}</Text>}
      <Box flexGrow={1}>
        <Input
          key={id}
          placeholder={o.placeholder}
          value={o.value}
          submitLabel={o.submitLabel ?? 'jump'}
          {...(o.autoFocus ? { autoFocus: true } : {})}
          onInput={(v: string) => o.onInput(v)}
          onSubmit={(v: string) => o.onSubmit?.(v)}
        />
      </Box>
      {isLive && o.count ? (
        <Box flexShrink={0} marginLeft={SPACE.gap}>
          <Text color={ROLE.chrome}>{o.count}</Text>
        </Box>
      ) : null}
      {isLive && o.onClear ? (
        <Box flexShrink={0} marginLeft={SPACE.gap}>
          <Button key={`${id}-clear`} plain dimColor label="×" onPress={o.onClear} />
        </Box>
      ) : null}
    </Box>
  )
}

// ---------------------------------------------------------------- meters

/** A reading's colour: its heat-ramp step where the surface draws the ramp, else the three role steps. */
export const pctColor = (k: Kit, pct: number): string => (k.ramp || !k.isTerm ? heatHex(pct) : heat(pct))

/** A fill meter of `cells` as text: each lit cell its heat step, the track unlit. */
export function bar(k: Kit, pct: number, cells: number): RenderChildren {
  const { Text } = k.els
  if (k.ramp) return <Text>{heatRuns(pct, cells).map(run => <Text color={run.color}>{run.text}</Text>)}</Text>
  const m = meter(pct, cells)
  return (
    <Text>
      <Text color={heat(pct)}>{m.fill}</Text>
      <Text color={ROLE.chrome}>{m.track}</Text>
    </Text>
  )
}

/**
 * A progress meter of `cells`: how much of a whole is done, the fill in `role`
 * (the accent by default; success once all is done), the track in chrome. The
 * same `━` and `─` as every meter, never a row of dots: done and to do read as
 * one bar. The count beside it says the number.
 */
export function progress(k: Kit, done: number, total: number, cells: number, role: string = ROLE.accent): RenderChildren {
  const { Text } = k.els
  const m = meter(total > 0 ? (100 * done) / total : 0, cells)
  return (
    <Text>
      <Text color={total > 0 && done >= total ? ROLE.success : role}>{m.fill}</Text>
      <Text color={ROLE.chrome}>{m.track}</Text>
    </Text>
  )
}

/** A reading as shown, right-aligned in 4 cells, in its heat: a meter never relies on colour alone. */
export function pct(k: Kit, value: number): RenderChildren {
  const { Text } = k.els
  return (
    <Text color={pctColor(k, value)} tabular>
      {padCells(`${wholePct(value)}%`, 4, 'right')}
    </Text>
  )
}

// ---------------------------------------------------------------- cards and rows

/**
 * A card: a rounded border in its role colour, `SPACE.padX` inside, its first
 * row the title bold in the role colour with a status on the right.
 */
/** A card's frame as Box props: a rounded border in its role colour, `SPACE.padX` inside. `width` is outside the border. */
export const cardFrame = (role: string, o: { width?: number; isDim?: boolean; isBold?: boolean } = {}) =>
  ({
    flexDirection: 'column',
    borderStyle: o.isBold ? 'bold' : 'round',
    borderColor: role,
    paddingX: SPACE.padX,
    ...(o.width !== undefined ? { width: o.width } : {}),
    ...(o.isDim ? { borderDimColor: true } : {}),
  }) as const

export function card(
  k: Kit,
  o: { key: string; role?: string; title?: string; status?: RenderChildren; width?: number; isDim?: boolean },
  ...children: RenderChildren[]
): RenderChildren {
  const { Box, Text } = k.els
  const role = o.role ?? ROLE.accent
  return (
    <Box key={o.key} {...cardFrame(role, o)}>
      {o.title !== undefined ? (
        <Box flexDirection="row" height={1} overflow="hidden" justifyContent="space-between" columnGap={SPACE.gap}>
          <Text color={role} weight="bold" wrap="truncate" {...(o.isDim ? { dimColor: true } : {})}>
            {sentence(o.title)}
          </Text>
          {o.status ? <Box flexShrink={0}>{o.status}</Box> : null}
        </Box>
      ) : null}
      {children}
    </Box>
  )
}

/**
 * A key hint, read as the engine reads a hotkey button: `o: open`, the key in
 * the accent, the colon and action dim. `hotkey` makes the key press it; `id`
 * is the Button's key (default `key-<key>`).
 */
export type KeyHint = { key: string; label: string; id?: string; onPress?: () => unknown; hotkey?: string; autoFocus?: boolean }

/** The cells a row of key hints takes. */
export const keysWidth = (keys: readonly KeyHint[]): number =>
  keys.reduce((n, x, i) => n + cellWidth(x.key) + 2 + cellWidth(x.label) + (i ? SPACE.keys : 0), 0)

/**
 * The footer: one row, key hints left, a status right that is cut from its
 * start (a path keeps its end). Never wraps.
 */
export function footer(
  k: Kit,
  o: { keys?: readonly KeyHint[]; status?: string; statusLabel?: string; lead?: RenderChildren; left?: RenderChildren },
): RenderChildren {
  const { Box, Text, Button } = k.els
  const keys = o.keys ?? []
  return (
    <Box key="kit-footer" flexDirection="row" height={1} overflow="hidden" flexShrink={0}>
      {keys.length ? (
        <Box flexDirection="row" flexShrink={0} columnGap={SPACE.keys}>
          {keys.map(x => {
            const id = x.id ?? `key-${x.key}`
            const focus = x.autoFocus ? { autoFocus: true as const } : {}
            const press = x.onPress ?? (() => undefined)
            // The engine draws a hotkey button `o: open` itself.
            if (x.hotkey) return <Button key={id} plain dimColor {...focus} hotkey={x.hotkey} label={x.label} onPress={press} />
            if (!x.onPress) {
              return (
                <Text key={id} dimColor>
                  <Text color={ROLE.accent}>{x.key}</Text>
                  {`: ${x.label}`}
                </Text>
              )
            }
            return (
              <Button key={id} plain dimColor {...focus} onPress={press}>
                <Text color={ROLE.accent}>{x.key}</Text>
                {`: ${x.label}`}
              </Button>
            )
          })}
        </Box>
      ) : null}
      {o.left ? <Box flexShrink={0}>{o.left}</Box> : null}
      <Box flexGrow={1} />
      {o.lead ? <Box flexShrink={0} marginLeft={SPACE.keys}>{o.lead}</Box> : null}
      {o.status && o.statusLabel ? (
        <Box flexShrink={0} marginLeft={SPACE.keys}>
          <Text color={ROLE.chrome}>{o.statusLabel}</Text>
        </Box>
      ) : null}
      {o.status ? (
        <Box flexShrink={1} {...(o.statusLabel ? {} : { marginLeft: SPACE.keys })} overflow="hidden">
          <Text color={ROLE.chrome} wrap="truncate-start">
            {o.status}
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}

/** `rows` blank rows (the spacing scale's unit between blocks). */
export function space(k: Kit, key: string, rows: number = SPACE.block): RenderChildren {
  const { Box } = k.els
  return <Box key={key} height={rows} flexShrink={0} />
}

// ---------------------------------------------------------------- the Nerd Font

// fc-list (Linux), then the macOS and Windows font folders (Git Bash paths).
const FONT_SCRIPT =
  'if command -v fc-list >/dev/null 2>&1; then f=$(fc-list ":charset=$1" file | grep -vi lastresort | head -n1 | cut -d: -f1); fi; ' +
  '[ -n "$f" ] || for g in "$HOME"/Library/Fonts/*Nerd* /Library/Fonts/*Nerd* "$HOME"/AppData/Local/Microsoft/Windows/Fonts/*Nerd* /c/Windows/Fonts/*Nerd*; do [ -f "$g" ] && LC_ALL=C grep -aqE "Nerd Fonts (3\\.([2-9]|[1-9][0-9])|[4-9]|[1-9][0-9]+)\\." "$g" && { f=$g; break; }; done; ' +
  '[ -n "$f" ] || { echo missing; exit 0; }; m=$(stat -c %Z "$f" 2>/dev/null || stat -f %c "$f"); p=$PPID; ' +
  'while [ -n "$p" ] && [ "$p" -gt 1 ]; do c=$(ps -o comm= -p "$p" 2>/dev/null); c=$(basename "$c" 2>/dev/null | tr -d " "); case "$c" in ' +
  'ghostty|kitty|alacritty|Alacritty|foot|footclient|wezterm-gui|konsole|gnome-terminal-|xterm|urxvt|st|Terminal|iTerm2) ' +
  'e=$(ps -o etime= -p "$p" 2>/dev/null | awk -F\'[-:]\' \'{n=NF; s=$n+60*$(n-1); if (n>2) s+=3600*$(n-2); if (n>3) s+=86400*$(n-3); print s}\'); [ -n "$e" ] && [ $(( $(date +%s) - e )) -lt "$m" ] && echo stale || echo ok; exit 0;; esac; ' +
  'p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d " "); done; echo ok'
const NERD_PROBE = 'f04eb ebff ebf6 ec01'

// The version FONT_SCRIPT trusts: Nerd Fonts 3.2 or newer has the codicons the header draws.
const NERD_VERSION = /Nerd Fonts (3\.([2-9]|[1-9][0-9])|[4-9]|[1-9][0-9]+)\./
/**
 * Windows has no sh to run FONT_SCRIPT: its user and system font folders are read through
 * $.fs instead, a `*Nerd*` file (Regular first) trusted when its name table says Nerd Fonts
 * 3.2 or newer. Reads stop at the first match, at most four files a folder.
 */
async function windowsNerd($: EngineInterface): Promise<boolean> {
  const local = await $.env.get('LOCALAPPDATA')
  const system = (await $.env.get('SystemRoot')) || 'C:/Windows'
  const dirs = [...(local ? [`${local}/Microsoft/Windows/Fonts`] : []), `${system}/Fonts`]
  for (const dir of dirs) {
    const names = (await $.fs.list(dir).catch(() => []))
      .filter(e => e.kind === 'file' && /nerd/i.test(e.name) && /\.(ttf|otf)$/i.test(e.name))
      .map(e => e.name)
      .sort((a, b) => Number(/regular/i.test(b)) - Number(/regular/i.test(a)))
    for (const name of names.slice(0, 4)) {
      // Text is enough: the version is ASCII in the font's name table; a file over 4 MiB rejects.
      const text = await $.fs.read(`${dir}/${name}`).catch(() => '')
      if (NERD_VERSION.test(text)) return true
    }
  }
  return false
}

async function fontState($: EngineInterface, charset: string): Promise<'ok' | 'stale' | 'missing'> {
  try {
    const out = (await $.process.run(['sh', '-c', FONT_SCRIPT, 'sh', charset], { timeoutMs: 5_000 })).stdout.trim()
    return out === 'stale' || out === 'missing' ? out : 'ok'
  } catch {
    return 'missing'
  }
}

/**
 * Whether a Nerd Font (3.2 or newer, with the codicons) draws here: `ok`, `stale` (installed after
 * the terminal started, which has not loaded it yet) or `missing`. Over SSH the font is the far
 * terminal's, which cannot be asked: `ok`. Read once a session; `glyphs: auto` draws Nerd icons on `ok`.
 */
export async function nerdFont($: EngineInterface): Promise<'ok' | 'stale' | 'missing'> {
  try {
    if ((await $.env.get('SSH_CONNECTION')) || (await $.env.get('SSH_TTY'))) return 'ok'
    if ((await $.env.get('OS')) === 'Windows_NT') return (await windowsNerd($)) ? 'ok' : 'missing'
    return await fontState($, NERD_PROBE)
  } catch {
    return 'missing'
  }
}

// ---------------------------------------------------------------- graphical surfaces

// The desktop app, VS Code and mobile draw in their own type. There a pane is drawn as the app draws its
// own panels, part for part: the Environment panel for sections (a plain title, the same size and weight
// as its rows; rows of one line, an outline icon in a grey column, the label, a grey detail after it, the
// value right; a hairline between sections), Settings > Usage for limits (the name with its reset under
// it, a long thin bar, `97% used` right) and the Context panel for a legend (a rounded colour square, the
// label, the value right). Its colours are the app's own: a usage bar blue, red near its limit, on a faint
// track; icons and details grey. The terminal keeps the parts above.

/** The app's usage colours: its bars' blue, and the red it turns near a limit. */
export const APP = { blue: '#257de0', red: '#dc3c3d', track: '#7f7f7f', icon: '#9c9c9c' } as const

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
} as const
export type IconName = keyof typeof ICON

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

/** A thin bar with round ends, as wide as its box: `segments` (shares of the whole, 0 to 1, each a hex colour) over a faint track. */
export function gBar(k: Kit, o: { key: string; alt: string; segments: readonly { share: number; color: string }[] }): RenderChildren {
  const Svg = svgOf(k)
  if (!Svg) return null
  let x = 0
  const rects = o.segments
    .filter(sg => sg.share > 0)
    .map(sg => {
      const w = Math.max(1.2, Math.min(100 - x, sg.share * 100))
      const r = `<rect x="${x.toFixed(2)}%" width="${w.toFixed(2)}%" height="6" fill="${sg.color}"/>`
      x += w
      return r
    })
    .join('')
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="6"><title>${svgEsc(o.alt)}</title>` +
    `<defs><clipPath id="c"><rect width="100%" height="6" rx="3"/></clipPath></defs>` +
    `<g clip-path="url(#c)"><rect width="100%" height="6" fill="${APP.track}" fill-opacity="0.2"/>${rects}</g></svg>`
  return <Svg key={o.key} source={source} alt={o.alt} height={6} />
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
