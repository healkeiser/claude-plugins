---
name: kitsu
description: >-
  Kitsu (CGWire) production tracking documentation mirrored locally as searchable Markdown: the Kitsu developer docs (guides, recipes, plugins, integrations, self-hosting, the gazu SDK reference, data models, zou CLI) and the full Zou REST API reference from its OpenAPI spec (every endpoint, parameter, request body and response). Use this whenever a task involves Kitsu, Zou or gazu, even if the user never says "docs": gazu scripting (set_host, log_in, set_token, project, asset, shot, task, person, files, playlist, casting, client, gazu.aio), event listeners (gazu.events, set_event_host, task:update), polling the event log, raw REST calls (/api/data, /api/actions, /api/auth), bots and API tokens, roles, task tracking, comments and previews, file trees, kitsu-client-js, custom actions, webhooks and Slack/Discord/Mattermost notifications, DCC integrations (Blender, Unreal, Toon Boom Harmony), Kitsu plugins, self-hosting (Docker, env vars, LDAP, OIDC/SAML SSO, preview storage, job queue, backups, update, zou upgrade-db) and migrating from ShotGrid. Prefer it over memory: endpoints and gazu signatures change often.
---

# Kitsu

A local copy of the Kitsu developer documentation and the Zou REST API reference. The Kitsu docs are not versioned: they describe the current release at crawl time. `docs/VERSIONS.md` (and the first line of `docs/index.tsv`) records the crawl date, the Zou API version from the OpenAPI spec and the latest `gazu` and `zou` on PyPI. When behaviour matters and the user's install may be older, compare: `python -c "import gazu; print(gazu.__version__)"` for the client, `GET /api` on their server (no token needed; it returns the API name and version) or `zou version` on the host for the server, and say so when their versions differ from the recorded ones. Answer from the mirror rather than from memory: endpoints, query parameters and gazu signatures move between releases.

## Where things are

The docs live in `${CLAUDE_PLUGIN_DATA}/kitsu/docs/`; below, `docs/` means that folder. They are built on this machine, not shipped with the plugin. If `docs/index.tsv` is missing, build it before answering (tell the user it takes about a minute): `uv run "${CLAUDE_SKILL_DIR}/scripts/crawl.py" --out "${CLAUDE_PLUGIN_DATA}/kitsu/docs"`.

- `docs/index.tsv`: a `#` comment line with the versions, then one line per page: `file`, `title`, `summary`. Search it first.
- `docs/VERSIONS.md`: what the mirror describes (crawl date, Zou API version, latest gazu and zou).
- `docs/dev/`: dev.kitsu.cloud, the narrative docs.
  - `start-here/`: dev quickstart, AI agent quickstart, Docker image, cloud hosting, migrate to Kitsu, coming from ShotGrid (concept mapping).
  - `guides/`: authentication, permissions and roles, team management, production setup, project templates, task tracking, publishing (review engine), asset management, casting, bots, event listeners, search, caching, custom actions, session management, async client, logging.
  - `recipes/`: import a studio team, build a plugin, progress callbacks, file management (file trees, path building).
  - `kitsu-plugins/`: plugin installation and development. `integrations/dcc/` (Blender, Unreal Engine, Toon Boom Harmony) and `integrations/messaging/` (Slack, Discord, Mattermost).
  - `self-hosting/`: architecture, hardware, setup, update, environment variables, full-text search, preview storage (S3), job queue, LDAP, SAML, OIDC SSO, log rotation, backup, data migration, troubleshooting. `open-source/`: contributing, dev environment.
  - `references/gazu.md`: the gazu SDK reference, one long page (7,000+ lines). One `## <module>` heading per module (`gazu`, `aio`, `asset`, `cache`, `casting`, `client`, `concept`, `context`, `edit`, `entity`, `events`, `files`, `person`, `playlist`, `project`, `project_template`, `scene`, `search`, `shot`, `sorting`, `studio`, `sync`, `task`, `user`…) and one `### gazu.<module>.<function>(<signature>)` heading per function with a parameter table and return value. Grep `^### gazu.task.` or the function name, then read that section with `offset`/`limit`.
  - `references/data-models.md` (database models and fields), `references/cli.md` (`zou` commands).
- `docs/api/`: the Zou REST API, generated from its OpenAPI spec (api-docs.kitsu.cloud). One page per tag (`tasks.md`, `assets.md`, `shots.md`, `persons.md`, `projects.md`, `playlists.md`, `previews.md`, `files.md`, `comments.md`, `events.md`, `authentication.md`, `user.md`, `import.md`, `export.md`, `crud.md`, `index.md` is the "Index" tag, not a table of contents…). Each operation is a `## METHOD /path` heading with summary, description, a `Docs:` link to its page on api-docs.kitsu.cloud, a parameter table (name, in, type, required, description), the request body fields and the response codes with their JSON fields. `schemas.md` lists the model schemas; `overview.md` has the API intro, auth scheme and server URL.
  - Paths are relative to the API root: on a server they are under `/api` (`https://<host>/api/data/projects`). gazu's `set_host` takes that `/api` URL, and `gazu.client.get("data/projects")` takes the path without the leading `/api`.
  - The generic per-model routes (`GET/PUT/DELETE /data/tasks/{instance_id}`, `GET /data/projects`, filtering by column as query parameters) are in `crud.md`, not in the topic pages.
