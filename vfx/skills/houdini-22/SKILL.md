---
name: houdini-22
description: >-
  SideFX Houdini 22.0 documentation mirrored locally as searchable Markdown: the complete Houdini 22.0 help (every node in every context: SOPs, OBJs, DOPs, LOPs/Solaris, COPs/Copernicus, CHOPs, TOPs/PDG, ROPs, VOPs, APEX, with parameters and their internal parm names), all VEX functions and contexts, the full HOM Python API (hou module classes, methods and functions, hou.Node, hou.Geometry, hou.LopNode, hou.ui, pdg), HScript commands and expression functions, environment variables and reference pages, Karma and rendering, Solaris and USD in Houdini, KineFX, APEX rigging, Copernicus, Vellum, Pyro, FLIP fluids, RBD and destruction, MPM, crowds, grains, heightfields and terrains, digital assets (HDAs), PDG/TOPs and HQueue, what's new in Houdini 22, plus the HDK (Houdini Development Kit) C++ guide pages (writing SOPs/custom nodes, GA geometry, GU/GEO, USD/Hydra, VEX and HScript extensions, compiling plugins with hcustom/CMake). Use this whenever a task involves Houdini in any form, even if the user never says "docs": writing or debugging hython/hou Python, shelf tools, Python SOPs/LOPs, wrangles and VEX snippets, building node networks, looking up what a node or parameter does or its parm name, HDA authoring, Solaris/USD pipelines, render setup, simulations, PDG graphs, or HDK C++ plugins. Prefer it over memory: node parameters, hou methods and VEX signatures change between Houdini releases, and this is the 22.0 text.
---

# Houdini 22.0

A local copy of the Houdini 22.0 help (crawled 2026-11-01 from the installed Houdini 22.0.368 help server) and the narrative pages of the HDK 22.0 docs. The version is pinned: the folder name is the release the pages describe. If the user runs another Houdini (check `hou.applicationVersionString()`), say which version these docs are and flag anything that may differ. Answer from the mirror rather than memory: recalled Houdini knowledge mixes releases, invents parm names and misremembers hou method signatures.

## Where things are

The docs live in `${CLAUDE_PLUGIN_DATA}/houdini-22/docs/`; below, `docs/` means that folder. They are built on this machine, not shipped with the plugin. If `docs/index.tsv` is missing, build it before answering (tell the user it takes a while): `uv run "${CLAUDE_SKILL_DIR}/scripts/crawl.py" --out "${CLAUDE_PLUGIN_DATA}/houdini-22/docs"`.

- `docs/index.tsv`: one line per page: `file`, `title`, `summary` (cut to 240 characters). Search it first. Titles carry the page kind, e.g. `Scatter 2.0 geometry node`, `pcopen VEX function`, `hou.Node class`, `opadd HScript command`.
- `docs/houdini/`: the Houdini help, one file per page, same paths as the website.
  - `nodes/<context>/<name>.md`: every node: `sop`, `obj`, `dop`, `lop` (Solaris), `cop` (Copernicus), `cop2` (legacy compositing), `chop`, `top` (PDG), `out` (ROPs), `vop`, `shop`, `apex` (APEX graph nodes, namespaced: `nodes/apex/rig--*`, `graph--*`, `skel--*`...), `manager`, `*_state` (viewer states). Namespaced types use `--`: `nodes/sop/kinefx--rigdoctor.md`, `nodes/sop/apex--autorigbuilder.md`. Versioned types have their own page next to the old one: `nodes/sop/filemerge-2.0.md` and `nodes/sop/filemerge.md`; the title says which (`File Merge 2.0 geometry node`). Each `nodes/<context>/index.md` lists the context's nodes. Parameters appear as `**Label** (`parmname`)`: grep the parm name to find a node from a script, or the label to find the parm name. Deprecated nodes say so at the top.
  - `vex/functions/<name>.md`: every VEX function with signatures and examples. `vex/contexts/`, `vex/*.md`: language reference, snippets and attribute bindings (`vex/snippets.md`), arrays, structs, `vex/functions/index.md` by category.
  - `hom/hou/<Name>.md`: every `hou` class and function (`hom/hou/Node.md`, `hom/hou/OpNode.md`, `hom/hou/Geometry.md`, `hom/hou/LopNode.md`). Methods are `#### `signature` → return type` headings: grep `^#### .createNode`. `hom/*.md`: HOM guides (`commandline` for hython, `pythonsop`, `python_states` and `state_*` for viewer states, `cb/` cookbook). The `pdg` Python API is under `tops/pdg/`.
  - `commands/<name>.md`: HScript commands. `expressions/<name>.md`: expression functions (`ch`, `point`, `$F`...).
  - `ref/`: reference: `ref/env.md` (environment variables), `ref/panes/`, `ref/windows/`, `ref/utils/` (command-line tools: hython, hbatch, iconvert...), `ref/cameralenses`, file formats.
  - Topic guides: `solaris/` (USD, LOPs, Karma, `solaris/karma_*`), `render/`, `copernicus/`, `character/` (KineFX, APEX rigging under `character/kinefx/`), `tops/` (PDG), `vellum/`, `pyro/`, `fluid/` (FLIP), `destruction/` (RBD), `mpm/`, `crowds/`, `grains/`, `fur/`, `feathers/`, `muscles/`, `heightfields/`, `heightfields_cop/`, `model/` (geometry and attributes), `copy/` (copying and instancing), `assets/` (HDAs), `network/`, `basics/`, `anim/`, `io/`, `shade/`, `ml/`, `news/22/` (what's new in 22).
- `docs/hdk/`: HDK guide pages (`_h_d_k__*.md`): `_h_d_k__intro__*` (getting started, compiling with hcustom/CMake, creating plugins), `_h_d_k__op_basics*` and `_h_d_k__node_intro__*` (custom nodes, parameters, thread safety), `_h_d_k__geometry*` and `_h_d_k__g_a__*` (GA/GU geometry), `_h_d_k__u_s_d*` (USD, Hydra), `_h_d_k__v_e_x*`, `_h_d_k__h_script*`, `_h_d_k__changes_<ver>` (porting notes per release). `index.md` is the HDK table of contents.
- `docs/manifest.jsonl`: crawl state (one entry per page, with links); `${CLAUDE_SKILL_DIR}/scripts/crawl.py`: builds and refreshes the mirror.

The HDK class/file/namespace reference is not mirrored. For a class or method, read the header in the install (`$HFS/toolkit/include/<LIB>/<LIB>_<Class>.h`, e.g. `GU/GU_Detail.h`) or give the URL: `https://www.sidefx.com/docs/hdk22.0/class_<name>.html`, underscores doubled and capitals as `_x`, e.g. `class_s_o_p___node.html`. Links in the guide pages already point there.

Also not mirrored: SideFX Labs node pages (the help comes from the Labs package, not installed when crawled), the `examples/` pages describing downloadable example files, `gallery/` and third-party `licenses/`. About 470 links in the help point at pages that don't exist (old node types, typos in SideFX's sources); a missing file is not proof the feature is gone, but check `nodes/<context>/index.md`.

