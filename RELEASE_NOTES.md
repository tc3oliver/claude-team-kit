# Claude Team Kit 0.1.3 (prerelease)

A follow-up hardening release: five problems found after `v0.1.2` shipped are fixed, each verified by
a test that fails without the fix, and green across the whole CI matrix. No features, no new runtime
dependencies (still only `zod`), and the worker cap, model routing and Mission Control behaviour are
unchanged.

This is still a **public preview**. Agent Teams are experimental in Claude Code and Mods (which carry
the cap and the team line) are early access, so it can break when Claude Code changes. Read "Known
limitations" before you rely on it.

## The v0.1.2 sync upgrade dead end is closed

`v0.1.2` started refusing **any** userinfo in an `http(s)` remote URL. That left a user who had
stored one (`https://abc123@host/…`, accepted by `v0.1.1`) with no way out: every sync command
failed closed, and `ctk sync init` refused to switch an already-initialized remote — so the `v0.1.2`
release notes' instruction to "re-run `ctk sync init` with a clean URL" did not work. The published
`v0.1.2` release body carries a correction notice pointing here; the manual recovery it documents was
verified against the real `v0.1.2` build.

In **this** release, `ctk sync init --remote <the same URL without the userinfo>` migrates the
existing clone in place:

- the profile, the clone, its git history and any unpushed commits are kept — nothing is re-cloned
  or deleted;
- reachability is verified against the clean URL as a direct argument, so the stored credential
  never reaches `git` and is never printed;
- only that exact URL (and branch) is accepted, so sync can never be silently repointed at another
  repo — a different host, path or branch is still refused, with the stored credential redacted.

Every other sync command keeps failing closed and now names the migration command. `ctk sync status`
stays usable and prints the remote redacted. **Compatibility:** this migration is new in `0.1.3`.
On `v0.1.2` there is no CLI migration; the corrected `v0.1.2` release body documents the verified
manual equivalent (edit `<config>/ctk/sync/config.json` to the clean URL and `git remote set-url
origin <clean-url>` inside `<config>/ctk/sync/repo`). Updating to `0.1.3` and running the one
`sync init` command replaces both steps.

## Data integrity

- **A backup copy is verified before it is restored.** Rollback and uninstall found their backup copy
  by the manifest SHA and checked only that the file existed, then wrote whatever they read — a
  tampered, truncated or corrupted copy was restored over a live user file and the transaction
  reported success. The bytes are hashed before the write now; on a mismatch nothing is written, the
  file stays byte-identical, a conflict names it and the exit code is 2.
- **An unreadable skill root is no longer published as an empty skill.** `collectSkill` treated every
  failure to stat a skill root as "the directory is not there", so one hidden behind an unreadable
  parent (EACCES), a path through a file (ENOTDIR) or a symlink loop (ELOOP) published and applied
  as an empty skill, silently emptying it on every other machine. Only ENOENT keeps the
  "not there" behaviour; anything else is a problem that makes the skill unusable for publish and
  pull.

## CLI

- **`--json` is honoured when there is no command to run.** `ctk --json --profile` printed the text
  help and an unknown command printed text on stderr, so a machine consumer got no JSON exactly when
  something went wrong. Both paths now emit the same JSON failure shape as the rest of the CLI. The
  `v0.1.2` fix stays: a flag-shaped value still cannot hijack the command — the raw scan only chooses
  the error format.

## Tests

- **The demo recorder test waits for an event, not a wall clock.** It used to give the shell a fixed
  300 ms warm-up before typing; on a loaded CI runner that raced the shell starting. It now waits
  for the shell prompt to appear and hold, so a slow runner waits instead of failing. The behaviour
  under test (a real tmux session, scripted keys, stop-on-match) is unchanged.

## Upgrade

`/plugin marketplace update ctk-kit`, then `/plugin update ctk@ctk-kit`. **An update only arrives
when the plugin `version` changes** (the manifest pins it), and it did — 0.1.2 to 0.1.3 — so a
normal update reaches you and keeps your options, the worker cap and model routing.

If you stored an `http(s)` remote with userinfo before `v0.1.2`, after updating run
`ctk sync init --remote <the same URL without the userinfo>` once; see above.

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
tc3oliver/claude-team-kit#v0.1.2`) and install again with your options. Details:
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

This is the GitHub **prerelease** `v0.1.3` with the npm tarball attached. The earlier prereleases
`v0.1.2`, `v0.1.1` and `v0.1.0` are unchanged. Not published to npm and not in any official Claude
Code plugin directory. The repository works as a plugin marketplace as it is, and installing from the
tag is what `/plugin marketplace add tc3oliver/claude-team-kit#v0.1.3` does. `npm publish` stays a
manual step after review.
