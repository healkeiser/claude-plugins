---
name: deadline-10-4
description: >-
  Thinkbox (AWS) Deadline 10.4 render farm documentation mirrored locally as searchable Markdown: the full Deadline 10.4 User Manual (10.4.3.4), the in-app Scripting Reference (Deadline.Plugins, Deadline.Events, Deadline.Scripting, Deadline.Jobs, FranticX.Processes) and the Standalone Python Reference (Deadline.DeadlineConnect). Use this whenever a task touches Deadline in any form, even if the user never says "docs": render farm setup and admin, deadlinecommand, the Monitor, Workers (formerly Slaves), pools, groups, limits and machine limits, job scheduling and priority, job submission with job info and plugin info files, submitting from Houdini, Maya, Nuke, Cinema 4D, Blender, After Effects or a command line, application plugins (.dlinit, .param, .py, DeadlinePlugin, ManagedProcess, RunProcess, stdout handlers), event plugins (OnJobSubmitted, OnJobFinished, OnSlaveStarted, DeadlineEventListener), job scripts and Monitor scripts, path mapping, the Deadline web service and REST API, DeadlineConnect standalone Python (Jobs, Tasks, Slaves, Pools, Groups, Limits, Repository), the repository and its MongoDB database, Launcher, Pulse, Remote Connection Server, power management, AWS Portal and Spot, licensing, upgrades. Prefer it over memory: Deadline options, callbacks and API names change between releases.
---

# Deadline 10.4

A local copy of the Thinkbox Deadline 10.4 documentation (crawled 2026-11-01; the manual reports patch release **10.4.3.4**). The version is pinned: the folder name is the release the pages describe. If the user's farm runs another version (`deadlinecommand -GetVersion`, or Help > About in the Monitor), say which version the docs are and flag what may differ. Answer from the mirror rather than from memory: recalled Deadline knowledge often mixes 8.x/9.x/10.x behaviour and invents plausible method names.

## Where things are

Paths are relative to this skill's directory.

- `docs/index.tsv`: one line per page: `file`, `title`, `summary` (first paragraph, cut to 240 characters). Search it first.
- `docs/manual/manual/` (344 pages): the User Manual, Sphinx. File prefixes group topics:
  - `app-<dcc>.md`: one page per application plugin and submitter: options, plugin configuration, FAQ, error messages (`app-houdini`, `app-maya`, `app-nuke`, `app-cinema-4d`, `app-blender`, `app-after-effects`, `app-arnold`, `app-redshift`, `app-vray`, `app-command-line`, `app-python`…).
  - `job-*`: submitting, scheduling (pools, groups, priority, limits interplay), controlling, monitoring, archiving, transferring, job scripts. `manual-submission.md`: job info and plugin info files and `deadlinecommand` submission.
  - `command*.md`: `deadlinecommand` and every flag by area (`command-line-arguments-jobs`, `-workers`, `-pools-groups`, `-pathmapping`, `-repo`…).
  - `rest-*.md`: the REST API over the web service (jobs, tasks, workers, pools, groups, limits, users, repository, reports). `web-service.md`: running the web service.
  - Scripting: `scripting-overview.md`, `application-plugins.md` (plugin layout, `.dlinit`/`.param`/`.py`, simple vs advanced plugins), `event-plugins.md` (callbacks table, `.param` config), `job-scripts.md`, `monitor-scripts.md`, `standalone-python.md`, `plugin-config.md`, `plugin-sandboxing.md`.
  - `event-*.md`: shipped event plugins (Shotgun, ftrack, Draft, Rez, Spot…).
  - Admin: `repository-config.md`, `worker-config.md`, `worker.md`, `monitor.md`, `launcher.md`, `pulse*.md`, `remote-connection-server.md`, `power-management.md`, `pools-and-groups.md`, `limits.md`, `db-*.md` (MongoDB auth, replica sets, maintenance), `install-*`, `upgrading-*`, `licensing-*`, `aws-*` (AWS Portal), `release-notes.md`.
