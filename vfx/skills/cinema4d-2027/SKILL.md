---
name: cinema4d-2027
description: >-
  Cinema 4D 2027 documentation mirrored locally as searchable Markdown: the full Maxon Cinema 4D
  2027 user manual (every object, tag, tool, menu, manager, setting and preference, Redshift in
  C4D, MoGraph, Scene Nodes, fields, simulation, rendering, and "What's new in Cinema 4D 2027")
  and the complete Cinema 4D 2027.0.0 Python SDK reference (c4d, c4d.modules, c4d.plugins,
  c4d.gui, c4d.documents, maxon, constants, manuals and code examples). Use this whenever a task
  involves Cinema 4D in any form, even if the user never says "docs": c4d Python scripting,
  Script Manager scripts, c4dpy, plugins (CommandData, ObjectData, TagData, ShaderData, ToolData,
  MessageData, SceneSaverData, .pyp and .res/.str resources), Python generators, Python tags,
  Python effectors and Python fields, BaseObject, BaseDocument, BaseContainer, BaseTag,
  GeListNode, DescID and DescLevel, user data, the maxon API and node materials, Redshift
  materials and render settings in C4D, MoGraph (MoData, cloners, effectors), the Field system,
  Scene Nodes, Xpresso, takes, UI and dialogs (GeDialog, GeUserArea), render settings and
  RenderDocument, plus user-manual questions about what a tool, menu, object or parameter does
  and what changed in 2027. Prefer it over memory: the C4D API and UI change every release.
---

# Cinema 4D 2027

A local copy of two Maxon sources for Cinema 4D 2027, crawled 2026-11-01. The Python SDK is pinned by URL (`/docs/py/2027_0_0/`). The user manual has no versioned URL; the crawler checked that it reports Cinema 4D 2027. If the user runs another version (check `c4d.GetC4DVersion()`), say which version these docs are and flag differences when they matter. Answer from the mirror rather than from memory: recalled C4D knowledge mixes releases and invents plausible constants and method names.

## Where things are

The docs live in `${CLAUDE_PLUGIN_DATA}/cinema4d-2027/docs/`; below, `docs/` means that folder. They are built on this machine, not shipped with the plugin. If `docs/index.tsv` is missing, build it before answering (tell the user it takes a while): `uv run "${CLAUDE_SKILL_DIR}/scripts/crawl.py" --out "${CLAUDE_PLUGIN_DATA}/cinema4d-2027/docs"`.

- `docs/index.tsv`: one line per page: `file`, `title`, `summary` (first paragraph, cut to 240 characters). Search it first.
- `docs/python/`: the Python SDK (developers.maxon.net/docs/py/2027_0_0).
  - `modules/c4d/...`: the `c4d` classes, paths follow the class hierarchy: `modules/c4d/C4DAtom/GeListNode/BaseList2D/BaseObject/index.md`, `.../BaseObject/PointObject/PolygonObject/index.md`, `modules/c4d/BaseContainer/index.md`. Each method is a `#### ` heading with its signature (`#### \`BaseObject.GetMg(self)\``), followed by parameters, return type and notes. Grep for the heading.
  - `modules/c4d.plugins/`, `c4d.gui/`, `c4d.documents/`, `c4d.utils/`, `c4d.bitmaps/`, `c4d.storage/`, `c4d.threading/`: plugin hooks (CommandData, ObjectData, TagData...), dialogs, documents and rendering, helpers.
  - `modules/c4d.modules/`: mograph (MoData, fields), graphview (Xpresso), character, hair, takesystem, render, volume, bodypaint, tokensystem, thinkingparticles...
  - `modules/maxon/` and `modules/maxon_generated/`: the maxon API (nodes, assets, data types, URLs, graph descriptions). `modules/mxutils_api.md`: the `mxutils` helpers (type checks, debugging, scene iteration).
  - `consts/`: one page per constant family (`BFM_INPUT`, `DESCFLAGS_SET`, `BUILDFLAGS`...). `types/`: data types and description resource types.
  - `manuals/`: narrative guides: API overview, geometry model, plugins, threading, graph descriptions, assets, debugging, external libraries, licensing, input events.
  - `examples/<topic>/`: complete example scripts and plugins with source (modeling, plugins, animation, nodes, io, rendering, scene, gui, data, math, misc).
