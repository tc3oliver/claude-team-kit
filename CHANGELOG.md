# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

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
