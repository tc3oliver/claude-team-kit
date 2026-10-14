# Claude Team Kit 0.1.6 (prerelease)

A fix and polish release for Mission Control, the band and the status line. No new runtime
dependencies (still only `zod`), and the worker cap, model routing and sync behaviour are unchanged.

This is still a **public preview**. Agent Teams are experimental in Claude Code and Mods (which carry
the cap and the team line) are early access, so it can break when Claude Code changes. Read "Known
limitations" before you rely on it.

## The band really is coloured now

0.1.5 said the band's `Ctx` turned yellow and red. It did not: the colour was computed but the band
was drawn as one dim text. The band is now drawn piece by piece, so a figure under pressure stands
out and the rest stays dim. Checked on the drawn band: `Ctx 42%` dim, `Ctx 85%` in the error colour.

## One rule for "getting full"

- Context, the 5h window and the weekly window are **quiet below 60%, yellow from 60%, red from
  80%**, in the band, the status line, Mission Control's header and its bars. The pane's bars used
  70/90 and drew a healthy bar green; they now follow the same rule. Task progress bars are unchanged.
- Every Mission Control page header shows a badge for a figure under pressure (`Ctx 82%`, `5h 61%`,
  `Wk 70%`). The header stays one line: `read-only`, then weekly and 5h, then the long title give way,
  context last.
- Usage lists `CTX` first.

## Overview, Workers, Doctor

- **Overview** lists the workers (up to four, each a button that opens its detail, then
  `+N · 2: Workers`) instead of two cards that repeated the same count. The context line stays
  visible down to 50 columns. The session line moved out; Usage has the tool calls.
- **Workers** shows how long an idle teammate has been idle (`idle 4m`, a dash when not observed).
- **Doctor** keeps to the page's row budget and ends with `+N more` when there are many fixes.

## Upgrade

`/plugin marketplace update ctk-kit`, then `/plugin update ctk@ctk-kit`. **An update only arrives
when the plugin `version` changes** (the manifest pins it), and it did — 0.1.5 to 0.1.6 — so a
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
tc3oliver/claude-team-kit#v0.1.5`) and install again with your options. Details:
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

This is the GitHub **prerelease** `v0.1.6` with the npm tarball attached. The earlier prereleases
`v0.1.5`, `v0.1.4`, `v0.1.3`, `v0.1.2`, `v0.1.1` and `v0.1.0` are unchanged. Not published to npm and not in any official Claude
Code plugin directory. The repository works as a plugin marketplace as it is, and installing from the
tag is what `/plugin marketplace add tc3oliver/claude-team-kit#v0.1.6` does. `npm publish` stays a
manual step after review.
