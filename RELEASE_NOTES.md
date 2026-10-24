# Claude Team Kit 0.1.7 (prerelease)

Team runs cost fewer tokens and say more about themselves. No new runtime dependencies (still only
`zod`), and the worker cap, model routing and sync behaviour are unchanged.

This is still a **public preview**. Agent Teams are experimental in Claude Code and Mods (which carry
the cap and the team line) are early access, so it can break when Claude Code changes. Read "Known
limitations" before you rely on it.

## Fewer tokens in a team run

- Workers report **once**, within a word limit. A worker used to send its final reply, a
  `SendMessage` copy, and another report when a `task_assignment` echo woke it.
- The engine's "task tools haven't been used recently" reminder is dropped once tasks exist.
- **`output.bashFilter`** (off by default) shortens long test, build, lint and log output to its
  head, tail and failure lines. The full output is saved under `<config>/ctk/recall/<session>/` and
  the shortened result names the file. Turn it on in Mission Control's Config page or with
  `ctk config set output.bashFilter true`.
- A **`Cache`** cell in the band warns when the prompt cache is cold or mostly missed, which makes
  every following request pay for the whole prefix again.

## Knowing what the team did

- **Desktop notices** when every teammate has finished, when one fails, and when the cap refuses a
  spawn. They go through your Notification hooks like any other notice.
- **`/ctk-report`** lists the session's tasks, spawns, cost, models and changed files.
- Mission Control's worker detail page has an **Open transcript** button (Claude Code 2.1.300+).
- After the main session compacts, a short team summary is kept, so the lead still knows who is
  live and which tasks are open.

## Safer team flow

- A slice touching auth, money, migrations, data deletion or security waits for your approval
  before its worker starts; the other slices go ahead.
- Review findings go back to the teammate that wrote the slice, for one fix round and a re-review.

## Upgrade

`/plugin marketplace update ctk-kit`, then `/plugin update ctk@ctk-kit`. **An update only arrives
when the plugin `version` changes** (the manifest pins it), and it did — 0.1.6 to 0.1.7 — so a
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
tc3oliver/claude-team-kit#v0.1.6`) and install again with your options. Details:
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

This is the GitHub **prerelease** `v0.1.7` with the npm tarball attached. The earlier prereleases
`v0.1.6`, `v0.1.5`, `v0.1.4`, `v0.1.3`, `v0.1.2`, `v0.1.1` and `v0.1.0` are unchanged. Not published to npm and not in any official Claude
Code plugin directory. The repository works as a plugin marketplace as it is, and installing from the
tag is what `/plugin marketplace add tc3oliver/claude-team-kit#v0.1.7` does. `npm publish` stays a
manual step after review.
