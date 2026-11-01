<div align="center">

  <img src="https://cdn.simpleicons.org/claude/D97757" alt="Claude" width="96">

  <h3 align="center">claude-plugins</h3>

  <p align="center">
    Claude Code plugins: mods that make the terminal easier to read, and version-pinned documentation skills for VFX and pipeline software.
    <br/><br/>
    <a href="https://claude.com/resources/articles/claude-code-mods"><strong>What are mods?</strong></a>
  </p>

  ##

  <p align="center">
    <!-- Maintenance status -->
    <img src="https://img.shields.io/badge/maintenance-actively--developed-brightgreen.svg?&label=Maintenance">&nbsp;&nbsp;
    <!-- License -->
    <img src="https://img.shields.io/badge/License-MIT-brightgreen.svg?&logo=open-source-initiative&logoColor=white" alt="License: MIT"/>&nbsp;&nbsp;
    <!-- Claude Code version -->
    <img src="https://img.shields.io/badge/Claude%20Code-2.1.299%2B-D97757?&logo=claude&logoColor=white" alt="Claude Code 2.1.299+"/>&nbsp;&nbsp;
    <!-- Last Commit -->
    <img src="https://img.shields.io/github/last-commit/healkeiser/claude-plugins?logo=github&label=Last%20Commit" alt="Last Commit"/>&nbsp;&nbsp;
    <!-- Commit Activity -->
    <a href="https://github.com/healkeiser/claude-plugins/pulse" alt="Activity">
      <img src="https://img.shields.io/github/commit-activity/m/healkeiser/claude-plugins?&logo=github&label=Commit%20Activity"/></a>&nbsp;&nbsp;
    <!-- GitHub stars -->
    <img src="https://img.shields.io/github/stars/healkeiser/claude-plugins" alt="GitHub Stars"/>
  </p>

</div>



<!-- TABLE OF CONTENTS -->
## Table of Contents

