# Design

One look for the five mods (gloss, pulse, postcard, flightdeck, filetree) and the status line.

**One source.** `shared/style.ts` holds the tokens, glyphs, formatters and motion primitives below; `shared/kit.tsx` holds the components every pane and band draws its chrome with (Components). A plugin cannot import from another plugin, so each mod carries copies in `hooks/`, written by `node scripts/check-style.mjs --write`. Edit `shared/`, never a mod's copy. Without `--write` the script fails when a copy drifts, when a mod draws its own search field or card frame instead of the kit's, or when a drawn glyph is emoji-capable.

## Components

Every pane and band draws its chrome through `kit.tsx`; a mod draws only its own content.

| Part | Shape | Used by |
|------|-------|---------|
| `header` | One row, never wraps: the **title** (the pane's name, bold in its role colour, no fill: a filled title read as one of Claude Code's own pane tabs just above it, and it is never pressable, so it has no hover state), the detail in chrome (cut from its start), a status, a `─` rule in chrome, the actions right (a lit action is accent, the rest dim). A one-glyph action is three cells (`iconLabel`: a cell of air a side, no gap between them), so the pointer has a wider target and the hover highlight centres on the glyph, which fonts draw narrower than its cell. A hovered action's hint takes the rule's place, cut at its end, so the row never grows or moves. | Files, Prompts, Flightdeck, the Pulse card |
| `tabs` | As Claude Code marks its own pane tabs: the active tab inverse and bold, the others dim, a cell of air a side. Graphical surfaces: buttons, the active one `primary`. | Pulse (folded and unfolded) |
| `search` | A rounded card, three rows: `⌕` and the field, the match count and a `×` clear button while there is a query; the border and `⌕` turn accent while it holds one. | Files, Prompts |
| `bar`, `pct`, `pctColor` | The heat-ramp meter and its right-aligned percentage (Formatting). Every fill meter takes it, flightdeck's context `mix` too: its categories are named in the legend below it, not coloured in the bar. | Pulse, Flightdeck |
| `card`, `cardFrame` | Rounded border in the role colour (`bold` for a viewed one, dimmed for a finished one), `paddingX` 1; `card` adds the title bold in the role colour with a status right. | every card: postcard's prompts and commands, gloss's callouts and `Next`, flightdeck's blocks and agent cards, the Pulse card |
| `footer` | One row: key hints read as the engine draws a hotkey button (`o: open`: the key in the accent, the colon and action dim) left, a lead (Files' activity chip), then a label and a status right, the status cut from its start so a path keeps its end. | Files |

**Pane layout**, the same in every pane, top to bottom: `SPACE.top` (1) blank row, the header, `SPACE.block` (1) blank row, then the search bar, then the tabs, then the body. So a search bar sits on the same rows in every pane, and it filters whichever tab is open (the Prompts pane: your prompts, or Claude's shell commands). A band card without a search bar has its tabs there instead, one blank row under them. The search card's border is its own air: what follows it comes directly.


## Colour roles

One meaning per role. Roles name theme keys, never hex, so every mod follows the person's theme (light, dark, colour-blind, `auto`).

| Role | Theme key | Means | Examples |
|------|-----------|-------|----------|
| accent | `claude` | brand, active, running, headers, important | headings, table headers, `Next` box, `[!IMPORTANT]`, the band's spinner, flightdeck's main block, meters under 60% where the heat ramp cannot draw |
| you | `suggestion` | what you wrote or decided | postcard prompt cards, flightdeck's gate block and checks you cleared |
| command | `merged` | slash commands | postcard command cards and their output |
| agent | `planMode` | work delegated away from the main loop | flightdeck agent cards, swimlanes, other loops |
| info | `ide` | notes and advice | `[!NOTE]`, flightdeck's architect |
| success | `success` | done, passed, added | `✓`, `[!TIP]`, task items done, `+3`, checks allowed by a rule |
| warning | `warning` | needs attention soon | `‖ interrupted`, pending checks, `~4`, meters from 60% where the heat ramp cannot draw |
| error | `error` | failed, denied, removed | `✕`, `[!CAUTION]`, `-2`, meters from 80%, flightdeck's inbox |
| chrome | `subtle`, or `dimColor` | borders, rules, labels, secondary text | code-block rules, table borders, queued cards |
| chip | `userMessageBackground` | the inline-code chip's background | `` `parse.ts` `` in a reply |

Decisions that resolve old double meanings:

- `suggestion` meant both "prompt" and "note". It now means **you** only; notes moved to `ide`.
- `merged` meant both "command" and "important". It now means **command** only; `[!IMPORTANT]` is accent with `◆`.
- The inline-code chip drew its text in `warning`. It now draws in the default text colour on the chip background, so yellow keeps meaning "attention".
- gloss list bullets: accent at the first level, chrome below. The glyph (`•`, `◦`, `■`) carries the depth, not the colour.
- A git branch name draws in plain text in flightdeck and the status line; only its changes (`+2 ~1 -1`) take success, warning and error.

Where a surface cannot take theme keys, fixed colours are allowed and documented:

- flightdeck `palette: pastel`: fixed hex for dark terminals, by the person's choice.
- flightdeck's SVG meters and swimlanes (desktop, VS Code, mobile): each role's mid-tone hex (`svgColor` in `core.ts`), which reads on light and dark.
- The heat ramp of fill meters (see Formatting): the status line's 256-colour ramp, xterm 46 82 118 154 190 226 220 214 208 196 with 239 unlit, as those entries' hex (`HEAT_RAMP`, `HEAT_UNLIT` in `style.ts`). A ramp needs ten fixed steps; a theme has three.
- filetree's activity shimmer and treemap: four-step hex ramps per hue, light and dark sets; a theme key is one colour. The shimmer's hues are filetree's own categorical code for kinds of git action (upstream's), not roles.
- statusline.sh: ANSI. accent is the Claude orange (truecolor `217;119;87`); success, warning and error are the terminal's own green, yellow and red (`32`, `33`, `31`); chrome is bright black (`90`). The terminal's palette then decides light or dark. `NO_COLOR` drops every colour.

## Glyphs

All single-cell, text presentation. A glyph a terminal may draw as a colour emoji (Warp and Windows Terminal do) is drawn only with U+FE0E after it.

| Glyph | Means |
|-------|-------|
| `✓` | done, ok |
| `✕` | failed, denied (never `✗`) |
| `●` | running, live, the reply bullet |
| `○` | pending, idle, an open task |
| `■` | a counted mark (gate checks, legend) |
| `•` `◦` `■` | list bullets by depth |
| `‖` | interrupted, queued |
| `↻` | resets in, refresh |
| `⟲` | compactions |
| `◆` `◇` | important, a step on or off |
| `»` | the next action |
| `…` | cut text |
| `·` | separator |
| `━` `─` | meter fill and track; `─` is also a rule |
| `╸` | half a meter cell, the last lit one |
| `▁▂▃▄▅▆▇█` | sparkline levels, low to high (flightdeck's trends; `glyphs: text` draws `_.:-=+*#`, flightdeck's `SPARK_ASCII`, as `ASCII` in `style.ts` has none) |
| `│` `╭` `╮` `╰` `╯` `┬` `┴` | borders, quote bars, connectors |
| `↗︎` | opens outside (a link to the origin) |
| `⚠︎` | warning callout |
| `ℹ︎` | note callout |
| `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` | the spinner |

**Nerd Font set.** Where a Nerd Font (3.2 or newer) is installed, `glyphs: auto` draws each status glyph above as its Nerd codicon instead (`NERD` in `style.ts`, applied by `glyphTree` over a mod's whole drawing, on the terminal only): check, close, the large filled and outline circles (live and idle the same size), refresh, search, warning, info, link-external, arrow-right, pause, star, arrow-up and -down, archive (compacted), terminal, file and copy for pulse's kinds. Box drawing, meters, list bullets and the spinner stay Unicode: they are structure, and a Nerd Font draws them the same. One detection for all mods (`nerdFont` in `kit.tsx`): `fc-list` or the macOS font folders through `sh`, and on Windows the user and system font folders read through `$.fs`.

Glyphs the mods already use for kinds (pulse's `◇ ⌕ ⌘ ⇣ ⧉`, filetree's file and git icons, `▾ ▴ ▸` for folds) are text-presentation and stay. The lint (`bareEmoji` in `style.ts`, run by `scripts/check-style.mjs` over every hooks file and `statusline.sh`, and by each mod's `style.test.ts` over what it draws) fails on any `Emoji`-property code point not followed by U+FE0E.

## Shapes

**Cards** hold a mod's own block: a prompt, a command's output, a callout, the `Next` line, a flightdeck block.

```
╭──────────────────────────────╮
│ you                          │   borderStyle="round", paddingX={1}
│ Rebase the vfx branch        │   first row: the label, bold, in the role colour
╰──────────────────────────────╯   no background fill
```

**Open blocks** hold content a mouse selection must copy clean: code, file previews, diffs. No side borders.

```
╭─ ts ─────────────────────────── ⧉ copy
const a = 1
╰──────────────────────────────────────
```

**Header grammar**, for a pane's first row (the kit's `header`): `Title detail ──── actions`, the title bold in its role colour. A card's label row keeps `label · detail ──── meta`, the label in its role colour and bold, the separator and rule in chrome, the meta in chrome on the right.

```
Files claude-plugins ───────────────  △  ◎  ↻ 
GATE · permissions                 141 checks
```

**Spacing**: one blank row under a pane's tab; stacked cards sit edge to edge, no blank row between (a pane's rows are few); `paddingX={1}` inside cards. A pane opens with `backgroundColor: 'transparent'`. Single-line bands put two spaces either side of `·`; cards and headers one.

## Capitalisation

One rule everywhere. **Titles are sentence case**: a pane's title (`Files`, `Prompts`, `Flightdeck`), a tab (`Activity`, `Context`, `Turn`, `Git`), a card's label (`You`, `Command`, `Session log`, `Last turn`, `Gate · permissions`), a callout (`Note`, `Tip`). `sentence` in `style.ts` draws them so, and the kit's `header`, `tabs` and `card` and flightdeck's card heads apply it, so a title written in lower case still reads right; a name the person chose in capitals (flightdeck's `gateLabel`) stays as they wrote it. **Everything inside is lower case**: row labels (`ctx`, `5h`, `branch`, `changes`), legends, hints, states (`● working`, `in sync`), button words (`prev`, `edit`, `re-send`), counts (`3 staged`).

## Formatting

One formatter per kind, in `style.ts`, and the status line matches them.

| Kind | Form | Examples |
|------|------|----------|
| duration | `1.4s` under 10 s, then whole units, the second padded | `1.4s` `42s` `2m 05s` `3h 12m` `3d 4h` |
| count | plain under 1000, one decimal under 100k, whole above, one decimal from a million | `950` `13.7k` `640k` `1.0M` |
| percentage | whole, rounded from tenths to the nearest (`wholePct`, as the status line), right-aligned in 4 cells | `  7%` ` 38%` for 37.5, `100%` for 99.6 |
| reset | `↻` then the two largest units | `↻ 4h 51m` `↻ 3d 22h` `↻ 25m` |
| wall clock | `HH:MM`, a weekday when a day or more out | `21:05` `Thu 14:41` |
| cost | two decimals, whole from $100 | `$12.45` `$140` |
| separator | ` · ` in chrome | `effort high · mode auto` |
| meter | `━` filled in half-cell steps (`╸` the half), each lit cell its own heat step, `─` track unlit; above zero, at least half a cell | `━━━━━━╸───  64%` `╸─────────   3%` |

Heat, for fill meters (context, rate limits) and their percentage, is the status line's 256-colour ramp: ten steps from green through yellow and orange to red, xterm 46 82 118 154 190 226 220 214 208 196, the unlit track 239. Each lit cell takes the step of where it sits along the bar (`heatRuns`), so the last lit cell shows the severity; the percentage takes the step of its tens (`heatHex`: 64% is 220). On a graphical surface the lit run is one SVG gradient across those steps, as wide as the reading's share and, above zero, at least half a cell (`meterShare`). Every terminal draws the ramp, as `statusline.sh` does, except consoles known to lack 256 colours (`TERM` `dumb`, `linux`, `vt100`, `ansi`), which get three role colours instead (`heat`); an unset `TERM` (Windows) draws the ramp: accent under 60%, warning from 60%, error from 80%. A meter split by kind (flightdeck's gate) keeps its roles. The percentage always takes the heat too, so a meter never relies on colour alone: the number says it.

Text is measured in terminal cells, not characters: `cellWidth` counts East Asian wide and fullwidth characters and emoji as 2, combining marks and variation selectors as 0, and cuts by grapheme (`Intl.Segmenter`), so a cut never splits a character. Truncation ends with `…` inside the width.

## Readability

- **One bold per block**: the label row. Labels of values are dim, values normal, numbers right-aligned in a fixed column.

  ```
  ctx  ━━━━━━╸───   64%   640k/1.0M
  5h   ━━━━━━━━──   82%   ↻ 4h 51m
  ```

- **Never colour alone**: every status pairs a glyph with its colour (`✓ 1.4s`, `✕`, `‖ interrupted`, `● working`, `○ idle`), and a meter shows its number.
- **Contrast**: chrome is `subtle` or `dimColor` on the default background, never dim text on a tinted fill. The chip uses the theme's own prompt tint with the default text colour, which the theme keeps readable in light and dark.
- **Narrow widths drop the least important first**: links, then change counts, then the branch, then the folder (flightdeck's head); the pace column, then the clock (status line); the right-hand status before the label (every header).

  ```
  Opus 5.5 · claude-plugins ↗ · main +5 ~4   (wide)
  Opus 5.5 · claude-plugins · main           (narrow)
  Opus 5.5                                   (narrowest)
  ```

## Motion

Running work moves; finished work is still. Motion never carries meaning alone: the glyph beside it says the state.

| Primitive | Where | Cadence |
|-----------|-------|---------|
| spinner | pulse's band and Bash rows, filetree's running git action | braille, one frame per tick, one turn a second |
| sweep | filetree's activity shimmer | a soft band (raised-cosine falloff over a four-step ramp) crossing the name with an ease-in-out, about 1.6 s a pass |
| packets | flightdeck's connectors, drawn on the upper block's own bottom edge (one cell in from each side, so its rounded corners stay; at rest the line is the edge itself, in its colour) | a `●` head and `•` trail, one cell per tick, one packet per 24 cells |
| fade | pulse's band label, filetree's flash | a new label draws dim for 200 ms, then normal; a flashed row steps down its ramp over 2.7 s |
| glide | flightdeck's meters and sparklines on graphical surfaces | a new reading glides from the last width (a sparkline bar from its last height) on an ease-out over 400 ms, as SVG animation (SMIL), so no tick runs; `glide` in `style.ts` is the same curve for a meter redrawn on a tick. The terminal's text meters and sparklines step, as a cell has no in-between |

- **One tick per mod**: `FRAME_MS = 100` (10 frames a second, a third of the engine's 30-a-second redraw cap). A hooks module runs one `$.clock.every(FRAME_MS)`; a `Client` region ticks on its surface's frame clock with the same `FRAME_MS`, imported from `style.ts` (a surface module imports its plugin's files like the hooks module does, so it keeps no copies). No element starts a timer of its own.
- **Ease, never blink**: positions move on `easeInOut`, intensities fall off on a raised cosine, so nothing switches on and off.
- **Motion stops** when work is idle (the timer is cancelled, not left running), when it finishes (the spinner becomes `✓`), with the mod's `motion: off`, and when Claude Code's **Reduce motion** setting (`/config`) is on. Stilled, a spinner draws `●` in its colour and a shimmer draws its solid colour.

## Options

Same name, same meaning, wherever a mod has the concern.

| Option | Values | Meaning | Mods |
|--------|--------|---------|------|
| `motion` | `while-active` (default), `off` | animate only while work runs, or never | pulse, flightdeck, filetree |
| `glyphs` | `auto` (default), `plain`, `text`; filetree adds `nerd` | which glyph set the mod draws: `auto` is filetree's Nerd Font icons when a Nerd Fonts 3.2+ font is installed (found by `fc-list` or the macOS font folders through `sh`, and on Windows by reading the user and system font folders through `$.fs`, no shell) and the Unicode set elsewhere, `plain` the Unicode set, `text` ASCII | gloss, postcard, flightdeck, filetree |
| `palette` | flightdeck: `theme`, `pastel`; filetree: `key=#hex` pairs | theme keys, or fixed colours | flightdeck, filetree |
| `heat` | `session` (default), `sessions`, `off` | count Claude's edits per file this session, or also earlier sessions' (halved each new session, bounded), or not at all; drawn as a heat-ramp meter with its count | filetree |

`glyphs: text` swaps every glyph of the vocabulary for a one-cell ASCII stand-in (`ASCII` in `style.ts`: `✓` `v`, `✕` `x`, `●` `*`, `○` `o`, `━` `=`, `─` `-`, `…` `~`, corners `+`, the spinner `|/-\`, and so on), and draws rounded and bold borders `classic`. One cell each, so every width holds. It goes over the mod's whole tree (`asciiTree`), so text a person wrote inside a card is swapped too; code blocks, Markdown and pictures keep theirs. In filetree, `text` turns the header buttons into words. gloss and postcard draw no motion. The status line reads `NO_COLOR` (no colour) and `COLUMNS` (its width: it drops the clock, pace and token counts first, then the details, then the header's link and changes, branch and folder; its narrowest form is 25 cells).

## Graphical surfaces

Desktop, VS Code and mobile already draw the transcript well: proportional type, real code blocks and tables, their own message bubbles and tool rows. The mods never replace a good native drawing with a terminal imitation. Where a mod adds nothing the surface lacks, its hook returns `next(e)`; where it adds something, it layers only that.

| Site | Terminal | Desktop | VS Code | Mobile | Why |
|------|----------|---------|---------|--------|-----|
| gloss replies (`AssistantMessage`) | restyled | native | native | native | the surfaces draw code, tables, lists and quotes well; the restyle exists to fix the terminal's |
| postcard prompts and command output (`UserMessage`, `CommandOutput`) | cards | native | native | native | the surfaces have their own message bubbles; prompts still fill the `/prompts` pane |
| postcard `/prompts` pane | yes | yes | yes | yes | no surface has a prompt index |
| pulse tool rows (`ToolUse`, `ToolResult`, `ToolGroup`) | compact | native | native | native | the surfaces draw tool calls as collapsible rows |
| pulse footer (`TurnDuration`) | yes | - | - | - | the engine raises it on the terminal only |
| pulse band (`AbovePrompt`) | yes | yes | - | - | no surface has it; the engine raises it on the terminal and desktop |
| flightdeck pane | text meters, sparklines, rails | SVG meters and sparklines that glide, SVG swimlanes | same | same | no surface has a dashboard |
| filetree pane | yes | yes, native scroll | - | - | it draws through `Client` regions, which VS Code and mobile do not have |

What a graphical version of a mod's own pane uses, and keeps from the system:

- **Keeps**: the colour roles (as theme keys, or each role's mid-tone hex inside SVG), the glyph meanings, the header grammar, the number beside every meter.
- **Uses instead of terminal tricks**: `Svg` for meters, sparklines and swimlanes in place of `━─` runs; `borderStyle` for frames, never drawn box characters; proportional text, with `mono` and `tabular` only where columns must align; `Button` labels that name the action, since there are no hotkeys in VS Code.

Capabilities the graphical surfaces have and the terminal lacks, for future features:

- `Svg` (desktop, VS Code, mobile), with `isInteractive` for hover, `:hover`, `<title>` tooltips and SMIL animation in a sandboxed frame (desktop).
- Hover groups and reveals: a `hover` with a `scope` on `Box` and `Text` lights every element of the group while one is hovered, across a pane and the transcript.
- Type scale and weights: `size` (`caption` to `title`) and `weight` (`regular` to `bold`); the terminal has one size and draws only bold.
- Native scrolling in a pane, and `Markdown` with `onLinkPress` to catch a link press.
