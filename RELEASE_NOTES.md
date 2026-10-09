# Claude Team Kit 0.1.0 (prerelease)

A lightweight companion plugin for Claude Code's native Agent Teams: a hard cap on how many teammates run at once, a
clickable read-only Mission Control, and skills that guide the lead to split work into verifiable tasks. The lead and the
teammates stay Claude Code's own; CTK is not a second orchestrator or scheduler.

This is a **public preview**. Agent Teams are experimental in Claude Code and Mods (which carry the cap and the team
line) are early access, so it can break when Claude Code changes. Read "Known limitations" before you rely on it.

## Install

In Claude Code (needs 2.1.287 or newer):

```
/plugin marketplace add tc3oliver/claude-team-kit
/plugin install ctk@ctk-kit
```

Then `/reload-plugins`. Turn on Agent Teams by adding `"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"` to the `env`
object of your `settings.json` and restarting (a plugin cannot do this for you). `/ctk-doctor` checks the setup and
prints the exact fix for anything missing; it reads `Guard ready` until the first spawn and `Guard ON` after a spawn has
reached the guard.

## Upgrade

`/plugin marketplace update ctk-kit`, then `/plugin update ctk@ctk-kit`. **An update only arrives when the plugin
`version` changes** (the manifest pins it): a preview installed from an earlier commit with the same version will say
"already at the latest version". Reinstall to catch up: `/plugin uninstall ctk@ctk-kit`, then install again, passing
your options with `--config KEY=VALUE`, because **uninstalling deletes the plugin's options** from `settings.json`
(note your cap first; `/ctk-doctor` shows it). Tested live: a version-bump update keeps the options and the mod loads.

## Uninstall

`/plugin uninstall ctk@ctk-kit`, then `/plugin marketplace remove ctk-kit`. The mod's counters stay in
`<config>/ctk/stats/` (delete it if you like). Claude Code has no rollback command; to return to a release, add the
marketplace at its tag (`/plugin marketplace add tc3oliver/claude-team-kit#<tag>`; the `#<ref>` form was tried with a
branch) and install again. Details:
[docs/INSTALLATION.md](docs/INSTALLATION.md#update-and-remove-native).

## What is in it

- **Skills:** `/ctk:team` (a goal into vertical slices with real dependencies, a capped native team, a verification
  before "done"), `/ctk:review` (review depth scaled to risk), `/ctk:debug` (reproduce, hypothesise, fix, regression
  test), and `ctk` (status and settings in plain words). **Agents:** `explorer`, `implementer`, `reviewer`,
  `high-risk-reviewer`, with a model per role unless a spawn names one.
- **Worker cap (mod):** a teammate spawn above the cap (default 3, 1 to 12) is refused with `TEAM_CAPACITY_REACHED`;
  if the roster cannot be read it is refused with `TEAM_GUARD_FAILED` instead of guessed.
- **Team line and Mission Control (mod):** one line above the prompt (model, 5-hour and weekly usage with reset
  countdowns, tool calls, agents against the cap, tasks, context, cost, fitted to the terminal width) that you click to
  open a read-only pane with workers, tasks and usage. Anything not observed reads `unavailable`.
- **Optional `ctk` CLI** (not needed for the plugin): a status line, profile sync through a git repository you own
  with a secrets scan before publish, an install ledger with rollback and uninstall.

What CTK adds to a session: about 425 tokens of always-on context (measured with a real call), no model calls, no
network calls, no credential reads. A skill's body loads only when it is used.

## What the worker cap does and does not cover

It counts and refuses **teammate** spawns only. Observed live on Claude Code 2.1.295: a named `Agent` call is a
teammate (any agent type, from any plugin) and is capped; an unnamed call, a fork, and a named call that passes
`isolation: worktree` are ordinary subagents, which the cap does not count. The team skill therefore never uses
`isolation` and names every worker, and Mission Control counts named agents that started outside the cap. It limits how
many teammates are alive, not what they spend, and CTK queues nothing: the lead keeps a refused task pending.

## Known limitations

Full list: [docs/LIMITATIONS.md](docs/LIMITATIONS.md). The ones to know first:

- The cap needs Mods (Claude Code 2.1.287 or newer; reportedly not available in WSL). Without them there is no cap, no
  team line, and `/ctk:team` says so before starting.
- Worktree isolation and the cap exclude each other (above).
- Skill behaviour is guidance: the lead may follow `/ctk:team`, `/ctk:review` and `/ctk:debug` imperfectly, and no code
  checks that a task was verified. `/ctk:review` and `/ctk:debug` have not been run on real changes.
- Whether a plain sentence loads the team skill is Claude's decision; the evals were tuned on the same prompts.
- Always-on context is about 425 tokens, above the 250-token goal.
- The team line can vanish for a few seconds after the lead's turn ends while workers run (cause unknown).
- A confirmed settings change reloads the mod and loses per-worker and per-task detail until new events arrive.
- Model routing to different models on live teammates was not shown (the recordings used Sonnet throughout).
- The recordings were made before the guard-state change: they show `Guard ON` at start where this version shows `ready`.

## Platforms

| | Status |
|---|---|
| macOS | Verified live: install, update, version-bump update, uninstall, the cap, guard states, Mission Control by real clicks (in tmux), width captures |
| Linux, Windows | **CI only** (tests, `plugin validate --strict`, `plugin test`, pack audit on ubuntu, macos and windows). Not run interactively |
| Windows Terminal, VS Code terminal, WSL | **Not verified** |

A passing CI run is not interactive support. Matrix: [docs/LIMITATIONS.md](docs/LIMITATIONS.md#platforms).

## Breaking changes

None: this is the first preview. Option names (`maxWorkers`, `hudBand`, `hudIdle`, `recordStats`, four model options) may
still change before 1.0.

## Reporting problems

Open an issue at <https://github.com/tc3oliver/claude-team-kit/issues> (bug report template). Include Claude Code's
version (`claude --version`), your OS and terminal, the output of `/ctk-doctor` and `/ctk-stats`, and what you ran. For a
security problem use a private advisory instead ([SECURITY.md](SECURITY.md)); do not paste credentials or settings files.

## Not published

No git tag exists and nothing has been published to npm, to GitHub Releases or to an official Claude Code plugin
directory. The repository works as a plugin marketplace as it is. The release workflow builds and attaches an npm
tarball, as a prerelease for `v0.*` tags, only when a `v*` tag equal to the package and plugin version is pushed;
`npm publish` is a manual step after review.
