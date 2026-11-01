---
name: blender-5-2
description: >-
  Blender 5.2 LTS documentation mirrored locally as searchable Markdown: the full Blender 5.2 LTS user manual (every editor, tool, modifier, node, setting and preference), the complete Blender 5.2 Python API reference (bpy.types, bpy.ops, bpy.props, bpy.app.handlers, bpy.utils, bmesh, mathutils, gpu, bpy_extras, aud, freestyle, the info_* guides and the API change log) and the Blender developer docs (handbook, building Blender from source, release notes for many versions, architecture, Python API and extension guidelines). Use this whenever a task involves Blender in any form, even if the user never says "docs": bpy scripting, operators and poll/context errors, temp_override, panels, menus and UI layout, properties and PropertyGroups, add-ons and extensions (blender_manifest.toml), bmesh, mathutils, geometry nodes, shader nodes and materials, drivers, handlers and timers, the depsgraph and evaluated data, background and command-line rendering (blender -b, --python), Cycles and EEVEE settings, USD, Alembic, FBX, glTF and OBJ import/export, Grease Pencil, animation, actions, rigging, modifiers, compositing, building Blender from source, contributing patches, and user-manual questions about what a tool, setting or editor does. Prefer it over memory: the Blender API and UI change every release, and this is the 5.2 text.
---

# Blender 5.2 LTS

A local copy of the Blender 5.2 LTS user manual and Python API reference, plus the Blender developer docs (crawled 2026-11-01). The manual and API are pinned: the folder name is the release they describe. The developer docs have no versions: they are whatever developer.blender.org showed at crawl time, and they hold release notes for many Blender versions side by side. If the user runs another Blender (check `blender --version`, or `bpy.app.version_string` in a script), say which version the docs are and flag what changed between the two when it matters (`api/change_log.md`, `dev/release_notes/<x.y>/`). Answer from the mirror rather than from memory: operator arguments, property names and node sockets move between releases, and recalled bpy code often mixes 2.x, 3.x and 4.x APIs.

## Where things are

The docs live in `${CLAUDE_PLUGIN_DATA}/blender-5-2/docs/`; below, `docs/` means that folder. They are built on this machine, not shipped with the plugin. If `docs/index.tsv` is missing, build it before answering (tell the user it takes a while): `uv run "${CLAUDE_SKILL_DIR}/scripts/crawl.py" --out "${CLAUDE_PLUGIN_DATA}/blender-5-2/docs"`.

- `docs/index.tsv`: one line per page: `file`, `title`, `summary` (first paragraph, cut to 240 characters). Search it first.
- `docs/manual/`: docs.blender.org/manual/en/5.2. What each tool, setting and editor does, from the user's side. Same tree as the site: `modeling/modifiers/<category>/<name>.md`, `modeling/geometry_nodes/<category>/<node>.md`, `render/shader_nodes/`, `render/cycles/`, `render/eevee/`, `animation/`, `grease_pencil/`, `physics/`, `compositing/`, `video_editing/`, `files/import_export/` (USD, Alembic, FBX, OBJ, PLY, STL, BVH, SVG; glTF is `addons/scene_gltf2.md`), `advanced/command_line/arguments.md` (every `blender` CLI flag), `advanced/extensions/` (packaging, `blender_manifest.toml`), `editors/preferences/`, `addons/`.
- `docs/api/`: docs.blender.org/api/5.2, one file per page, named like the page:
  - `bpy.types.<Class>.md`: every RNA class with properties (type, range, default, readonly), functions and inherited members. `bpy.types.Object.md`, `bpy.types.Mesh.md`, `bpy.types.Operator.md`, `bpy.types.Panel.md`, `bpy.types.Context.md` (`temp_override`), `bpy.types.Depsgraph.md`, `bpy.types.<Name>Modifier.md`, `bpy.types.GeometryNode<Name>.md`, `bpy.types.ShaderNode<Name>.md`.
  - `bpy.ops.<area>.md`: every operator of one area with its full signature and enum values (`bpy.ops.mesh.md`, `bpy.ops.object.md`, `bpy.ops.wm.md` for import/export such as `wm.usd_export`, `wm.alembic_export`, `wm.obj_export`; `bpy.ops.export_scene.md` for FBX and glTF).
  - Modules: `bpy.props.md`, `bpy.app.md`, `bpy.app.handlers.md`, `bpy.app.timers.md`, `bpy.utils.md`, `bpy.msgbus.md`, `bpy.path.md`, `bmesh.md`, `bmesh.ops.md`, `bmesh.types.md`, `mathutils*.md`, `gpu*.md`, `gpu_extras*.md`, `bpy_extras*.md`, `blf.md`, `aud.md`, `freestyle*.md`, `idprop.types.md`, `imbuf.md`.
  - `bpy_types_enum_items/<name>_items.md`: the shared enum tables (`object_modifier_type_items`, `event_type_items`, `icon_items`…) that signatures link to.
  - Guides: `info_quickstart`, `info_overview` (registration, classes), `info_api_reference`, `info_best_practice`, `info_tips_and_tricks`, `info_advanced` and `info_advanced_blender_as_bpy`, `info_gotcha` and `info_gotchas_*` (operators, crashes, meshes, armatures, threading, file paths, internal data). `change_log.md` lists every API addition and removal since the previous release.