- [About](#about)
- [Installation](#installation)
- [Usage](#usage)
  - [gloss](#gloss)
  - [pulse](#pulse)
  - [postcard](#postcard)
  - [flightdeck](#flightdeck)
  - [filetree](#filetree)
  - [Status line](#status-line)
- [Dev skills](#dev-skills)
- [Documentation skills](#documentation-skills)
- [Security](#security)
- [Development](#development)
- [Credits and inspiration](#credits-and-inspiration)
- [License](#license)
- [Contact](#contact)



<!-- ABOUT -->
## About

Five [mods](https://claude.com/resources/articles/claude-code-mods) for [Claude Code](https://claude.com/claude-code): small TypeScript modules that redraw parts of its terminal interface. Each one works on its own, so install only the ones you want.

| Mod | What it changes |
|-----|-----------------|
| **gloss** | Claude's replies: open-sided code blocks with a copy button, theme-aware inline-code chips, nested lists and task items, quote bars, rules, strikethrough, coloured diffs, rounded tables, accented headings, callouts, and a highlighted `Next:` line |
| **pulse** | A band above the prompt: the turn while Claude works, the context, prompt cache, last turn and git at a glance while it waits, unfolding into tabs; the folded tool rows, compact shell command rows, and the footer that closes each turn |
| **postcard** | Your own prompts: a blue card per prompt, a purple card per slash command, a grey card while one is queued, and a `/prompts` pane to jump back to any of them |
| **flightdeck** | A live dashboard pane beside the transcript: the main model's vitals, an on-call architect, every permission check, subagent cards and swimlanes, the turn receipt and a session log. A restyled fork of [Flightdeck](https://github.com/scasella/claude-flightdeck) |
| **filetree** | An IDE-style file tree pane: what Claude reads, writes and changes, git status, previews, a treemap and diffs. A restyled fork of [data-goblin/claude-code-filetree](https://github.com/data-goblin/claude-code-filetree) |

A matching [status line](#status-line) script comes alongside. It is not a mod, so it installs on its own.

All five and the status line share one design: the same colour roles, glyphs, card shapes, number formats and motion, written down in [DESIGN.md](./DESIGN.md). Where Claude Code's desktop app, VS Code extension or mobile app already draws a part well (replies, prompts, tool rows), the mods leave it to them and change only the terminal.

The repository also ships [documentation skills](#documentation-skills): each one gives Claude a local, searchable copy of one software release's official docs.



<!-- INSTALLATION -->
## Installation

Add this repository as a plugin marketplace, then install the mods you want at user scope:

``` shell
claude plugin marketplace add healkeiser/claude-plugins
claude plugin install gloss@healkeiser --scope user
claude plugin install pulse@healkeiser --scope user
claude plugin install postcard@healkeiser --scope user
claude plugin install flightdeck@healkeiser --scope user
claude plugin install filetree@healkeiser --scope user
```

Run `/reload-plugins` in a session that is already open; new sessions load them by themselves.

> [!IMPORTANT]
> Mods need Claude Code **2.1.299** or later.



<!-- USAGE -->
## Usage

### gloss

Redraws each block of Claude's reply that has something to gain; plain prose keeps Claude Code's own look.

- **Code blocks** draw between a top rule, carrying their language and a `⧉ copy` button, and a bottom rule, with no side border, so a mouse selection copies the code alone. Past 20 lines they fold to 12 with a `▾ show all N lines` button.
- **Inline code** becomes a chip on the theme's own prompt tint, in the normal text colour, so it reads on light and dark themes alike, `auto` included.
- **Lists** change bullet by depth (`•`, `◦`, `■`; the first level in Claude orange, deeper ones dim) and hang wrapped lines under the item's text; numbered items keep their numbers. Task items `- [ ]` and `- [x]` draw as `○` and a green `✓`.
- **Quotes** that are not callouts draw with a dim `│` bar on every line, one per nesting level, rather than a box.
- **Rules** (`---`, `***`, `___` alone on a line) draw as a dim line across the window.
- **Strikethrough** (`~~text~~`) draws struck through.
- **Diff fences** (` ```diff `) draw in red and green, a hunk header added when the fence has none.
- **Tables** draw in a rounded border with a bold header row; a table too wide for the window narrows its widest column and wraps it. Widths are counted in terminal cells, so Chinese, Japanese and Korean text and emoji keep the borders straight.
- **Headings** (`##` lines and bold-only lines such as `**What changed:**`) draw in the accent colour with a rule under them.
- **Callouts** (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`) get their own colour and icon: `ℹ` blue, `✓` green, `◆` orange, `⚠` yellow, `✕` red.
- A paragraph opening with **`Next:`** draws in its own box, led by `»`, so the action a reply ends on is easy to spot.
- In the desktop app, VS Code and on mobile, replies keep Claude Code's own drawing, which already does all of this.
- Option (in `/plugin`, or `pluginConfigs` under `gloss@healkeiser`): `glyphs` (`auto`, `plain`, `text`). `text` draws ASCII stand-ins (`v`, `x`, `*`, `+-|` borders) for a terminal or font that cannot show the Unicode ones.

### pulse

- A band sits above the prompt, folded to one row. While a turn runs it reads `⠹ editing parse.ts  ·  3 tools  ·  42s`: a spinner, the current action (fading in as it changes), the tool count and the elapsed time. Between turns it reads the last turn (`✓` and how long it took, its tool count and what it cost), the context window as a small meter with its percentage, and how long the prompt cache still holds the conversation, `cache ↻ 4m 12s`, which warms from green to red as it runs out and reads `○ expired` once it has. Tab buttons and `▴` on the right unfold it. On a narrow terminal the tabs leave first, then the cost, the tool count, the cache and the context meter; the row never wraps.
- Unfolded, the band is a card with four tabs. `1` to `4` pick one once the band has the focus (`ctrl+x tab`, or a click); the open tab's key, or `▾`, folds it again. **activity** lists the turn's tool calls, each with a spinner, `✓` and how long it took, or `✕`. **context** has meters for the context window, the 5-hour and 7-day limits with their reset times, and the prompt cache's countdown. **turn** has the turn's duration, its tools by kind, the files it edited, its errors and its cost beside the session's. **git** has the branch and the counts of added, modified and deleted files. The open tab and whether the band is unfolded are remembered across sessions.
- Meters use the status line's colour ramp, green to red, one colour per cell, with the percentage in the colour of its tenth; a terminal without 256 colours gets the three role colours instead.
- The cache countdown starts at the end of a turn that read or wrote the prompt cache. Claude Code does not say which lifetime the API gave the cache, so pulse takes an hour on a subscription (a session that reports rate limits) and five minutes with an API key, and follows `FORCE_PROMPT_CACHING_5M`, `ENABLE_PROMPT_CACHING_1H` and `DISABLE_PROMPT_CACHING` when they are set. It redraws once a second; nothing else in the band moves between turns.
- In the desktop app the band draws its meters as SVG that glide to a new reading, lights a row's details under the pointer (a meter's tooltip says it in words) and has wider buttons named for their tabs.
- `/pulse band off` hides the band for the session, `/pulse band on` brings it back and `/pulse band toggle` switches. Bands from other mods stay below it, and a survey takes its place while it runs.
- Folded tool rows read `◇ 3 reads  ·  ⌕ 2 searches  ·  ⌘ 1 shell`, dim, with failures in red.
- The footer of a turn that used tools reads `✻ Baked for 29s  ·  6 tools  ·  2 files edited`.
- A shell command that stands on its own row draws in three short lines:

  ```
  ● Rebase the vfx branch onto main                          ✓ 1.4s
    $ cd ~/…/claude-plugins-vfx && git show main:.claude-plugin/marketpl…
    └ bb43e7c feat(vfx): bundle the documentation skills into one vfx…  +3 lines
  ```

  The headline is Claude's own description of the command. On the right, a spinner while it runs, then `✓` and how long it took (wall time, a permission prompt included), `✕` in red when it failed, `‖ interrupted` when it was cut short. The command line is dim and fits one line: the home folder reads `~`, middle folders collapse when it is too long, and a heredoc shows its first line. The last line previews the first line of output (stderr in red when stdout is empty) and counts the rest. A failed command keeps Claude Code's own error block under the row. `ctrl+o` shows the full drawing. The desktop app, VS Code and mobile keep their own tool rows.
- Options (in `/plugin`, or `pluginConfigs` under `pulse@healkeiser`): `band` (`on`, `off`): off hides the band until `/pulse band on`. `motion` (`while-active`, `off`): off, nothing spins, and the time and the cache countdown still count; Claude Code's **Reduce motion** setting stills it too. `glyphs` (`auto`, `plain`, `text`): text draws the band in ASCII stand-ins with a classic border, for a font that lacks the glyphs.

### postcard

- Each prompt you send draws as a blue card, so your messages stand out when you scroll.
- Each slash command you run (`/diff`, `/theme`, a skill) draws its output as a purple card headed by the command. The line you typed stays as the engine draws it: mods cannot restyle it, and a command that prints nothing has no card.
- A fenced code block in a prompt draws as a grey box inside the card, with its language and syntax colours.
- A prompt sent while Claude is still working draws as a narrow grey `‖ queued` card until it reaches the model. A queued slash command stays queued until the turn ends, which is when Claude Code runs it.
- `/prompts` opens a pane listing your prompts, newest first. Pick one to scroll the transcript back to it; `1` to `9` reach the nine newest.
- It ships a `postcard` theme, built on the dark theme, that turns the input box border the same blue as the cards. Pick it in `/theme`.
- The cards are drawn in the terminal; the desktop app, VS Code and mobile keep their own message bubbles, and `/prompts` works there too.
- Option (in `/plugin`, or `pluginConfigs` under `postcard@healkeiser`): `glyphs` (`auto`, `plain`, `text`). `text` draws ASCII stand-ins and `+-|` card borders.

> [!NOTE]
> Clicking a button (copy, fold, a row of the `/prompts` pane) needs Claude Code's fullscreen layout, where the terminal reports clicks. The pane's hotkeys work either way.

### flightdeck

A pane that follows the session as it runs, built on [Flightdeck](https://github.com/scasella/claude-flightdeck) 0.5.1 by Stephen Casella (MIT) and redrawn in the look of the other mods: full rounded blocks like postcard's cards, a main block that reads like the status line, and pulse's `✓ 1.4s` timing. The pane asks for a transparent backdrop, so your terminal's own background shows through, and keeps a blank row above its first line.

```
╭────────────────────────────────────────────────────────────╮
│ Opus 5.5 · claude-plugins ↗ · main ~2            ● working │
│ ctx  ━━━━━━╸───   64%   640k/1.0M                          │
│ 5h   ━━━━━━━━──   82%   ↻ 4h 51m   21:05                   │
│ 7d   ━━━━──────   40%   ↻ 3d 22h   Thu 14:41               │
│ effort high · mode auto · 12 req · $12.45 · ttft 1.2s      │
╰────────────────────────────────────────────────────────────╯
──────────────────────────────────────────────────────────────
╭────────────────────────────────────────────────────────────╮
│ GATE · permissions                              141 checks │
│ all  ━━━━━━━━━━   141                                      │
│ 115 allowed · 0 you · 26 pending · 0 denied                │
│ file 40  shell 80  other 21                                │
╰────────────────────────────────────────────────────────────╯

╭────────────────────────────────────────────────────────────╮
│ agents · 1 running · 2 total                    1-2 expand │
│ ──────────────┬────────────────────────────┬────────────── │
│ ╭──────────────────────────╮ ╭──────────────────────────╮  │
│ │ 1: Write the loader      │ │ 2: Map every call site   │  │
│ │ tests                    │ │                          │  │
│ │ general-purpose          │ │ Explore                  │  │
│ │ ctx 124k · out 900 · 6…  │ │ ctx 40k · out 2k · 3 st  │  │
│ │ ● running 0:42           │ │ ✓ done 0:30              │  │
│ ╰──────────────────────────╯ ╰──────────────────────────╯  │
╰────────────────────────────────────────────────────────────╯
```

- **Blocks**: main (the status line's header: the folder and its origin as links, the branch and its `+added ~modified -deleted` counts, zeros left out; then its meters for context and each rate limit, with the time to each reset and its wall-clock time, then effort, mode, requests, cost and time to first token), architect (consult timeline, inferred moment, last advice), gate (one meter split by allowed, cleared, pending and denied, the counts, then a drill-down per file, shell and other), agents (cards of 26 columns or more, or swimlanes when they don't fit), other loops, the turn receipt and the session log. Each block is a rounded box in its own colour, its label on the first row; a finished card's border dims and the card you are viewing draws bold. A block with nothing to show stays hidden.
- Blocks sit one row apart. While work flows, packets run along that row from main to the architect, gate and turn blocks, and along the row that fans out to the cards; `motion: off`, or Claude Code's **Reduce motion** setting, keeps them still.
- The context and rate-limit meters use the status line's heat ramp, each lit cell its own step from green to red and the percentage in the step of its tens, in terminals with 256 colours or more; elsewhere they take three colours (orange, yellow from 60%, red from 80%).
- Colours follow the shared roles: the main block in Claude orange, agents and loops in the agent colour, the architect in the info colour, the gate in the colour of your own prompts, with checks allowed by a rule green, pending yellow and denied red.
- In the desktop app, VS Code and on mobile the meters are drawn as SVG bars that glide to each new reading, the heat meters filled with the ramp as a gradient, and the agents get an SVG time axis.
- Status glyphs are plain text (`✓ ✕ ● ○ ■`), never ones a terminal such as Warp draws as colour emoji, and each takes the colour of the words it marks.
- Inline above the prompt it draws an 8-row summary; docked it takes one column, or two from 110 columns.
- `/flightdeck` opens it, `/flightdeck close|reset|layout auto|compact|wide|mini` does the rest. Focus the pane (`ctrl+x tab`), then `1` to `6` expand a card and `f`, `s`, `o` open the gate's rows.
- Options (in `/plugin`, or `pluginConfigs` under `flightdeck@healkeiser`): `architectPattern`, `architectLabel`, `gateLabel`, `panels`, `motion`, `moments`, `matchDescriptions`, `maxCards`, `paneColumns`, `layout`, `palette` (`theme` follows your theme's colours; `pastel` is upstream's fixed set for dark terminals), `glyphs` (`auto`, `plain`, `text`: ASCII stand-ins and `+-|` borders), `openOnStart`, `statusLine`.
- `statusLine` is off by default, so it leaves your own status line alone; turn it on for a `ctx 36% · agents 1/3 · denied 2` entry.

Credit: Flightdeck is © 2026 Stephen Casella, with contributions from Alejandro Remior, @vihrea1337 and others listed in its changelog. See [`flightdeck/NOTICE`](./flightdeck/NOTICE) and [`flightdeck/LICENSE`](./flightdeck/LICENSE).

### filetree

`filetree` is a fork of [data-goblin/claude-code-filetree](https://github.com/data-goblin/claude-code-filetree) 0.5.4 by Kurt Buhler (MIT), restyled to match the mods above. It is an IDE-style file tree in a pane beside the chat that shows what Claude reads, writes and changes. Every feature, keyboard shortcut, setting and platform branch (Windows, macOS, Linux) comes from upstream; the credits for its contributors are in [`filetree/ACKNOWLEDGEMENTS.md`](./filetree/ACKNOWLEDGEMENTS.md).

``` shell
claude plugin install filetree@healkeiser --scope user
```

- **The tree** shows the working folder, or one pinned with `/filetree <path>`, with search across folders not yet opened. Each file and folder carries its git status and line counts; the branch row under the header shows the branch, its upstream and how far ahead or behind it is.
- **Claude's activity** shimmers in the tree: reads in purple, writes in orange, commits and other git actions in green. Collapsed folders open to show the file, and the last action stays as a chip at the bottom of the pane. The `motion` option (`while-active`, `off`), or Claude Code's **Reduce motion** setting, holds each name at its colour instead.
- **The split preview** (`p`) shows the file under the cursor (highlighted code, rendered Markdown, images, video frames, PDF and Word pages turned with `[` and `]`) or a treemap of the folder, sized by bytes or by lines.
- **`d`** shows the diff of a file, or of every changed file in a folder. Files open in their default app, in an editor in a tmux or herdr pane, or in any command set in the plugin options.
- `/filetree` shows or hides the pane; `/filetree open` opens it without hiding it. `?` lists the shortcuts.

What the restyle changes from upstream:

- **Colours** are Claude theme keys rather than ANSI palette indices, so the pane follows light, dark and `auto` themes: Claude orange for the accent, green, yellow, blue and red from the theme for git status, and the prompt tint behind the selected row.
- **Headers** read as compact headings: the folder name in orange, a dim rule across the rest of the row, and the header toggles drawn orange while they are on and dim while they are off. The root row, when picked, reads as a chip instead of a half-row fill.
- **Motion** runs on the same clock as the other mods: the shimmer glides across a name and fades rather than blinking.
- **The split preview** draws like a code block: a labelled rule above with the file name and line range, a plain rule below, and no side border. The scrollbar is a thumb with no track line, so a mouse selection of a preview or a path copies text, not borders.
- **Diffs** head each file with a labelled rule.

The `Palette` option still overrides any colour with a hex value. Two things keep upstream's fixed colours, because a theme key cannot express them: the activity shimmer, which needs a light and a dark four-step ramp per colour, and the treemap, which paints pixels and so works from RGB values of the theme's colours.

> [!IMPORTANT]
> `filetree` needs Claude Code **2.1.306** or later. In the terminal it shows in the right sidebar, which needs the fullscreen layout (`/tui fullscreen`) and a window at least **110 columns** wide. It also draws in the desktop app; VS Code and mobile cannot show it, as it draws through surface modules they do not run.




### Status line

`statusline/statusline.sh` draws the status line as a rounded card: the model, the folder, the branch and its uncommitted changes, then one bar each for the context window and the 5-hour and 7-day limits, with their reset time and pace.

```
╭─ Opus 5.5 · claude-plugins ↗ · main +5 ~4 ──────────╮
│ ctx  ━━━━──────   42%     18m 04s  ↑ 13.7k ↓ 2.1k  │
│ 5h   ━━━━━━────   61%   ↻ 2h 12m   17:26      1.1× │
│ 7d   ━━━━━━━━━─   96%   ↻ 3d 5h    Sat 21:00  1.8× │
╰────────────────────────────────────────────────────╯
```

Each bar is a heat ramp, one step per tenth from green through yellow and orange to red, each lit cell in its own step, so the last lit cell shows how close the limit is; the percentage takes the colour of its own tenth. The unlit track is a dim grey. The pace compares how fast a limit is being used with how much of its window has passed: `1.0×` finishes the window right at 100%, and above that it turns yellow, then red at `1.5×`.

The ramp suits a dark background by default. Set `STATUSLINE_THEME=light` for darker, more saturated steps that keep at least 3:1 contrast on white, with a lighter track; `auto`, the default, picks light when `COLORFGBG` reports a white background. The other colours are the terminal's own green, yellow, red and grey, and Claude orange for the model. Set `NO_COLOR` to drop every escape code, the folder and repository links included.

When Claude Code passes `COLUMNS`, the card fits it: the wall clock, pace and token counts go first, then the reset times, and the header drops the link and changes, then the branch, then the folder. Below the narrowest card, about 25 columns, it falls back to one line: the model and the context percentage in its heat colour.

The git status and origin URL are cached for 5 seconds per folder in the temp directory, so frequent refreshes do not run git each time; changing folder reads git afresh, and an unwritable temp directory only turns the cache off.

Copy the script into `~/.claude/` and point `statusLine` at it in `~/.claude/settings.json`:

``` json
"statusLine": {
  "type": "command",
  "command": "bash ~/.claude/statusline.sh"
}
```

> [!IMPORTANT]
> The script needs `bash` 4.2 or later, `jq` and `git`. On Windows, Git Bash brings all of them except `jq`; on macOS, the system `bash` is 3.2, so install a newer one.



<!-- DEV -->
## Dev skills

The `dev` plugin holds coding-convention skills, shown as `dev:<skill>`.

| Skill | What it covers |
|-------|----------------|
| `dev:python` | Python conventions: package layout, type hints, docstrings, imports, comments, formatting (ruff/black), `pyproject.toml`, tests |

``` shell
claude plugin install dev@healkeiser --scope user
```



<!-- SKILLS -->
## Documentation skills

The `vfx` plugin holds one skill per release of each piece of software, named `<software>-<version>` (Kitsu's docs have no versions, so its skill is plain `kitsu`), so they all show up as `vfx:<skill>`. Each skill tells Claude how to search and cite that release's official docs, and ships a crawler that builds a local Markdown copy of them.

| Skill | Sources |
|-------|---------|
| `vfx:openusd-26-11` | openusd.org 26.11 (user docs and API guide pages), the USD Survival Guide |
| `vfx:unreal-5-8` | Unreal Engine 5.8 documentation (without the generated API reference) |
| `vfx:rez-3-4` | rez 3.4.0: user guide, `rez-*` CLI pages, Python API |
| `vfx:deadline-10-4` | Deadline 10.4 User Manual, Scripting Reference, Standalone Python Reference |
| `vfx:blender-5-2` | Blender 5.2 LTS manual and Python API, Blender developer docs |
| `vfx:houdini-22` | Houdini 22.0 help (nodes, VEX, HOM, Solaris, Karma, PDG…) and the HDK guide pages |
| `vfx:cinema4d-2027` | Cinema 4D 2027 user manual and Python SDK 2027.0.0 |
| `vfx:kitsu` | Kitsu developer docs (Zou, gazu, integrations, self-hosting) and the Zou REST API from its OpenAPI spec; unversioned, the crawl records the Zou and gazu versions |

``` shell
claude plugin install vfx@healkeiser --scope user
```

The docs themselves are not in this repository: they belong to their publishers. A skill builds its copy the first time it is used, into the plugin's data folder (`~/.claude/plugins/data/`), where it survives plugin updates. Uninstalling the plugin deletes it unless you pass `--keep-data`. Each crawler fetches exactly its release and refuses any other version.

Requirements: [uv](https://docs.astral.sh/uv/) for the crawlers. `rez-3-4` also needs `git`, because it builds the docs from the rez release tag. `houdini-22` builds its help from an installed Houdini 22.0 (sidefx.com's robots.txt disallows crawling the versioned docs), found via `$HFS` or SideFX's default install path.



<!-- SECURITY -->
## Security

Mods are not sandboxed: they run with the same access to your machine as Claude Code itself. gloss and postcard only draw and count; neither runs a command, reads your files, or makes a network call. pulse draws and counts too, and runs one read-only git command in the session folder for its band's git tab, `git status --porcelain=v2 --branch` (by argument vector, no shell, with `--no-optional-locks`), at start, a second after a Bash, PowerShell, Edit or Write call and at the end of each turn; it reads the session's own usage figures and a few environment variables (the prompt cache switches above, and `COLORTERM`, `TERM` and `WT_SESSION` for the colour depth) through the mod API, and makes no network call. flightdeck runs two read-only git commands in the session folder, `git status --porcelain=v2 --branch` and `git remote get-url origin` (by argument vector, no shell, with `--no-optional-locks` so it never takes the index lock), at start, on a change of folder, a second after a Bash, Edit or Write call and at the end of each turn; it writes nothing and makes no network call. It also reads the session's own usage figures through the mod API and redacts credentials from the tool inputs it keeps for the gate. Read `hooks/` before installing, as you would for any plugin.

`filetree` does more than draw: it lists and reads files under the folder it shows, runs `git` for status and diffs, local converters such as `ffmpeg`, `pdftoppm` and `soffice` for previews when they are installed, and opens files in the programs its options name. It makes no network call of its own.

The `vfx` skills run no hooks. Their crawlers make network requests to the docs sites listed above and write only inside the plugin's data folder.



<!-- DEVELOPMENT -->
## Development

Each mod is a plugin folder: `.claude-plugin/plugin.json`, `hooks/hooks.json`, and the hooks module `hooks/register.tsx`, with its tests beside it. The documentation skills live in `vfx/skills/<name>/`: `SKILL.md`, the crawler in `scripts/`, and test cases in `evals/` that `claude plugin eval` can run.

``` shell
git clone https://github.com/healkeiser/claude-plugins
cd claude-plugins
claude plugin marketplace add ./
claude plugin validate ./gloss
claude plugin test ./gloss
```

A marketplace added from a local folder is read in place: edit a mod, run `/reload-plugins`, and the session picks it up with no reinstall.

The mods share one design system, described in [DESIGN.md](./DESIGN.md): colour roles, glyphs, shapes, formats, motion and what each mod does on graphical surfaces. Its tokens live in `hooks/style.ts`, one identical copy per mod, since a plugin cannot import from another. After changing one copy, copy it to the other four and run the check, which also fails on any drawn glyph a terminal may show as a colour emoji:

``` shell
node scripts/check-style.mjs
```

<!-- CREDITS -->
## Credits and inspiration

- **flightdeck** is a fork of [Flightdeck](https://github.com/scasella/claude-flightdeck) by Stephen Casella (MIT), with contributions from Alejandro Remior, @vihrea1337, Da Vinci and the people credited in its changelog. See [`flightdeck/NOTICE`](./flightdeck/NOTICE).
- **filetree** is a fork of [claude-code-filetree](https://github.com/data-goblin/claude-code-filetree) by [Kurt Buhler](https://github.com/data-goblin) (MIT), with its contributors listed in [`filetree/ACKNOWLEDGEMENTS.md`](./filetree/ACKNOWLEDGEMENTS.md).
- **gloss**: lists by depth, task items, quote bars, rules, strikethrough and theme-aware chips were inspired by [cc-crayon](https://github.com/jonpojonpo/cc-crayon) by jonpojonpo (ideas only, no code taken).
- Measuring text in terminal cells, with CJK and emoji two cells wide, follows [prismantis](https://github.com/NahumLitvin/prismantis) by Nahum Litvin (idea only).
- The status line's `NO_COLOR` support and its narrow forms follow [claude-powerline](https://github.com/Owloops/claude-powerline) and [ccstatusline](https://github.com/sirmalloc/ccstatusline) (ideas only).



<!-- LICENSE -->
## License

MIT. See [LICENSE](./LICENSE).

> [!NOTE]
> Claude and Claude Code are trademarks of Anthropic. These mods are an independent community project and are not affiliated with, endorsed by, or sponsored by Anthropic.



<!-- CONTACT -->
## Contact

Project Link: [claude-plugins](https://github.com/healkeiser/claude-plugins)

<p align='center'>
  <!-- GitHub profile -->
  <a href="https://github.com/healkeiser">
    <img src="https://img.shields.io/badge/healkeiser-181717?logo=github&style=social" alt="GitHub"/></a>&nbsp;&nbsp;
  <!-- LinkedIn -->
  <a href="https://www.linkedin.com/in/valentin-beaumont">
    <img src="https://img.shields.io/badge/Valentin%20Beaumont-0A66C2?logo=linkedin&style=social" alt="LinkedIn"/></a>&nbsp;&nbsp;
  <!-- Behance -->
  <a href="https://www.behance.net/el1ven">
    <img src="https://img.shields.io/badge/el1ven-1769FF?logo=behance&style=social" alt="Behance"/></a>&nbsp;&nbsp;
  <!-- X -->
  <a href="https://twitter.com/valentinbeaumon">
    <img src="https://img.shields.io/badge/@valentinbeaumon-1DA1F2?logo=x&style=social" alt="Twitter"/></a>&nbsp;&nbsp;
  <!-- Instagram -->
  <a href="https://www.instagram.com/val.beaumontart">
    <img src="https://img.shields.io/badge/@val.beaumontart-E4405F?logo=instagram&style=social" alt="Instagram"/></a>&nbsp;&nbsp;
  <!-- Gumroad -->
  <a href="https://healkeiser.gumroad.com/subscribe">
    <img src="https://img.shields.io/badge/healkeiser-36a9ae?logo=gumroad&style=social" alt="Gumroad"/></a>&nbsp;&nbsp;
  <!-- Gmail -->
  <a href="mailto:valentin.onze@gmail.com">
    <img src="https://img.shields.io/badge/valentin.onze@gmail.com-D14836?logo=gmail&style=social" alt="Email"/></a>&nbsp;&nbsp;
  <!-- Buy me a coffee -->
  <a href="https://www.buymeacoffee.com/healkeiser">
    <img src="https://img.shields.io/badge/Buy Me A Coffee-FFDD00?&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me A Coffee"/></a>&nbsp;&nbsp;
</p>
