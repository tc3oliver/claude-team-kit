# Claude Team Kit 0.1.8 (prerelease)

The lead stops rationing on its own, sees which teammates need attention, and is woken less for
nothing. No new runtime dependencies (still only `zod`). The worker cap, model routing and sync
behaviour are unchanged. Two new options, both off by default.

This is still a **public preview**. Agent Teams are experimental in Claude Code and Mods (which carry
the cap and the team line) are early access, so it can break when Claude Code changes. Read "Known
limitations" before you rely on it.

## The model no longer sees your quota

`ctk_team_status` used to return the 5h and weekly usage, reset times and cost on every call. In a
long team run the lead read them and stopped opening workers to "wrap up", which nobody had asked for
([#8](https://github.com/tc3oliver/claude-team-kit/issues/8)). The figures now come back only when
`/ctk` is asked about usage. The band and Mission Control still show them to you.

If you do want a limit, set it yourself: `team.stopAtFiveHourPct` or `team.stopAtCostUsd` (0 is off).
Past it, a new teammate spawn is refused with `TEAM_BUDGET_REACHED` and you get a notice. Workers that
are already running carry on.

## Which teammate needs you

- **Stalled**: a teammate with a task in progress and no tool call for 10 minutes, or three failed
  calls in a row. It shows in the band and on Workers, and you get one notice per stall.
- **`N ready · M idle`** in the band when there are tasks ready to start and teammates idle.
- **Unverified**: a task a teammate marked done stays unverified until the lead runs a check.
- **Collisions**: two live agents writing the same file are flagged, for information only.
- **Tokens per teammate** on Workers. No price: Claude Code reports cost per session only.
- The Usage page forecasts when the 5h limit is reached at the current pace.

## Fewer wasted turns

- A teammate, or the lead, that claims a task no longer gets its own `task_assignment` back. That echo
  used to wake it for a whole extra turn.
- The lead is no longer woken by shutdown approvals, or by terminations that released no task.
- The implementer does not load the Artifact and Workflow tools. It reports a test failure outside its
  own files and finishes, instead of waiting on other workers. Reviewers report at most 8 findings.
- `/ctk-report` adds a Friction line, and the prompt suggests `/ctk-report` when the team finishes.

## Also

Notices also show as an in-terminal toast, `/ctk-doctor` shows the engine version, `ctk doctor`
reports the mods check as unknown under WSL, and the team skill has preset recipes
(`skills/team/references/presets.md`).

## Upgrade

`/plugin marketplace update ctk-kit`, then `/plugin update ctk@ctk-kit`. **An update only arrives
when the plugin `version` changes** (the manifest pins it), and it did — 0.1.7 to 0.1.8 — so a
normal update reaches you and keeps your options, the worker cap and model routing.

If you prefer a plain status line, set `CTK_COLOR=0` in the `env` object of your
`settings.json`.

## Install

In Claude Code (needs 2.1.287 or newer):

```
/plugin marketplace add tc3oliver/claude-team-kit
/plugin install ctk@ctk-kit
```

Then `/reload-plugins`. Turn on Agent Teams by adding `"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"`
to the `env` object of your `settings.json` and restarting (a plugin cannot do this for you).
`/ctk-doctor` checks the setup and prints the exact fix for anything missing.

## Uninstall

`/plugin uninstall ctk@ctk-kit`, then `/plugin marketplace remove ctk-kit`. The mod's counters stay
in `<config>/ctk/stats/`. Claude Code has no rollback command; to return to an earlier release,
remove the marketplace, add it at that tag (`/plugin marketplace add
tc3oliver/claude-team-kit#v0.1.7`) and install again with your options. Details:
[docs/INSTALLATION.md](docs/INSTALLATION.md#update-and-remove-native).

## Known limitations

Full list: [docs/LIMITATIONS.md](docs/LIMITATIONS.md). The ones to know first:

- The cap needs Mods (Claude Code 2.1.287 or newer; reportedly not available in WSL). Without them
  there is no cap, no team line, and `/ctk:team` says so before starting.
- Worktree isolation and the cap exclude each other: a named `Agent` call that passes
  `isolation: worktree` is an ordinary subagent, which the cap does not count.
- The settings compare-and-swap (from `v0.1.2`) is not a lock; see the [threat
  model](docs/THREAT-MODEL.md#settingsjson-compare-and-swap-is-not-a-lock).
- Skill behaviour is guidance: the lead may follow `/ctk:team`, `/ctk:review` and `/ctk:debug`
  imperfectly, and no code checks that a task was verified.
- A confirmed settings change reloads the mod and loses per-worker and per-task detail until new
  events arrive (the counters in the stats file continue).
- Always-on context is about 480 tokens, above the 250-token goal and close to the 500-token CI
  budget.

## Platforms

| | Status |
|---|---|
| macOS | Verified live: install, version-bump update with options kept, uninstall, the cap, guard states, Mission Control by real clicks |
| Linux, Windows | **CI only** — tests, `plugin validate --strict`, `plugin test` and the pack audit run on ubuntu, macos and windows with Node 22 and 24. Not run interactively |
| Windows Terminal, VS Code terminal, WSL | **Not verified** |

A passing CI run is not interactive support. Matrix: [docs/LIMITATIONS.md](docs/LIMITATIONS.md#platforms).

## Reporting problems

Open an issue at <https://github.com/tc3oliver/claude-team-kit/issues>. Include Claude Code's
version, your OS and terminal, the output of `/ctk-doctor` and `/ctk-stats`, and what you ran. For a
security problem use a private advisory instead ([SECURITY.md](SECURITY.md)); do not paste
credentials or settings files.

## Published as

This is the GitHub **prerelease** `v0.1.8` with the npm tarball attached. The earlier prereleases
`v0.1.7`, `v0.1.6`, `v0.1.5`, `v0.1.4`, `v0.1.3`, `v0.1.2`, `v0.1.1` and `v0.1.0` are unchanged. Not published to npm and not in any official Claude
Code plugin directory. The repository works as a plugin marketplace as it is, and installing from the
tag is what `/plugin marketplace add tc3oliver/claude-team-kit#v0.1.8` does. `npm publish` stays a
manual step after review.
