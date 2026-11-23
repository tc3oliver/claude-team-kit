# Claude Team Kit 0.1.10 (prerelease)

A security fix for the status line, per-teammate effort and context in Mission Control, and a
redacted bug report. No new runtime dependencies (still only `zod`) and no new plugin options. The
worker cap, model routing and sync behaviour are unchanged. **Update if you use the CTK status
line.**

This is still a **public preview**. Agent Teams are experimental in Claude Code and Mods (which carry
the cap and the team line) are early access, so it can break when Claude Code changes. Read "Known
limitations" before you rely on it.

## Security: the status line and partial clones

The status line runs `git status` for the dirty marker. In a partial clone, git may fetch a missing
blob during that call, and the fetch runs the remote's `uploadpack` command, which the repository's
own config can set. A repository handed to you with such a config could run a command each time the
status line refreshed. CTK already skipped repositories whose config sets fsmonitor, filters, hooks
and similar; it now also skips `uploadpack`, `promisor`, `partialclone` and `gitproxy`, and tells git
never to fetch lazily (`GIT_NO_LAZY_FETCH=1`). A test reproduces the fetch and fails without the fix.
Same class of problem as claude-hud's GHSA-f7gq-pcm8-rxr4.

## Effort and context per teammate

Mission Control's Workers page and `ctk_team_status` show each teammate's effort and how full its
context is, from what Claude Code's roster reports. Context turns yellow from 60% and red from 80%,
as elsewhere. On Claude Code 2.1.330 a `ctk:explorer` teammate reported effort `medium` (the value in
its agent file) and its context fill. Older builds that do not report them show a dash.

## A bug report you can paste

`ctk doctor --report` prints a Markdown block with the CTK, Node, OS and Claude Code versions, your
CTK options and the doctor checks. Secret-looking keys and values are replaced at any depth, and your
home directory becomes `~`. `--json` gives the same data. The issue template asks for it.

## Also

- The cap notice says how many spawns are still starting (`0 live, 5 starting, cap 5`).
- Checked live on 2.1.330: the cap also holds when a Code Mode script makes the `Agent` calls.
- **Removed:** the 0.1.8 filter meant to stop shutdown messages waking the lead. No mod hook sees
  those messages, so it never ran; the lead is still woken by them. The filter for a teammate's own
  `task_assignment` echo stays and works.
- `claude plugin validate --strict` passes on current Claude Code again; CI runs 2.1.330.
- anthropics/claude-code#92533 (Bash refused in worktree subagents) was fixed in 2.1.288; only the
  2.1.287 floor is affected.

## Upgrade

`/plugin marketplace update ctk-kit`, then `/plugin update ctk@ctk-kit`. **An update only arrives
when the plugin `version` changes** (the manifest pins it), and it did — 0.1.9 to 0.1.10 — so a
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
tc3oliver/claude-team-kit#v0.1.9`) and install again with your options. Details:
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

This is the GitHub **prerelease** `v0.1.10` with the npm tarball attached. The earlier prereleases
`v0.1.9`, `v0.1.8`, `v0.1.7`, `v0.1.6`, `v0.1.5`, `v0.1.4`, `v0.1.3`, `v0.1.2`, `v0.1.1` and `v0.1.0` are unchanged. Not published to npm and not in any official Claude
Code plugin directory. The repository works as a plugin marketplace as it is, and installing from the
tag is what `/plugin marketplace add tc3oliver/claude-team-kit#v0.1.10` does. `npm publish` stays a
manual step after review.
