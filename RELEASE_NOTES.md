# Claude Team Kit 0.1.11 (prerelease)

A small release on top of 0.1.10: a team can take several Backlog tasks at once, a failed goal no
longer leaves its workers stuck, and `/ctk-doctor` shows which CTK version is loaded. No new runtime
dependencies (still only `zod`) and no new plugin options. The worker cap, model routing and sync
behaviour are unchanged.

This is still a **public preview**. Agent Teams are experimental in Claude Code and Mods (which carry
the cap and the team line) are early access, so it can break when Claude Code changes. Read "Known
limitations" before you rely on it.

## Several Backlog tasks in one team

When you name several `BL-` tasks, or ask a team to run the ready queue, the lead takes them
together. Each task keeps its own files, tasks that would touch the same files are ordered rather
than run at once, and each closes on its own verified evidence: one passing never closes another.
The lead stops after the set you asked for. Nothing changes unless you ask for several. Companion
change in the Backlog Skill: tc3oliver/skills#26.

## A failed goal no longer strands its workers

With `ctk_goal`, a goal whose verification or review keeps failing cannot close, and the lead was
told not to shut workers down while it could not close. The workers stayed live and the next goal
was refused. Now the lead keeps them for a fix, tells you which are live and which tasks are open,
and asks. If you drop the fix, it records the handoff, shuts the workers down, clears the open
tasks and abandons the goal, so the next one can start. Skill-guided: not yet run live.

## Also

- `/ctk-doctor` shows `ctk: 0.1.11`, read from the plugin's own manifest.
- `ctk_team_status` rounds each worker's context percentage.
- Contributor notes corrected (the plugin type-checks cleanly; `subagentStatusLine` was removed by
  Claude Code 2.1.323), and releases are now named `Claude Team Kit <version>` automatically.

## Upgrade

`/plugin marketplace update ctk-kit`, then `/plugin update ctk@ctk-kit`. **An update only arrives
when the plugin `version` changes** (the manifest pins it), and it did — 0.1.10 to 0.1.11 — so a
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
tc3oliver/claude-team-kit#v0.1.10`) and install again with your options. Details:
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

This is the GitHub **prerelease** `v0.1.11` with the npm tarball attached. The earlier prereleases
`v0.1.10`, `v0.1.9`, `v0.1.8`, `v0.1.7`, `v0.1.6`, `v0.1.5`, `v0.1.4`, `v0.1.3`, `v0.1.2`, `v0.1.1` and `v0.1.0` are unchanged. Not published to npm and not in any official Claude
Code plugin directory. The repository works as a plugin marketplace as it is, and installing from the
tag is what `/plugin marketplace add tc3oliver/claude-team-kit#v0.1.11` does. `npm publish` stays a
manual step after review.
