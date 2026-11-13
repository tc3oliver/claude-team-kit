# Claude Team Kit 0.1.9 (prerelease)

The lead can tell which teammates belong to the current goal and whether they have really left, a
teammate's "done" stays unverified until the lead checks it, and the built-in Explore can run on
Haiku. No new runtime dependencies (still only `zod`). The worker cap, model routing and sync
behaviour are unchanged. No new plugin options; the Explore override is a CLI command, off until you
run it.

This is still a **public preview**. Agent Teams are experimental in Claude Code and Mods (which carry
the cap and the team line) are early access, so it can break when Claude Code changes. Read "Known
limitations" before you rely on it.

## One goal at a time

`ctk_goal` is a new lead-only tool: `start`, `verify`, `review`, `close`, `abandon`, `status`.

- Teammates spawned and tasks created while a goal is active are recorded against it. Idle teammates
  from an earlier goal are not treated as free capacity.
- `close` is refused while a worker is busy, a task is open or not acknowledged, ownership is
  ambiguous, or the roster cannot be read. It returns the workers to shut down, and the goal is
  closed only once they have left the roster.
- `abandon` closes a goal whose worker never appeared in the roster, so the next goal can start.
- CTK still never sends a shutdown or kills a worker; you or the lead do that with Claude Code's own
  messaging. The ledger lives in memory and is lost on a plugin reload.

`ctk_team_status` also lists `cleanupCandidates` once every observed task is complete and the live
teammates are idle.

## "Done" means checked

A task a teammate completes stays **unverified** until the lead marks the same task completed with
`TaskUpdate` after checking it. In 0.1.8 any Bash call cleared the flag.

## Explore on Haiku (opt-in)

`ctk explore enable` writes an override for Claude Code's built-in Explore agent so it runs on Haiku
with read-only search tools; `ctk explore disable` removes it, `status` shows it, `--user` targets
your user config instead of the project. In a live run the overridden Explore used Haiku with
Grep and Glob only, while the stock one inherited Sonnet and used Bash. Whether answer quality holds
up, and how much it saves, was not measured. An override you edited by hand is reported as a
conflict and left alone.

## Also

- Workers shows each worker's cache writes beside its cache reads.
- `/ctk:team` asks whether the work suits a team before slicing, and suggests a single session or
  subagent for overlapping or tightly coupled work. It warns, never refuses.
- A goal task deleted with `TaskUpdate` no longer blocks verify, review and close.
- **Correction to 0.1.8:** the notes said the lead is no longer woken by shutdown approvals. On
  Claude Code 2.1.319 the hook CTK uses is not raised for shutdown messages, so they still reach the
  lead. The filter for a teammate's own `task_assignment` echo was seen working live.
- Stale facts in the docs (option, skill and agent counts, install paths) corrected.

## Not verified live

The goal ledger, the stricter verification rule and the post-shutdown roster check (#13, #14) are
covered by unit and plugin tests and CI, but have not been run in an interactive Agent Teams session.
CI pins Claude Code 2.1.322, because 2.1.323 fails `plugin validate --strict` on `.ts` imports in
hooks modules.

## Upgrade

`/plugin marketplace update ctk-kit`, then `/plugin update ctk@ctk-kit`. **An update only arrives
when the plugin `version` changes** (the manifest pins it), and it did — 0.1.8 to 0.1.9 — so a
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
tc3oliver/claude-team-kit#v0.1.8`) and install again with your options. Details:
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

This is the GitHub **prerelease** `v0.1.9` with the npm tarball attached. The earlier prereleases
`v0.1.8`, `v0.1.7`, `v0.1.6`, `v0.1.5`, `v0.1.4`, `v0.1.3`, `v0.1.2`, `v0.1.1` and `v0.1.0` are unchanged. Not published to npm and not in any official Claude
Code plugin directory. The repository works as a plugin marketplace as it is, and installing from the
tag is what `/plugin marketplace add tc3oliver/claude-team-kit#v0.1.9` does. `npm publish` stays a
manual step after review.