- `${CLAUDE_SKILL_DIR}/scripts/crawl.py`: builds and refreshes the mirror.

## Which source to use

- **How do I do X with Kitsu?** `dev/guides/` and `dev/recipes/` first; they show the intended workflow with gazu code.
- **What is the exact gazu function and its arguments?** `dev/references/gazu.md`. Guides sometimes use older names; the reference wins.
- **What is the exact REST endpoint, parameter or response?** `api/<tag>.md`. It is generated from the server's own spec, so when a guide's raw-URL example disagrees with it (for example guides poll `data/events/last?page_size=100`, while the spec documents `limit` and `cursor_event_id`), trust `api/` for the current server and say the guide may be outdated.
- **Which fields does an entity have?** `api/schemas.md` and `dev/references/data-models.md`.
- **kitsu-client-js** (the JavaScript client) is only linked from the docs (github.com/cgwire/kitsu-client-js), not mirrored; its calls wrap the same REST routes as `api/`.
- **Running a server** (install, env vars, SSO, storage, backup, update): `dev/self-hosting/`; `zou` commands in `dev/references/cli.md`.

## How to answer

1. **Find candidate pages.** Grep `docs/index.tsv` for the feature. Try Kitsu's words and synonyms: "casting" and "breakdown", "entity" and "asset"/"shot", "preview" and "revision", "bot" and "token", "status" and "task status", "person" and "user".
2. **Search the bodies** for anything specific: a gazu function (`get_task_by_entity`, `add_comment`), an endpoint path fragment (`/actions/tasks`, `events/last`), a parameter (`cursor_event_id`), an event name (`task:status-changed`, `comment:new`), an env var (`PREVIEW_FOLDER`, `KV_HOST`). Grep `docs/` with `output_mode: files_with_matches`, then `content` with context on the best few files. In `api/`, grep `^## .*<path fragment>` to find an operation.
3. **Read the pages.** Read the two to five most relevant pages; read long pages (`references/gazu.md`, `api/crud.md`) by section with `offset` and `limit`.
4. **Answer with sources.** Give the answer, then the URL(s) from each page's `Source:` line (for an API operation, its `Docs:` line). Quote only the line, table row or code that settles a point. Write code with the calls and parameter names as the docs show them.
5. **Say what the docs don't settle.** Many gazu parameter tables say `-` for the description, and many API responses list no fields: say so instead of guessing types or defaults. When the answer depends on the user's server or gazu version, say which version the mirror describes and how to check theirs. If nothing in the mirror covers the question, say so plainly rather than filling the gap from memory; then offer what you know, labelled as unverified.

Points the docs confirm and people often get wrong:

- `gazu.set_host` takes the API URL ending in `/api`; `gazu.set_event_host` takes the server URL without `/api`. `gazu.events.run_client` blocks, so run the listener in its own thread or process (`guides/event-listeners`).
- Scripts and services should log in as a bot: an admin creates it on the Bots page, which shows its API token in a pop-up (regenerating it revokes the old one); the script calls `gazu.set_token(token)` instead of `log_in`. Bots do not count as active users (`guides/bot-automation`).
- The `cgwire/cgwire` Docker image is for local testing, not production (`start-here/docker`). After updating Zou, run `zou upgrade-db` (`self-hosting/update`, `references/cli`).
- Custom actions send the user's selection to your URL from the browser; only studio managers can create them (`guides/custom-actions`).

## Keeping the mirror

The mirror is a snapshot of the current docs. If `docs/` is missing or empty, or the user asks for a refresh (for example after a Kitsu release), run:

```
uv run "${CLAUDE_SKILL_DIR}/scripts/crawl.py" --out "${CLAUDE_PLUGIN_DATA}/kitsu/docs"             # everything, about a minute
uv run "${CLAUDE_SKILL_DIR}/scripts/crawl.py" --out "${CLAUDE_PLUGIN_DATA}/kitsu/docs" --only api  # one source: dev | api
```

Each run fetches everything again, rewrites the pages and updates `VERSIONS.md`. Docs for older Kitsu releases are not published separately, so for an older server, flag answers that may depend on a newer release.

The Kitsu docs are CGWire's work: the mirror is a private offline reference. Don't copy it into a repository or publish it.