- `docs/scripting/` (102 pages): the **in-app** Scripting Reference (Doxygen, C# signatures). The objects a plugin, event, job script or Monitor script receives: `class_deadline_1_1_plugins_1_1_deadline_plugin.md` (DeadlinePlugin), `class_frantic_x_1_1_processes_1_1_managed_process.md` (ManagedProcess, its base class), `class_deadline_1_1_events_1_1_deadline_event_listener.md` (DeadlineEventListener: every `On*` callback), `class_deadline_1_1_jobs_1_1_job.md` / `_task.md`, `class_deadline_1_1_scripting_1_1_*_utils.md` (RepositoryUtils, ClientUtils, FrameUtils, PathUtils, JobUtils…), `namespace_script_dialog.md` (Monitor script UI), plus `namespace_*.md` overviews.
- `docs/python/` (17 pages): the **Standalone** Python Reference (Doxygen). `index.md` (setup and usage), `class_deadline_connect_1_1_deadline_con.md` (DeadlineCon), and one page per wrapper: Jobs, Tasks, Slaves, Pools, Groups, Limits (LimitGroups), Repository, Plugins, Pulse, Balancer, JobReports, TaskReports, MappedPaths, MaximumPriority, SlavesRenderingJob.
- `scripts/crawl.py`: builds and refreshes the mirror.

## Which source to use

- **Behaviour, options, settings, admin, what a submitter field does:** `manual/`.
- **Code running inside Deadline** (application plugins, event plugins, job scripts, Monitor scripts, `deadlinecommand -ExecuteScript`): the manual's scripting pages for structure, `scripting/` for exact methods and signatures. Signatures are C#; Python calls them with the same names (`self.GetPluginInfoEntry(...)`, `RepositoryUtils.GetJob(id, True)`).
- **Code running outside Deadline** (submitters, dashboards, CI, pipeline services): `python/` (DeadlineConnect, through the web service) or `manual/rest-*.md` (raw HTTP), or `deadlinecommand` (`manual/command*.md`). These are three separate APIs; don't mix their method names. `Deadline.Scripting` is not importable outside Deadline.
- **Command-line submission:** `manual/manual-submission.md` (job info keys like `Plugin`, `Frames`, `Pool`, `Group`, `LimitGroups`, `OutputFilename0`, `JobDependencies`, `EnvironmentKeyValue0`), then the `app-<dcc>.md` page for that plugin's plugin info keys.

## Gotchas the docs confirm

- "Slave" was renamed "Worker" in the UI and docs, but the APIs keep the old names: `Slaves`, `SlaveSettings`, `OnSlaveStarted`, `GetSlaveNames`, `-GetSlaveNames`. Search both spellings.
- Web service port: `manual/manual/web-service.md` says it listens on 8081 by default; `python/index.md` says the DeadlineConnect default is 8082. The real value is in Repository Options > Web Service (or proxy) settings: check there rather than trusting either default.
- Standalone API entry point (from `python/index.md`): copy the `Deadline` folder from `<repository>/api/python` into site-packages, then `import Deadline.DeadlineConnect as Connect; con = Connect.DeadlineCon(host, port)`; wrappers hang off it (`con.Jobs.GetJob(id)`, `con.Pools.GetPoolNames()`). Calls return dicts, lists or strings, not objects; edit `job['Props']` and send it back with `con.Jobs.SaveJob(job)`.
- Event plugins: `__init__` must call `super().__init__()` first (required since 10.3), and callbacks are wired with `self.OnJobSubmittedCallback += self.OnJobSubmitted` and removed in `Cleanup()` (`event-plugins.md`). The callbacks table there also says which process fires each callback.
- `manual-submission.md`: use only one family of `OutputFilename...` keys per job type (normal / maintenance / tile); don't mix them.

## How to answer

1. **Find candidate pages.** Grep `docs/index.tsv` for the feature's names. Try synonyms and old names: "Worker" and "Slave", "limit" and "LimitGroup", "machine limit" and "whitelist", "job info" and "JobInfo", "plugin info" and "PluginInfo".
2. **Search the bodies** when the question names something specific: a job info key (`ChunkSize`, `MachineLimit`, `InitialStatus`), a callback (`OnJobFinished`), a method (`RunProcess`, `GetPluginInfoEntryWithDefault`, `SuspendJob`), a `deadlinecommand` flag (`-SubmitMultipleJobs`, `-ChangeRepository`), a REST route (`/api/jobs`). Grep `docs/` with `output_mode: files_with_matches`, then `content` with context on the best few files.
3. **Read the pages.** Read the two to five most relevant pages. Doxygen class pages are long: grep for `## <Method>()` and read that section with `offset` and `limit`.
4. **Answer with sources.** Give the answer, then the page URL(s) from each page's `Source:` line. Quote only the line, table row or code that settles a point. When writing plugin or submission code, follow the templates in the manual pages rather than remembered ones.
5. **Say what the docs don't settle.** The Doxygen pages often give a one-line description with no defaults, return shapes or error behaviour, and the manual does not document every dict key the standalone API returns. Say so, and suggest checking on the farm (`deadlinecommand -GetJob <id>`, printing the returned dict, or the plugin's shipped `.py` under `<repository>/plugins/<Name>/`, which is the real reference for a shipped plugin).

If nothing in the mirror covers the question, say so plainly rather than filling the gap from memory. Then offer what you know, labelled as unverified for 10.4.

## Keeping the mirror

The mirror is a one-time crawl pinned to 10.4. If `docs/` is missing or empty, or the user asks for a refresh:

```
uv run scripts/crawl.py                   # everything again, about two minutes
uv run scripts/crawl.py --only scripting  # one source: manual | scripting | python
```

The crawler reads the version from this folder's name and exits if the manual reports another version, so a refresh never moves to a newer release (the patch release may move within 10.4; update it above if it does). For another release, copy the skill to `deadline-<major>-<minor>` (for example `deadline-10-3`), delete its `docs/`, update the version in this file and the description, and run the crawler there. Thinkbox keeps each release at `docs.thinkboxsoftware.com/products/deadline/<major>.<minor>/`.

Not mirrored: Doxygen member indexes (`functions_*.html`), `*-members.html` lists, source listings and graphs, the manual's `index-linear` site map; the Python Reference's namespace and file pages return 403. Run the crawler from this skill's directory. The documentation is Thinkbox/AWS's: the mirror is a private offline reference. Don't copy it into a repository or publish it.