## Which source to use

- **What does node X do, what are its parms and their internal names?** `houdini/nodes/<context>/<name>.md`. Check for a newer versioned type (`<name>-2.0.md`).
- **How do I do this in Python?** `houdini/hom/hou/<Class>.md` for the method, `houdini/hom/*.md` for idioms. Since Houdini 20 most node methods live on `hou.OpNode` (`hom/hou/OpNode.md`), not `hou.Node`. For `pdg`, `houdini/tops/` and `houdini/tops/pdg/`.
- **VEX**: `houdini/vex/functions/<name>.md`; for wrangle bindings (`@P`, `@ptnum`, `i@`, `v[]@`), `houdini/vex/snippets.md`.
- **How does feature/workflow X work?** The topic folder (`solaris/`, `vellum/`, `pyro/`, `character/`...). Shelf tool pages under `houdini/shelf/` describe what a tool builds.
- **HDK / C++ plugins**: `hdk/`, then the installed headers for exact signatures.
- **Environment variables, command-line tools**: `houdini/ref/env.md`, `houdini/ref/utils/`.

## How to answer

1. **Find candidate pages.** Grep `docs/index.tsv` for the feature names. Try synonyms and the internal name: "Attribute Wrangle" and `attribwrangle`, "Copy to Points" and `copytopoints`, "Karma" and "XPU", "solver" and the context name.
2. **Search the bodies** for anything specific: a parm name (`npts`), a hou method (`createNode`, `setParms`), a VEX function, an env var (`HOUDINI_PATH`), an HDK class (`SOP_NodeVerb`). Grep `docs/` with `output_mode: files_with_matches`, then `content` with context on the best few files.
3. **Read the pages.** Read the two to five most relevant pages. Long pages (`hom/hou/OpNode.md` is 4,000+ lines) can be grepped for the `## ` or `#### ` heading and read with `offset` and `limit`.
4. **Answer with sources.** Give the answer, then the page URL(s) from each page's `Source:` line. Quote only the sentence, parameter entry or code lines that settle a point. When writing code, use the parm names, method names and signatures exactly as the pages show them.
5. **Say what the docs don't settle.** Pages often omit defaults, edge cases and performance; many parms have one-line descriptions. When behaviour depends on the build, say so, and check it in Houdini if one is available (`hython`).

If nothing in the mirror covers the question, say so plainly rather than filling the gap from memory. Then offer what you know, labelled as unverified for 22.0.

## Keeping the mirror

The mirror is pinned to 22.0. If `docs/` is missing or empty, or the user asks for a refresh:

```
uv run "${CLAUDE_SKILL_DIR}/scripts/crawl.py" --out "${CLAUDE_PLUGIN_DATA}/houdini-22/docs"                 # resumes; --refresh starts over
uv run "${CLAUDE_SKILL_DIR}/scripts/crawl.py" --out "${CLAUDE_PLUGIN_DATA}/houdini-22/docs" --only hdk      # one source: houdini | hdk
```

The `houdini` source needs Houdini 22.0 installed (found via `--hfs`, `$HFS`, or SideFX's default install location): it starts eight local `hhelp serve` servers and walks the help from its index, about an hour. It does not crawl sidefx.com for these pages because sidefx.com's robots.txt disallows every versioned docs path. The `hdk` source is fetched from sidefx.com's unversioned `/docs/hdk/` at one page per 5 seconds (its robots.txt crawl delay), after checking it documents 22.0; Source lines cite the pinned `/docs/hdk22.0/` URL. The crawler exits if the help or the HDK reports another version, so a refresh never moves to a newer release. For another release, copy the skill to `houdini-<major>` (or `houdini-<major>-<minor>` for x.5 releases, e.g. `houdini-21-5`), delete its `docs/`, update the version in this file and the description, and run the crawler there with that Houdini installed.

The docs are SideFX's copyrighted work: the mirror is a private offline reference. Don't copy it into a repository or publish it.