- `docs/dev/`: developer.blender.org/docs, unversioned. `handbook/` (getting started, `building_blender/` per OS, contributing, code review, guidelines, release process), `handbook/extensions/` (add-on guidelines, dev setup), `features/` (module and architecture notes: core, animation, geometry nodes, EEVEE, Cycles, Python; `features/extensions/` has the manifest schema and the extensions platform), `release_notes/<x.y>/` (per-area notes per release, including `python_api`), `programs/`. One page per URL: `dev/<path>/index.md`.
- `docs/manifest.jsonl`: crawl bookkeeping. `${CLAUDE_SKILL_DIR}/scripts/crawl.py`: builds and refreshes the mirror.

## Which source to use

- **What does this tool, setting or node do, and where is it in the UI?** `manual/`.
- **What is the exact Python name, type, range or default?** `api/bpy.types.<Class>.md`. For an operator's arguments, `api/bpy.ops.<area>.md`. The manual often names the Python path too (Python tooltips), but the API page is authoritative for 5.2.
- **How do I structure a script, operator, panel or add-on?** `api/info_quickstart.md`, `info_overview.md`, `info_best_practice.md`, then the class pages (`bpy.types.Operator.md`, `Panel.md`, `Menu.md`, `PropertyGroup.md`, `AddonPreferences.md`), which carry the official examples. Extensions (`blender_manifest.toml`, wheels, permissions): `manual/advanced/extensions/` and `dev/` extension guidelines.
- **Why does this fail or crash?** `api/info_gotcha.md` and `info_gotchas_*.md` first.
- **What changed in 5.2, or since the version my script was written for?** `api/change_log.md` (names) and `dev/release_notes/<x.y>/` (meaning, migration, before/after code).
- **How do I build Blender, run its tests, or send a patch?** `dev/handbook/`.

Gotchas the 5.2 docs confirm, worth checking whenever they could apply:

