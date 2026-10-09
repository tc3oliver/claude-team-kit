# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- The band shows the git branch (`git:main`, a short commit id when HEAD is detached) when the CTK status line is not configured, which already shows it. It reads `.git/HEAD` through `fs.read` from the session's directory (new host call `session.cwd`), refreshes on each turn and each prompt, is cut to 28 cells, and is left out below 80 columns.

## [0.1.1] - 2026-10-09 (prerelease)

### Added

- `ctk:designer`, a read-only Opus agent for UI/UX and interface design that returns one design brief (hierarchy, layout per width, every state, colour rules, acceptance checks, risks) for the lead to hand to implementers. Model option `designerModel` (default `opus`, profile field `routing.designer.model`). Skill-guided: the team skill's model-routing note names it, but nothing forces the lead to call it. A named designer is a native teammate and counts against the cap.

### Changed

- README rewritten as a product page: the real Run F recording first, three reasons to use CTK, the install (agent prompt and manual) before the workflow, and a short gallery of Mission Control stills. Recording logistics stay in `docs/DEMO.md`.
- Mission Control at the real docked width (about 48 cells): the tabs stack in two lines of full labels instead of a digits-only row, the last-resort tab tier keeps a three-letter name, and a fan-in in the task graph shares one trunk; the graph's row budget follows the pane height.

- The default worker cap is now 5 (was 3), still 1 to 12. An explicit setting is never touched: an installed plugin that was configured to a value keeps it, and one that was never configured follows the new default after it updates.
- Mission Control, the band and the status tool now tell ordinary subagents apart from native teammates. An `Agent`
  call without a `name` is an ordinary subagent: it is listed in its own "Ordinary subagents" section (type, status,
  description from the roster), counted as `Subagents` / `Sub n`, and still not counted or limited by the worker cap.
  Found in a real session where the lead ran three `ctk:*` agents without names: the guard saw three spawns, and the
  Workers and Tasks pages were empty with no explanation.
- The empty Workers and Tasks pages say why they are empty and what to do; `ctk_team_status` returns the same text as
  `explain`. The `Guard ON` reason now says how many of the spawns it saw were teammates.
- The `ctk:team` description and intent gate recognise a plain request to use CTK ("use ctk's flow", ctk 流程). In one
  paired run of that sentence, the old description loaded `ctk:ctk` and spawned an unnamed `ctk:implementer`; the new one
  loaded `ctk:team`. One sample each: not a measured rate.
- Proposing a setting change now tells the lead to say "press Confirm in Mission Control", and the band shows
  `Confirm setting: click here` until the change is answered.

### Mission Control

- Overview redesigned: a state pill in the header (`ACTIVE`, `READY`, `CAPACITY`, `ERROR`, unavailable), a slot meter, WORKERS, TASKS, REFUSED and COST cards, 5-hour and weekly quota bars, and a short guard sentence. A full team reads `CAPACITY` (amber, red after a refusal) instead of plain `ACTIVE`.
- Workers: two lines per worker when there is room, an activity bar (tool calls relative to the busiest worker, not progress), and a worker's last tool calls on its detail page (tool name and file base name only).
- Tasks: a progress bar, the ready frontier and a layered graph drawn only from declared dependencies; a completed task reads "marked complete (TaskUpdate; not verified)".
- Usage, Config (pending change first, options grouped), Stats (counted and measured) and Doctor (fixes first) reorganised.
- Text is wrapped instead of cut mid-sentence, the tabs shrink in steps instead of wrapping, and every view stays inside a row budget (11 rows above the prompt, more when docked); what is left out says how to see it. After six tasks the band adds `full list: Mission Control`.
- Event-driven motion: a running worker's glyph pulses once a second and new workers, completed tasks and refusals are highlighted for three seconds, only while the pane is open and something runs. `CTK_REDUCED_MOTION=1` or `NO_COLOR` turns it off; no timer runs with the pane closed.
- The Mission Control code is split into `hooks/ui/` modules, one per view.

### Added

- Natural-language team hint: a fixed English and Chinese phrase check on the person's own prompt (Enter or Remote Control) adds one hidden line asking the model to invoke `ctk:team` when the request is for several agents, a team or parallel work. No model call, no always-on context, not a classifier; the model and the skill's intent gate still decide. The new option `teamHint` (default on) turns it off; the list asks for agents or a team by name, so a bare "parallel" or "in parallel" does not match. One real session showed it working; not a measured rate.
- `INSTALL.md`, an install checklist for coding agents, and an "Install with your AI Agent" prompt in the README. Both use only the native Plugin Manager.

## [0.1.0] - 2026-10-09 (prerelease)

### Added

- Plugin skills `/ctk:team`, `/ctk:review` and `/ctk:debug`.
- Four role agents: `explorer`, `implementer`, `reviewer` and `high-risk-reviewer`.
- Team cap: spawns beyond the limit are refused with `TEAM_CAPACITY_REACHED`.
- Team band above the prompt, with a status line fallback. Both show model, 5-hour and weekly
  usage with reset countdowns, context, cost, and (band only) tool calls, agents and tasks, laid out
  for the terminal width: full, abbreviated and essentials-only forms, whole figures dropped by rank,
  CJK and ANSI aware. When CTK's status line is configured the band drops what it shows.
- Mission Control: the band is one clickable button (`CTK ▸ …`) that opens a read-only pane with the
  team's guard state, workers, tasks and usage; also `/ctk-mission`. Anything not observed reads
  "unavailable". See docs/MISSION-CONTROL.md.
  In a docked pane (about 50 cells) the Workers and Tasks tables use a compact form.
- A recording of Mission Control opened by a click after a plain-words request (docs/DEMO.md, Run E).
- docs/WORKFLOW.md and an animated illustration of the workflow (one goal, a task graph, the ready frontier, three
  workers, a handoff, a verification), labelled as an illustration; each step says whether Claude Code, a skill or
  the mod is responsible. Source and checks in scripts/media/how-it-works.
- `ctk_config` tool: the model can propose an option change in plain words; only the user's Confirm
  button in Mission Control applies it. Option `hudIdle` (full, minimal, hidden) sets what the band shows
  before a team has started.
- `ctk` CLI commands: `install`, `doctor`, `update`, `rollback`, `uninstall`,
  `stats` and `config`.
- `ctk sync` for git-based profile sync, with a secrets scan before publish.

### Fixed

- The demo recorder's masking test could fail on Linux: it recorded a command that exits at once, which tmux 3.3/3.4 can lose.
  The test now ends on an event, the recorder counts mask replacements per stored frame, and an empty recording exits 5.
- The team skill no longer advises `isolation: worktree`. A live probe on Claude Code 2.1.295 showed that a named
  agent that passes `isolation` is not a teammate, so the worker cap neither counted nor refused it: the skill's
  own advice let workers escape the limit. The skill now says never to set `isolation` and to name every worker.
- Guard health is judged from evidence: `ON` only after a spawn has reached the guard in the session and Agent
  Teams are confirmed on; `ready` when loaded but not yet exercised (or the flag cannot be read); `unavailable` or
  `error` otherwise, including when more teammates are live than the cap. Shown in the band, Mission Control,
  `/ctk-doctor`, `/ctk-stats` and the status tool; the team skill's preflight reads it and asks before starting a
  team without a confirmed cap. Named agents that start outside the cap are counted and shown.
- The team skill bounds retries (one retry, then stop), keeps one owner per task, reuses idle teammates before
  spawning, and says the goal is not complete when a task failed or was never verified.

See RELEASE_NOTES.md for details and docs/LIMITATIONS.md for known limitations.
