// The healkeiser mods' shared components: every pane, band and card draws its
// chrome through these, so a header, a tab, a search bar, a meter and a footer
// look and sit the same in every mod. DESIGN.md says why. The source is
// shared/kit.tsx; each mod keeps a copy written by
// `node scripts/check-style.mjs --write`. Edit shared/, never a mod's copy.
import type { ElementConstructor, EngineInterface, RenderChildren, RenderElement, SvgProps } from 'claude-code'

import { GLYPH, ROLE, cellWidth, heat, heatHex, heatRuns, meter, padCells, sentence, wholePct } from './style'
import { gDivider, gIconButton, gTabs, type IconName } from './app'

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
  /** On a graphical surface: the pointer came onto the icon (true) or left it, for the head's hint. */
  onHover?: (isOver: boolean) => unknown
  node?: RenderChildren
  /** On a graphical surface: the outline icon it is drawn as, an icon button as the app's panels head theirs. */
  icon?: IconName
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
      <Box key="kit-header" flexDirection="column" gap="sm" flexShrink={0}>
      <Box key="kit-header-row" flexDirection="row" alignItems="center" gap="sm" flexShrink={0}>
        <Box flexShrink={0}>
          <Text dimColor>{sentence(o.title)}</Text>
        </Box>
        {o.detail ? (
          <Box flexShrink={1} overflow="hidden">
            <Text wrap="truncate-start">{o.detail}</Text>
          </Box>
        ) : null}
        {o.status ?? null}
        <Box flexGrow={1} />
        {o.hint ? (
          <Box key="kit-hint" flexShrink={1000} overflow="hidden">
            <Text dimColor wrap="truncate-end">{o.hint}</Text>
          </Box>
        ) : null}
        <Box flexDirection="row" alignItems="center" gap="xs" flexShrink={0}>
          {actions.map(a =>
            a.icon
              ? gIconButton(k, { key: a.id, icon: a.icon, label: a.label, ...(a.isOn ? { isOn: true } : {}), ...(a.onHover ? { onHover: a.onHover } : {}), onPress: a.onPress ?? (() => undefined) })
              : (a.node ?? <Button key={a.id} label={a.label} {...(a.isOn ? { variant: 'primary' as const } : {})} onPress={a.onPress ?? (() => undefined)} />),
          )}
        </Box>
      </Box>
      {gDivider(k, 'kit-header-rule')}
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
  if (!k.isTerm) return gTabs(k, o)
  return (
    <Box key="kit-tabs" flexDirection="row" columnGap={SPACE.gap} flexShrink={0}>
      {o.items.map(t => {
        const isActive = t.id === o.active
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
  // A graphical surface: its own Input, alone, the count beside it. The Input keeps a width of its own
  // and takes no icon; a field drawn round it shows the Input's edge as a second box, so none is.
  if (!k.isTerm) {
    return (
      <Box key={`${id}-bar`} flexDirection="row" alignItems="center" gap="sm" flexShrink={0} marginBottom="sm">
        <Input
          key={id}
          placeholder={sentence(o.placeholder)}
          value={o.value}
          {...(o.autoFocus ? { autoFocus: true } : {})}
          onInput={(v: string) => o.onInput(v)}
          onSubmit={(v: string) => o.onSubmit?.(v)}
        />
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
  // A graphical surface: no frame. A section as the app's Environment panel draws one: the title in
  // the text colour, its status right, the rows under it, a hairline closing it off from what follows.
  if (!k.isTerm) {
    return (
      <Box key={o.key} flexDirection="column" gap="xs" paddingX="sm" paddingY="xs">
        {o.title !== undefined ? (
          <Box flexDirection="row" alignItems="center" gap="sm">
            <Box flexShrink={1} overflow="hidden">
              <Text wrap="truncate-end" {...(o.isDim ? { dimColor: true } : {})}>{sentence(o.title)}</Text>
            </Box>
            <Box flexGrow={1} />
            {o.status ? <Box flexShrink={0}>{o.status}</Box> : null}
          </Box>
        ) : null}
        {children}
        {gDivider(k, `${o.key}-rule`)}
      </Box>
    )
  }
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