- `bpy.context` is read-only: set the active object with `view_layer.objects.active = obj`. Context members differ per editor; call an operator outside its editor with `with bpy.context.temp_override(window=..., area=..., region=...):` (`info_quickstart.md`, `bpy.context.md`, `bpy.types.Context.md`).
- An operator whose `poll()` fails raises `RuntimeError: Operator bpy.ops.x.y.poll() failed, context is incorrect`; check `bpy.ops.x.y.poll()` first. Prefer `bpy.data` and RNA methods over `bpy.ops` in automation (`info_gotchas_operators.md`, `info_best_practice.md`).
- Setting a property does not re-evaluate dependent data: call `view_layer.update()` before reading matrices or modifier results; read evaluated meshes through `obj.evaluated_get(depsgraph)` (`info_gotchas_internal_data_and_python_objects.md`, `bpy.types.Depsgraph.md`).
- Python references to removed or reallocated data (after `remove()`, undo, adding items to a collection, edit-mode toggles) become invalid and can crash Blender; re-fetch by name (`info_gotchas_crashes.md`, `info_gotchas_internal_data_and_python_objects.md`).
- Custom `__init__` on registered classes is not recommended (panels and operators are instantiated many times). Where one is defined, e.g. a `RenderEngine`, it must call `super().__init__(*args, **kwargs)` before any data access, a hard requirement since 4.4; the failure shows up as `MemoryError: couldn't create bpy_struct object` (`info_overview.md`).
- Headless: `blender -b file.blend --python script.py -- args`; arguments after `--` reach the script in `sys.argv` (`manual/advanced/command_line/arguments.md`, `info_tips_and_tricks.md`).

## How to answer

1. **Find candidate pages.** Grep `docs/index.tsv` for the feature's names. Try the UI name and the Python name ("Subdivision Surface" and `SubsurfModifier`, "Set Origin" and `origin_set`, "Weld" and `remove_doubles`), and the node's class name (`GeometryNodeMeshBoolean`, `ShaderNodeBsdfPrincipled`).
2. **Search the bodies** when the question names something specific: a class, a property (`matrix_world`, `use_auto_smooth`), an operator (`bpy.ops.wm.usd_export`), a CLI flag (`--python-expr`, `--render-anim`), a CMake option (`WITH_CYCLES`). Grep `docs/` with `output_mode: files_with_matches`, then `content` with context on the best few files. `bpy.ops.*` and some `bpy.types.*` pages are long: grep for the member name and read that part with `offset` and `limit`.
3. **Read the pages.** Read the two to five most relevant pages.
4. **Answer with sources.** Give the answer, then the URL(s) from each page's `Source:` line. Quote only the line, table row or code that settles a point. When writing code, use the names and idioms on the 5.2 pages over remembered ones.
5. **Say what the docs don't settle.** The reference often omits side effects, undo behaviour and edge cases. When Blender is available, check: `blender --version`, or run a short script with `blender -b --factory-startup --python-expr "import bpy; ..."`. Release notes in `dev/` describe intent at release time; the 5.2 API pages describe what shipped.

If nothing in the mirror covers the question, say so plainly rather than filling the gap from memory. Then offer what you know, labelled as unverified for 5.2.

## Keeping the mirror

The mirror is a one-time crawl pinned to 5.2. If `docs/` is missing or empty, or the user asks for a refresh:

```
uv run "${CLAUDE_SKILL_DIR}/scripts/crawl.py" --out "${CLAUDE_PLUGIN_DATA}/blender-5-2/docs"                    # resumes: fetches only pages not in docs/manifest.jsonl
uv run "${CLAUDE_SKILL_DIR}/scripts/crawl.py" --out "${CLAUDE_PLUGIN_DATA}/blender-5-2/docs" --refresh          # fetch everything again (about 5,500 pages, roughly half an hour)
uv run "${CLAUDE_SKILL_DIR}/scripts/crawl.py" --out "${CLAUDE_PLUGIN_DATA}/blender-5-2/docs" --only dev --refresh   # one source: manual | api | dev
```

The crawler reads the version from this folder's name, only uses URLs pinned to it (never `latest` or `current`), and stops if the site reports another version. For another release, copy the skill to `blender-<major>-<minor>`, delete its `docs/`, update the version in this file and the description, and run the crawler there.

The manual is CC-BY-SA and the API docs and developer docs are the Blender project's work: the mirror is a private offline reference. Don't copy it into a repository or publish it.
