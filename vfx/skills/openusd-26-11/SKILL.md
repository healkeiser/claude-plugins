---
name: openusd-26-11
description: >-
  OpenUSD 26.11 (Universal Scene Description) documentation mirrored locally as searchable Markdown — the official openusd.org release docs (glossary, tutorials, user guides, schema domains, specs, proposals), the narrative pages of the C++/Python API docs (Usd, Sdf, Pcp, Ar, UsdShade, UsdSkel, UsdGeom, UsdLux, Hydra, value clips, instancing, best practices) and Luca Scheller's USD Survival Guide (production pipelines, Houdini/Solaris, performance, composition in practice). Use this whenever a task involves USD in any form, even if the user never says "docs": writing or debugging pxr Python/C++ (Usd.Stage, Sdf.Layer, UsdGeom, UsdShade, Sdf.ChangeBlock), .usda/.usdc/.usdz files, composition arcs and LIVRPS strength order, references/payloads/variants/inherits/specializes, layer stacks, asset resolution, kinds and model hierarchy, primvars, instancing, value clips, materials and UsdPreviewSurface/MaterialX, skeletons, lights, render settings, schemas and usdGenSchema, usdview/usdcat/usdchecker, Hydra, or USD pipelines in Houdini LOPs/Solaris, Maya, Katana, Unreal. Prefer it over memory: USD APIs and schemas change between releases.
---

# OpenUSD 26.11

A local copy of the OpenUSD 26.11 documentation (crawled 2026-11-01) plus the USD Survival Guide. The version is pinned: the folder name is the release the pages describe. The Survival Guide has no versions, so it is whatever was current at crawl time. If the user works with another USD build (a DCC often bundles an older one; check with `Usd.GetVersion()`), say which version the docs are and flag anything that changed between the two when it matters. Answer from it rather than from memory: schema attributes, API names and recommended practice move between USD releases, and recalled USD knowledge often mixes versions or invents plausible-looking method names.

## Where things are

The docs live in `${CLAUDE_PLUGIN_DATA}/openusd-26-11/docs/`; below, `docs/` means that folder. They are built on this machine, not shipped with the plugin. If `docs/index.tsv` is missing, build it before answering (tell the user it takes a while): `uv run "${CLAUDE_SKILL_DIR}/scripts/crawl.py" --out "${CLAUDE_PLUGIN_DATA}/openusd-26-11/docs"`.

- `docs/index.tsv`: one line per page: `file`, `title`, `summary` (first paragraph, cut to 240 characters). Search it first.
- `docs/openusd/`: openusd.org/release. Concepts and reference prose.
  - `glossary.md`: "Terms and Concepts", the canonical definition of every USD term (LIVRPS, Layer Stack, Path Translation, Kind, Payload, Specializes, Value Clips, Instancing, Opinion, Over…). It is long (3,700 lines): grep for the `## ` heading of the term, then read that section.
  - `tut_*.md`: tutorials (hello world, referencing, variants, xforms, traversing, shading, schema generation).
  - `user_guides/`: primvars, collections and patterns, namespace editing, time and animated values, variable expressions, color, rendering; `user_guides/schemas/<domain>/` per-schema pages for usdGeom, usdLux, usdMedia, usdRender, usdUI, usdVol (attributes, fallbacks, usage).
  - `spec*.md`: usdz and UsdPreviewSurface specifications. `wp_*.md`: design proposals (AR 2.0, UsdShade, render settings, physics, coordinate systems, stage variables, schema versioning). A proposal describes intent and may be ahead of or behind the shipped code; say so when citing one.
  - `toolset.md`: command-line tools (usdcat, usdview, usdchecker, usdzip, usdresolve, usdtree, usdstitch, usdrecord…). `usdfaq.md`, `maxperf.md`.
- `docs/api/`: the narrative pages of the Doxygen API docs (openusd.org/release/api). Module overviews (`usd_page_front`, `sdf_page_front`, `pcp_page_front`, `ar_page_front`, `usd_shade_page_front`, `usd_skel_page_front`, `usd_geom_page_front`, `usd_physics_page_front`, `hd_page_front`…) and core guides (`_usd__page__object_model`, `_usd__page__authoring_editing`, `_usd__page__best_practices`, `_usd__page__common_idioms`, `_usd__page__value_clips`, `_usd__page__scenegraph_instancing`, `_usd__page__datatypes`, `_usd__page__multi_threading`, `_usd_skel__*`, Hydra guides, OpenExec).
- `docs/survival/`: the USD Survival Guide (lucascheller.github.io/VFX-UsdSurvivalGuide). Practical, code-heavy, with Python for both the high-level `Usd` API and the low-level, faster `Sdf` API side by side.
  - `pages/core/elements/`: layers, prims, properties, paths, metadata, data types, animation/time samples, transforms, collections, materials, loading mechanisms (payloads, population masks, traversal), notices.
  - `pages/core/composition/`: fundamentals, arcs (with code per arc), LIVRPS, list-editable ops, Pcp prim index inspection.
  - `pages/core/plugins/`: asset resolvers, kinds, metadata and schema plugins. `pages/core/profiling/`: debugging and Trace profiling.
  - `pages/production/`: pipeline concepts, composition in production, caches (xform, bbox, attribute, collection, material binding), FAQ.
  - `pages/dcc/houdini/`: Solaris/LOPs approach, HDAs, FX (particles, point instancers, RBD, motion blur, frustum culling), performance.