- `docs/manual/`: the user manual (help.maxon.net/c4d/en-us). One file per topic, named as on the site: numeric ids (`33010.md` "What's new in Cinema 4D 2027", `5860.md` viewport Display) or internal ids (`OMOGRAPH_CLONER.md`, `TOOLUVRECTANGULARIZE.md`). Object and tag pages are split by attribute tab: `OMOGRAPH_FXSCATTER.md` is the overview, `OMOGRAPH_FXSCATTER-<GROUP>.md` the tabs with their parameters (`-OBASELIST` is the Basic tab, `-ID_BASEOBJECT_GROUP1` Coordinates). Section pages end with `## In this section`, the list of their child topics. Titles are in `index.tsv`; search there. Each parameter is a `#### ` heading with its range and its symbol, which is the `c4d` constant for that parameter: `#### Drag [0..+∞%] (CLOTH_PBD_AERO_DRAG)` means `tag[c4d.CLOTH_PBD_AERO_DRAG]`. Each menu command is a `#### ` heading with its command id: `#### Gouraud Shading (PLUGIN_CMD_12091)` means `c4d.CallCommand(12091)`.
- `docs/manifest.jsonl`: crawl state (resumable). `${CLAUDE_SKILL_DIR}/scripts/crawl.py`: builds and refreshes the mirror.

The Redshift standalone docs (`Content/_REDSHIFT_/`) and the C++ SDK are not mirrored; Redshift as it appears in C4D (materials, render settings, objects, AOVs) is in the manual.

## Which source answers what

- **What does this tool, object, menu or parameter do? Where is it in the UI? What's new in 2027?** `manual/`. Start at `manual/33010.md` for 2027 changes. `[Release marker: 2027]` in a page marks content added or changed in that release.
- **What is the method, its signature, its arguments, the constant to use?** `python/modules/...` and `python/consts/`. Authoritative for the API.
- **How do I structure a plugin, deal with threading, caches, node graphs?** `python/manuals/` first, then a matching `python/examples/` page to copy idioms from.
- **Which constant controls a UI setting, or which id runs a menu command?** Grep `manual/` for the parameter or command label in `#### ` headings; the symbol in parentheses is the constant or command id. Then grep `python/` for the symbol for its type and related API.

## How to answer

1. **Find candidate pages.** Grep `docs/index.tsv` for the feature names. Try synonyms: "Cloner" and "MoGraph", "Python Generator" and "Opython", "user data" and "DescID", "dialog" and "GeDialog".
2. **Search the bodies** when the question names something specific: a class (`PolygonObject`), a method (`GetCache`, `SetParameter`), a constant (`MSG_DESCRIPTION_POSTSETPARAMETER`, `Ocube`, `ID_MG_MOTIONGENERATOR_MODE`), a menu or parameter label. Grep `docs/` with `output_mode: files_with_matches`, then `content` with context on the best few files.
3. **Read the pages.** Read the two to five most relevant pages. Class pages are long (BaseObject is ~1,500 lines): grep for the `#### ` method heading and read with `offset` and `limit`.
4. **Answer with sources.** Give the answer, then the URL(s) from each page's `Source:` line. Quote only the sentence, table row or code lines that settle a point. When writing code, prefer the idioms in the SDK examples (`c4d.EventAdd()` after edits, `doc.StartUndo()`/`AddUndo`, main-thread rules) over remembered ones.
5. **Say what the docs don't settle.** Defaults, edge cases and threading behaviour are often missing. Say so; if a Cinema 4D or `c4dpy` install is available, run a check.

If nothing in the mirror covers the question, say so plainly rather than filling the gap from memory. Then offer what you know, labelled as unverified for 2027.

## Keeping the mirror

The mirror is a one-time crawl pinned to 2027. If `docs/` is missing or the user asks for a refresh:

```
uv run "${CLAUDE_SKILL_DIR}/scripts/crawl.py" --out "${CLAUDE_PLUGIN_DATA}/cinema4d-2027/docs"                  # resumes; about 1.5 hours from scratch (9,400 pages)
uv run "${CLAUDE_SKILL_DIR}/scripts/crawl.py" --out "${CLAUDE_PLUGIN_DATA}/cinema4d-2027/docs" --refresh        # fetch everything again
uv run "${CLAUDE_SKILL_DIR}/scripts/crawl.py" --out "${CLAUDE_PLUGIN_DATA}/cinema4d-2027/docs" --only python    # one source: python | manual
```

The crawler reads the version from this folder's name (`cinema4d-2027` -> manual 2027, SDK `2027_0_0`; `--version 2027.1` targets SDK `2027_1_0`) and refuses to write docs when the SDK inventory or the manual reports another version. The manual is always the current one online, so once Maxon publishes the next release a refresh will refuse: copy the skill to `cinema4d-<year>`, delete its `docs/`, update this file, and crawl there. Pages that fail are recorded in the manifest and retried on the next run.

The docs are Maxon's copyright: the mirror is a private offline reference. Don't copy it into a repository or publish it.
