---
name: rez-3-4
description: >-
  Rez 3.4 package manager (AcademySoftwareFoundation/rez) documentation mirrored locally as searchable Markdown: every page of rez.readthedocs.io/en/3.4.0, the user guide, all rez-* CLI pages and the full rez.* Python API reference. Use this whenever a task touches rez in any form, even if the user never says "docs": writing or debugging package.py (name, version, requires, build_requires, private_build_requires, variants, hashed_variants, tools, @early/@late binding, preprocess, tests), rezbuild.py and build systems, commands()/pre_commands()/post_commands() and the rex API (env, setenv, alias, source, this, resolve, building, ephemerals), version and request syntax (ranges, weak ~ and conflict ! requests, ephemerals), rez-env, rez-build, rez-release, rez-pip, rez-test, rez-context, rez-search, rez-cp/mv/rm, rez-pkg-cache, rez-bundle, rez-suite, rezconfig/config settings and REZ_* environment variables, package repositories and release paths, resolves and the solver, package orderers and filters, suites, context bundles, context (.rxt) files, the package cache and memcached, plugins and custom build/shell/release-hook plugins, and the rez Python API (ResolvedContext, Solver, packages, config). This is the rez 3.4 text; prefer it over memory, since rez settings, CLI flags and API change between releases.
---

# rez 3.4

A local copy of the rez 3.4.0 documentation (122 pages, 1.3 MB, built 2026-11-01 from git tag 3.4.0; citations point at rez.readthedocs.io/en/3.4.0). The version is pinned: the folder name is the release the pages describe. If the user runs another rez (check with `rez --version`, or `python -c "import rez; print(rez.__version__)"` in rez's own Python), say which version the docs are and flag anything that may differ when it matters. Answer from the mirror rather than from memory: config keys, CLI flags and API signatures move between rez releases, and recalled rez knowledge often mixes 2.x and 3.x.

## Where things are

Paths are relative to this skill's directory.

- `docs/index.tsv`: one line per page: `file`, `title`, `summary` (first paragraph, cut to 240 characters). Search it first.
- `docs/*.md`: the user guide.
  - Concepts: `basic_concepts` (requests, version ranges, weak/conflict requests, resolves), `getting_started`, `installation`, `managing_packages` (ignoring, copying, moving, removing packages), `environment` (`REZ_*` variables rez reads and sets).
  - Authoring: `package_definition` (every package attribute, early/late binding, `preprocess`, `building`), `package_commands` (`commands()` and the full rex API), `variants`, `ephemerals`, `building_packages` (build systems, `rezbuild.py`, `build_command`), `releasing_packages`, `pip` (rez-pip).
  - Runtime: `context` (resolved contexts, `.rxt` files), `context_bundles`, `suites`, `caching` (package cache, memcached), `package_orderers`.
  - Setup: `configuring_rez` (every rezconfig setting with its `REZ_<NAME>` env var override; long, grep for the setting name), `plugins`, `guides/developing_your_own_plugin.md`, `guides/update_to_3.md` (2.x to 3.x migration).
  - `changelog.md`: release notes for every version up to 3.4.0. Grep it for "what changed in 3.x".
- `docs/commands/rez-*.md`: one page per CLI tool, generated from argparse: usage, options, choices, defaults. `commands_index.md` lists them.
- `docs/api/rez.*.md`: the Python API reference, one page per module (`rez.resolved_context`, `rez.solver`, `rez.packages`, `rez.package_maker`, `rez.config`, `rez.rex`, `rez.build_process`, `rez.suite`, `rez.version`, `rez.utils.*`…). Signatures with types; grep the class or method name.
- `scripts/crawl.py`: builds and refreshes the mirror.

## How to answer

1. **Find candidate pages.** Grep `docs/index.tsv` for the feature's names. Try synonyms: "release path" and `release_packages_path`, "search path" and `packages_path`, "local packages" and `local_packages_path`, "implicit" and `implicit_packages`.
2. **Search the bodies** when the question names something specific: a package attribute (`hashed_variants`, `relocatable`, `cachable`), a rex function (`setenv`, `alias`, `expandable`), a config key (`package_filter`, `package_orderers`, `default_shell`), an env var (`REZ_PACKAGES_PATH`, `REZ_BUILD_TYPE`), a CLI flag (`--fail-graph`, `--patch`), a class (`ResolvedContext`, `PackageMaker`). Grep `docs/` with `output_mode: files_with_matches`, then `content` with context on the best few files.
3. **Read the pages.** Read the two to five most relevant pages. Long pages (`configuring_rez`, `changelog`, big API modules) can be grepped for the heading or key and read with `offset` and `limit`.
4. **Answer with sources.** Give the answer, then the URL(s) from each page's `Source:` line. Quote only the sentence, option or code lines that settle a point. When writing `package.py` or `rezconfig.py`, follow the idioms the docs show.
5. **Say what the docs don't settle.** The docs often omit defaults, edge cases and Windows details. When behaviour matters, check the installed rez: `rez --version`, `rez config <key>` for the effective value of a setting, `rez-context --interpret` for the shell code a context generates, or the rez source in the install (`python -c "import rez, os; print(os.path.dirname(rez.__file__))"` with rez's Python). `rezconfig.py` in that folder is the authoritative list of defaults.

If nothing in the mirror covers the question, say so plainly rather than filling the gap from memory. Then offer what you know, labelled as unverified for this release.

## Gotchas the 3.4 docs confirm

- **CLI pages were generated on Windows** (the mirror is built locally from the git tag): `rez-env --shell` choices there list `cmd, gitbash, powershell, pwsh` only, because argparse lists the shells available on the build machine. On Linux the list is the Unix shells. Don't conclude a shell is unsupported from that list; check the install with `rez-plugins` and `rez config default_shell`.
- **Forward slashes in `commands()`**, even on Windows: rez expects POSIX-style paths and normalizes them for the shell (`package_commands`, "Filepaths").
- **`@late` functions import inside the function**, never at the top of `package.py` (`package_definition`, late binding warning).
- **Deprecations** are listed per release in `changelog.md` (`### Deprecated` / `### Deprecations` headings); grep there before calling a setting or method obsolete.

## Keeping the mirror

The mirror is a one-time crawl pinned to 3.4. If `docs/` is missing or empty, or the user asks for a refresh:

```
uv run scripts/crawl.py              # rebuild from the git tag (default)
uv run scripts/crawl.py --source web # fetch rez.readthedocs.io instead
```

By default the crawler shallow-clones github.com/AcademySoftwareFoundation/rez at the release tag (from this folder's name, `rez-3-4` means the latest 3.4.x tag; `--version` overrides), builds the Sphinx docs in a throwaway `uv` venv, checks the built title names that version, converts the HTML and deletes the temp dir. It needs `git` and `uv`. `Source:` lines point at the canonical `https://rez.readthedocs.io/en/<version>/` page. It never uses a branch, `stable` or `latest`, so a refresh never moves to a newer release. `--source web` is slow: readthedocs.io answers request bursts with a Cloudflare challenge, so it uses one worker and backs off.

For another release, copy the skill to `rez-<major>-<minor>` (for example `rez-3-5`), delete its `docs/`, update the version in this file and the description, and run the crawler there.

Run it from this skill's directory. The rez docs are Apache 2.0 (Contributors to the Rez Project): the mirror is a private offline reference.