- `${CLAUDE_SKILL_DIR}/scripts/crawl.py`: builds and refreshes the mirror.

The generated class reference (thousands of `class_usd_*.html` stubs) is not mirrored. For exact method signatures and overloads, introspect the installed bindings (`python -c "from pxr import Usd; help(Usd.Stage.Open)"`, or `hython` inside Houdini), or give the user the class page URL: `https://openusd.org/release/api/class_<lowercased_name_with_underscores>.html`, e.g. `class_usd_stage.html`, `class_sdf_layer.html`, `class_usd_geom_xformable.html`. Links in the mirrored pages already point there.

## Which source to use

The three sources answer different questions:

- **What does this term or behaviour mean, exactly?** `openusd/glossary.md` and the `api/` overview for the module. These are authoritative.
- **What attributes does schema X have, and what are their fallbacks?** `openusd/user_guides/schemas/<domain>/<Schema>.md`; for UsdShade and UsdSkel, the `api/` pages. UsdPreviewSurface inputs: `openusd/spec_usdpreviewsurface.md`.
- **How do I do this in code, fast, in a pipeline?** `survival/` first: it shows the Sdf-level idioms (`Sdf.ChangeBlock`, `Sdf.CreatePrimInLayer`, `Sdf.Reference`, `Sdf.Path` manipulation), caches and performance trade-offs that the official prose skips. Cross-check API names against `api/` or the installed bindings.
- **Houdini Solaris / LOPs specifics** (`hou.LopNode.editableLayer`, `loputils`, layer flattening, sublayering in LOPs): `survival/pages/dcc/houdini/`. For the `hou` side itself, the `houdini-22` skill.

## How to answer

1. **Find candidate pages.** Grep `docs/index.tsv` for the feature's names. Try synonyms and both spellings: "payload" and "load rules", "inherits" and "class", "variant set" and "VariantSet", "instancing" and "instanceable", "primvar" and "PrimvarsAPI".
2. **Search the bodies** when the question names something specific: a class (`UsdGeomXformCommonAPI`), a method (`GetPrimAtPath`, `SetEditTarget`), a metadata key (`instanceable`, `kind`, `apiSchemas`), an attribute (`xformOpOrder`, `extentsHint`), an env var (`PXR_AR_DEFAULT_SEARCH_PATH`, `TF_DEBUG`). Grep `docs/` with `output_mode: files_with_matches`, then `content` with context on the best few files.
3. **Read the pages.** Read the two to five most relevant pages. Long pages can be grepped for their `## ` section heading and read with `offset` and `limit`.
4. **Answer with sources.** Give the answer, then the page URL(s) from each page's `Source:` line. Quote only the sentence, table row or code lines that settle a point. When writing code, prefer the idioms shown in the docs over remembered ones, and keep `.usda` examples valid (`#usda 1.0` header, `def`/`over`/`class` specifiers, `prepend references = @./file.usda@</Prim>`).
5. **Say what the docs don't settle.** The docs often omit defaults, edge cases and version history. When behaviour depends on the build (a USD version, a DCC's bundled USD, a plugin), say so; run it to check if a `pxr` install is available (`python -c "from pxr import Usd; print(Usd.GetVersion())"`, or Houdini's `hython`). When the Survival Guide and openusd.org disagree, openusd.org describes the current release; the Survival Guide may describe an older one.

If nothing in the mirror covers the question, say so plainly rather than filling the gap from memory. Then offer what you know, labelled as unverified for this release.

## Keeping the mirror

The mirror is a one-time crawl pinned to 26.11. If `docs/` is missing or empty, or the user asks for a refresh:

```
uv run "${CLAUDE_SKILL_DIR}/scripts/crawl.py" --out "${CLAUDE_PLUGIN_DATA}/openusd-26-11/docs"                  # everything again, about two minutes
uv run "${CLAUDE_SKILL_DIR}/scripts/crawl.py" --out "${CLAUDE_PLUGIN_DATA}/openusd-26-11/docs" --only survival  # one source: openusd | api | survival
```

The crawler reads the version from this folder's name and refuses to write docs for any other version, so a refresh never moves to a newer release. For another release, copy the skill to `openusd-<yy>-<mm>` (for example `openusd-25-11`), delete its `docs/`, update the version in this file and the description, and run the crawler there. openusd.org keeps older releases at `/<yy.mm>/`, the current one at `/release/` and the next at `/dev/`; `versions.json` on the site maps them, and the crawler uses it.

The OpenUSD docs are under the Pixar-modified Apache 2.0 license and the Survival Guide is its author's work: the mirror is a private offline reference. Don't copy it into a repository or publish it.
