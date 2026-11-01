---
name: unreal-5-8
description: >-
  Unreal Engine 5.8 official documentation, mirrored locally as searchable Markdown (every page of dev.epicgames.com/documentation/unreal-engine for 5.8, except the generated API reference). Use this whenever a question or task involves how Unreal Engine 5 works or how to do something in it, even if the user never says "docs": rendering features and their settings (Lumen, Nanite, Virtual Shadow Maps, path tracer, post process, exposure, materials, Substrate), Movie Render Queue/Graph, USD and Interchange import, Datasmith, Sequencer, World Partition, PCG, Niagara, animation, Blueprints, gameplay framework, C++ modules and build tools, plugins, packaging, console variables, project settings, editor workflows or command-line options. Prefer it over memory: UE behaviour changes between versions, and this is the 5.8 text.
---

# Unreal 5.8

A local copy of the Unreal Engine 5.8 documentation. Answer from it rather than from memory, because UE features, defaults and setting names move between versions, and recalled 5.x knowledge is often from an older release.

## Where things are

The docs live in `${CLAUDE_PLUGIN_DATA}/unreal-5-8/docs/`; below, `docs/` means that folder. They are built on this machine, not shipped with the plugin. If `docs/index.tsv` is missing, build it before answering (tell the user it takes a while): `uv run "${CLAUDE_SKILL_DIR}/scripts/crawl.py" --out "${CLAUDE_PLUGIN_DATA}/unreal-5-8/docs"`.

- `docs/index.tsv`: one line per page: `file`, `title`, `written_for`, `summary` (the page's own description, cut to 240 characters). Search it first.
- `docs/pages/<slug>.md`: the page as Markdown. The header gives the title, `Source: <url>` and `Written for: UE x.y (updated date)`. Slugs with `/` are stored with `__`.

Most of the 5.8 doc set (about 2000 of 2300 pages) is text Epic wrote for 5.5 and has not revised since: `Written for: UE 5.5, unchanged through 5.8`. It is what 5.8 users get, but the feature may have moved on, so when an answer hinges on such a page, say which release it was written for and check the engine source for anything version-sensitive. Pages that older pages link to but 5.8 no longer publishes (Screen Space Global Illumination, for one) are not in the mirror; say a page is missing from 5.8 rather than assuming the feature is gone. Code samples hold only the preview the page embeds; a line like "(first 12 of 80 lines)" means the rest is on the web page. Images and videos are dropped, and only their alt text or caption is kept.
- `docs/manifest.jsonl`: crawl state (slug, title, links); only the crawler needs it.
- `${CLAUDE_SKILL_DIR}/scripts/crawl.py`: builds and refreshes the mirror.

The API reference (`API/`, Blueprint API, Python API) is not mirrored: tens of thousands of generated stubs. For exact class members, signatures, CVar defaults or anything the text is vague about, read the engine source (`Engine/Source`, `Engine/Plugins`) of the user's engine install or source checkout, if they have one.

## How to answer

1. **Find candidate pages.** Grep `docs/index.tsv` for the feature's names (titles are like "Lumen Global Illumination and Reflections in Unreal Engine"). Try synonyms and the UI name: "Movie Render Queue" and "Movie Render Graph", "Virtual Shadow Maps" and "VSM".
2. **Search the bodies** when the question names something specific: a console variable (`r.Lumen.`), a setting label ("Max Trace Distance"), a command-line switch, a class (`UMoviePipeline`). Use Grep over `docs/pages/` with `output_mode: files_with_matches` first, then `content` with context on the best few files. The pages are the only place exact names appear.
3. **Read the pages.** Read the two to five most relevant pages. Long pages (some run to thousands of lines) can be grepped for the section heading and then read with `offset` and `limit`. Follow links to child pages when the answer lives one level down: link URLs end in the slug, so the file is `docs/pages/<slug>.md`.
4. **Answer with sources.** Give the answer, then the page URL(s) from each page's `Source:` line. Quote only the sentence or the table row that settles a point. Don't paste whole sections: the user can open the link.
5. **Say what the docs don't settle.** The docs describe intended use and often omit defaults, edge cases and recent changes. When the answer depends on exact behaviour (a default value, a fallback, what happens when two settings conflict), say so and check the engine source, or say it needs checking. When docs and source disagree, the source is what 5.8 does; mention the disagreement.

If nothing in the mirror covers the question, say so plainly rather than filling the gap from memory. Then offer what you know, labelled as unverified for 5.8.

## Keeping the mirror

The mirror is a one-time crawl, so it can go stale when Epic edits pages. If `docs/` is missing or empty, or the user asks for a refresh:

```
uv run "${CLAUDE_SKILL_DIR}/scripts/crawl.py" --out "${CLAUDE_PLUGIN_DATA}/unreal-5-8/docs"            # resume: fetches only pages not in the manifest
uv run "${CLAUDE_SKILL_DIR}/scripts/crawl.py" --out "${CLAUDE_PLUGIN_DATA}/unreal-5-8/docs" --refresh  # fetch everything again (about an hour)
```

It walks links breadth-first from the 5.8 landing page at three requests at a time with a pause, and backs off when Cloudflare challenges it. Epic's docs are copyrighted: the mirror is a private offline reference. Never copy it into a repository or publish it.
