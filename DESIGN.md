# Design

One look for the five mods (gloss, pulse, postcard, flightdeck, filetree) and the status line. Each mod carries an identical `hooks/style.ts` with the tokens, glyphs, formatters and motion primitives below. A plugin cannot import from another plugin, so the file is copied; `node scripts/check-style.mjs` fails when the copies drift or a drawn glyph is emoji-capable.

## Colour roles

One meaning per role. Roles name theme keys, never hex, so every mod follows the person's theme (light, dark, colour-blind, `auto`).

| Role | Theme key | Means | Examples |
|------|-----------|-------|----------|
| accent | `claude` | brand, active, running, headers, important | headings, table headers, `Next` box, `[!IMPORTANT]`, the band's spinner, flightdeck's main block, meters under 60% |
| you | `suggestion` | what you wrote or decided | postcard prompt cards, flightdeck's gate block and checks you cleared |
| command | `merged` | slash commands | postcard command cards and their output |
| agent | `planMode` | work delegated away from the main loop | flightdeck agent cards, swimlanes, other loops |
| info | `ide` | notes and advice | `[!NOTE]`, flightdeck's architect |
| success | `success` | done, passed, added | `✓`, `[!TIP]`, task items done, `+3`, checks allowed by a rule |
| warning | `warning` | needs attention soon | `‖ interrupted`, pending checks, `~4`, meters from 60% |
| error | `error` | failed, denied, removed | `✕`, `[!CAUTION]`, `-2`, meters from 80% |
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
| `│` `╭` `╮` `╰` `╯` `┬` `┴` | borders, quote bars, connectors |
| `↗︎` | opens outside (a link to the origin) |
| `⚠︎` | warning callout |
| `ℹ︎` | note callout |
| `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` | the spinner |

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

**Header grammar**, for every label row and rule: `label · detail ──── meta`. The label in its role colour and bold, the separator and rule in chrome, the meta in chrome on the right.

```
GATE · permissions                 141 checks
```

**Spacing**: one blank row under a pane's tab, one row between blocks, `paddingX={1}` inside cards. A pane opens with `backgroundColor: 'transparent'`. Single-line bands put two spaces either side of `·`; cards and headers one.

## Formatting

One formatter per kind, in `style.ts`, and the status line matches them.

| Kind | Form | Examples |
|------|------|----------|
| duration | `1.4s` under 10 s, then whole units, the second padded | `1.4s` `42s` `2m 05s` `3h 12m` `3d 4h` |
| count | plain under 1000, one decimal under 100k, whole above, one decimal from a million | `950` `13.7k` `640k` `1.0M` |
| percentage | whole, right-aligned in 4 cells | `  7%` ` 64%` `100%` |
| reset | `↻` then the two largest units | `↻ 4h 51m` `↻ 3d 22h` `↻ 25m` |
| wall clock | `HH:MM`, a weekday when a day or more out | `21:05` `Thu 14:41` |
| cost | two decimals, whole from $100 | `$12.45` `$140` |
| separator | ` · ` in chrome | `effort high · mode auto` |
| meter | `━` filled in heat, `─` track in chrome | `━━━━━━────  64%` |

Heat, for meters and their percentage: accent under 60%, warning from 60%, error from 80%. The percentage takes the heat too, so a meter never relies on colour alone: the number says it.

Text is measured in terminal cells, not characters: `cellWidth` counts East Asian wide and fullwidth characters and emoji as 2, combining marks and variation selectors as 0, and cuts by grapheme (`Intl.Segmenter`), so a cut never splits a character. Truncation ends with `…` inside the width.

## Readability

- **One bold per block**: the label row. Labels of values are dim, values normal, numbers right-aligned in a fixed column.

  ```
  ctx  ━━━━━━────   64%   640k/1.0M
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
| packets | flightdeck's rails | a `●` head and `•` trail, one cell per tick, one packet per 24 cells |
| fade | pulse's band label, filetree's flash | a new label draws dim for 200 ms, then normal; a flashed row steps down its ramp over 2.7 s |
| glide | flightdeck's meters on graphical surfaces | a new reading glides from the last width on an ease-out over 400 ms, as SVG animation (SMIL), so no tick runs; `glide` in `style.ts` is the same curve for a meter redrawn on a tick. The terminal's text meters step, as a 10-cell bar has no in-between |

- **One tick per mod**: `FRAME_MS = 100` (10 frames a second, a third of the engine's 30-a-second redraw cap). A hooks module runs one `$.clock.every(FRAME_MS)`; a `Client` region ticks on its surface's frame clock with the same `FRAME_MS`. No element starts a timer of its own.
- **Ease, never blink**: positions move on `easeInOut`, intensities fall off on a raised cosine, so nothing switches on and off.
- **Motion stops** when work is idle (the timer is cancelled, not left running), when it finishes (the spinner becomes `✓`), with the mod's `motion: off`, and when Claude Code's **Reduce motion** setting (`/config`) is on. Stilled, a spinner draws `●` in its colour and a shimmer draws its solid colour.

## Options

Same name, same meaning, wherever a mod has the concern.

| Option | Values | Meaning | Mods |
|--------|--------|---------|------|
| `motion` | `while-active` (default), `off` | animate only while work runs, or never | pulse, flightdeck, filetree |
| `glyphs` | filetree: `auto`, `nerd`, `plain`, `text` | which glyph set the pane draws | filetree |
| `palette` | flightdeck: `theme`, `pastel`; filetree: `key=#hex` pairs | theme keys, or fixed colours | flightdeck, filetree |

gloss and postcard draw no motion and take no options. The status line reads `NO_COLOR` (no colour) and `COLUMNS` (its width: it drops the clock, pace and token counts first, then the details, then the header's link and changes, branch and folder; its narrowest form is 25 cells).

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
| flightdeck pane | text meters, rails | SVG meters that glide, SVG swimlanes | same | same | no surface has a dashboard |
| filetree pane | yes | yes, native scroll | - | - | it draws through `Client` regions, which VS Code and mobile do not have |

What a graphical version of a mod's own pane uses, and keeps from the system:

- **Keeps**: the colour roles (as theme keys, or each role's mid-tone hex inside SVG), the glyph meanings, the header grammar, the number beside every meter.
- **Uses instead of terminal tricks**: `Svg` for meters, sparklines and swimlanes in place of `━─` runs; `borderStyle` for frames, never drawn box characters; proportional text, with `mono` and `tabular` only where columns must align; `Button` labels that name the action, since there are no hotkeys in VS Code.

Capabilities the graphical surfaces have and the terminal lacks, for future features:

- `Svg` (desktop, VS Code, mobile), with `isInteractive` for hover, `:hover`, `<title>` tooltips and SMIL animation in a sandboxed frame (desktop).
- Hover groups and reveals: a `hover` with a `scope` on `Box` and `Text` lights every element of the group while one is hovered, across a pane and the transcript.
- Type scale and weights: `size` (`caption` to `title`) and `weight` (`regular` to `bold`); the terminal has one size and draws only bold.
- Native scrolling in a pane, and `Markdown` with `onLinkPress` to catch a link press.
