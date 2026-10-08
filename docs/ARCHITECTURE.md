# Architecture

CTK is two things that share one repository: a Claude Code **plugin** that runs inside
Claude Code, and an optional Node **CLI** (`ctk`) that adds what a plugin cannot do (a status
line, a settings edit, profile sync, an undo ledger). The plugin is complete without the CLI.
Neither one orchestrates agents. Claude Code's
native Agent Teams do that; CTK adds a cap, model routing, three skills and a status
display on top.

Related documents: [CONFIGURATION](CONFIGURATION.md), [THREAT-MODEL](THREAT-MODEL.md),
[INSTALLATION](INSTALLATION.md), [MIGRATION-FROM-OMC](MIGRATION-FROM-OMC.md),
[ROLLBACK](ROLLBACK.md), [LIMITATIONS](LIMITATIONS.md).

## Two install paths

```
native:  /plugin marketplace add tc3oliver/claude-team-kit   ->  marketplace ctk-kit  (source: github)
         /plugin install ctk@ctk-kit                          ->  plugin from plugins/ctk, mod with default options
CLI:     ctk install  ->  claude plugin marketplace add <this directory>  (source: directory)
                          claude plugin install ctk@ctk-kit  +  status line, settings keys, ledger
```

The repository root is itself the marketplace (`.claude-plugin/marketplace.json`, one plugin,
`source: ./plugins/ctk`), so both paths install the same files. `ctk install` over a native
install **adopts** it: it sees a marketplace with a GitHub source, leaves it as it is, does not
reinstall the plugin, and writes only its own keys. `ctk update` then leaves the plugin to
`/plugin update`, and `ctk uninstall` removes only what the ledger says CTK installed or wrote.
The npm package and the marketplace checkout carry the same plugin files, except that the package
leaves out `plugins/ctk/tests/**`, `plugins/ctk/statusline/test/**` and `plugins/ctk/tsconfig.json`
(`test/packaging.test.ts` pins the list).

A plugin cannot set `statusLine` (it may ship only `agent` and `subagentStatusLine`
defaults), nor edit `settings.json`, so the status line and the Agent Teams flag are the two
things only the CLI, or you by hand, can provide.

## Components

```
                       ┌──────────────────────────────────────────────┐
  ctk (CLI, Node)      │  Claude Code                                 │
  ───────────────      │  ┌────────────────────────────────────────┐  │
  install / update     │  │ plugin ctk@ctk-kit                     │  │
  config / sync        │  │   skills   team  review  debug         │  │
  doctor / stats       │  │   agents   explorer implementer        │  │
  rollback / uninstall │  │            reviewer high-risk-reviewer │  │
        │              │  │   mod      hooks/register.tsx          │  │
        │ settings.json│  │            cap · routing · band · stats│  │
        ├─────────────▶│  └────────────────────────────────────────┘  │
        │ claude plugin│  status line  <config>/ctk/bin/ctk-statusline.mjs
        ├─────────────▶│  (fallback; one line from Claude Code's JSON) │
        │ <config>/ctk │                                              │
        └─────────────▶│  stats files  <config>/ctk/stats/*.json ◀──── written by the mod
                       └──────────────────────────────────────────────┘
```

| Part | Where | What it does |
|---|---|---|
| Plugin manifest | `plugins/ctk/.claude-plugin/plugin.json` | Name `ctk`, version, and `userConfig` for the seven options below. |
| Marketplace | `.claude-plugin/marketplace.json` | Marketplace `ctk-kit` with one plugin, `ctk`, sourced from `./plugins/ctk`. Plugin id: `ctk@ctk-kit`. |
| Skills | `plugins/ctk/skills/{team,review,debug}` | Short procedures (`SKILL.md`) with details in `references/*.md` that are read only on demand. `team` starts with a preflight (step 0) and creates the task list whenever `TaskCreate` exists. |
| Agents | `plugins/ctk/agents/*.md` | Four role definitions with a pinned `model` and `effort` in their frontmatter. |
| Mod | `plugins/ctk/hooks/{register.tsx,team.ts,band.ts,doctor.ts}` | Function hooks that Claude Code runs in-process (see below). |
| Shared types | `plugins/ctk/shared/{policy,stats}.ts` | Option defaults, role names and the stats record. Imported by both the mod and the CLI so defaults cannot drift. |
| Status line | `plugins/ctk/statusline/ctk-statusline.mjs` | Dependency-free fallback; copied to `<config>/ctk/bin/` by `ctk install`. |
| CLI | `src/cli`, `src/install`, `src/sync`, `src/core` | The `ctk` command. Only runtime dependency: `zod`. |

## The plugin

### Skills and agents (always-on cost)

Everything Claude Code loads into context every turn is the frontmatter `description` of the
skills that allow model invocation and of the four agents. `team` sets
`disable-model-invocation: true`, so it is only loaded when you invoke it. Skill bodies and
`references/*.md` are loaded on demand. `claude plugin details ctk@ctk-kit` reports
`~187 tok` always-on for this build (invoking `team` costs about 850 tokens, `review` 330, `debug` 280); `node scripts/measure-context.mjs 500` checks the same
text against a 500-token budget and runs in CI.

| Skill | Invocation | Purpose |
|---|---|---|
| `team` | `/ctk:team <goal>` | Decide whether a team is warranted; cut independent slices; create tasks; spawn at most `maxWorkers` teammates; confirm each spawn; integrate and shut workers down. |
| `review` | `/ctk:review [spec]` | Classify risk from the diff, then self-checklist (low), `ctk:reviewer` (medium) or `ctk:high-risk-reviewer` (high). |
| `debug` | `/ctk:debug <symptom>` | Reproduce, minimize, diagnose by hypothesis, fix, regression test; stop and ask after three refuted hypotheses. |

| Agent type | Default model | Default effort | Tools |
|---|---|---|---|
| `ctk:explorer` | `haiku` | `medium` | Read, Grep, Glob |
| `ctk:implementer` | `sonnet` | `medium` | inherited |
| `ctk:reviewer` | `sonnet` | `medium` | Read, Grep, Glob |
| `ctk:high-risk-reviewer` | `opus` | `high` | Read, Grep, Glob |

Skills hand workers *context pointers* (spec path, task id, file list, commit sha) rather than
pasted content, so a worker's context does not carry text the lead already holds.

### The mod

A mod is a plugin module of function hooks that Claude Code loads in-process (Claude Code
>= 2.1.287, early access). It is not a hook that spawns a process and not an MCP server:
`claude plugin details` lists `Hooks (0)` and `MCP servers (0)` for CTK. `hooks/hooks.json`
points at one module, `register.tsx`. `claude plugin validate plugins/ctk --strict` prints the
hooks it registers and the host calls it makes; for this build that is:

- Events: `agent.spawn`, `session.start`, `session.measure`, `turn.complete`, `session.end`,
  `classic.TaskCreated`, `classic.TaskCompleted`, `tool.call` (only `ctk_team_status`),
  `command.run` (only `ctk-stats` and `ctk-doctor`), `ui.render` (only `AbovePrompt`).
- Host calls: `agent.list`, `clock.now`, `command.register`, `env.get`, `fs.read`, `fs.write`,
  `session.id`, `session.usage`, `settings.read`, `tool.list`, `tool.register`, `ui.invalidate`,
  `ui.resolve`.
- Environment reads: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`, `CLAUDE_CONFIG_DIR`, `HOME`,
  `USERPROFILE`. Environment writes: none.

Only `fs.write` (stats file) mutates anything; `fs.read` reads that same stats file. There is no network call and no model call.

**Teammate cap.** On `agent.spawn`, a request with `isTeammate === true` is checked against
the number of live teammates plus spawns already in flight. Live means status `pending`,
`running`, `waiting` or `idle`; `completed`, `failed` and `killed` free the slot. A teammate
that Claude Code has accepted but the roster does not list yet stays counted until it appears
or 10 seconds pass, so a lagging roster cannot let a spawn past the cap. The
in-flight counter is incremented before the first `await`, so several spawns from one
assistant message see each other's reservations; the cap can over-count briefly and refuse
a spawn that would have fitted, but it does not admit more than the cap. If the cap is
reached the spawn is denied with

```
TEAM_CAPACITY_REACHED: live=N starting=M max=K. Do not treat this worker as started; ...
```

Evidence: the cap was observed live on Claude Code 2.1.294 in the project's proof of concept
(6 concurrent teammate spawns: 3 started, 3 refused). In this repository it has been
re-verified only with simulated-host tests and mutation checks.

If the cap cannot be checked (the roster call fails), the spawn is denied with
`TEAM_GUARD_FAILED` instead of being allowed (fail closed). Only teammate spawns are gated;
ordinary subagents are not counted.

**Spawn verification.** After Claude Code accepts a spawn, CTK counts it as started only if
the result carries both an agent id and a teammate id. A result without them is not counted.
The `team` skill applies the same rule on the lead's side: a spawn exists only if the `Agent`
result has a `teammate_id` and `ctk_team_status` (a tool the mod registers) lists the worker;
`TEAM_CAPACITY_REACHED`, `TEAM_GUARD_FAILED`, or a task row that only shows "Done" means the
worker did not start, so the task stays `pending`.

**Model routing.** If a spawn has no explicit `model` and its `subagentType` is one of the four
CTK agent types, CTK sets the model from the options (`explorerModel`, ...). An explicit
`model` is never overridden, and the value `inherit` leaves the spawn unchanged. Routing
applies to teammate and non-teammate spawns of CTK agents alike. Effort is **not** routed:
Claude Code's spawn hook can set a model but not an effort, so effort comes only from each
agent's `effort:` frontmatter and cannot be changed by a profile (see
[CONFIGURATION](CONFIGURATION.md#routing)).

**Counters and band.** `classic.TaskCreated` and `classic.TaskCompleted` only increment
counters and pass the event on; they never block a task. When `hudBand` is on, an
`AbovePrompt` line is drawn from the roster and session usage, for example:

```
team 1 busy · 2 idle · 1 done / cap 3 · tasks 2/5 · rejected 1 · models haiku×1 sonnet×2 · $0.42 · 12m
```

A figure Claude Code did not report is shown as `–`. The line is truncated with `…` to the
available columns and yields to Claude Code's survey prompt. `tasks a/b` is completed/created.

**Stats.** When `recordStats` is on, the mod writes one JSON file per session to
`<config>/ctk/stats/<sessionId>.json`, at most once every 2 seconds and once more at session
end. If `session.start` fires again in the same session (reload, respawn), the counters
continue from that session's file instead of resetting. Fields are in [THREAT-MODEL](THREAT-MODEL.md#what-the-stats-files-contain). `ctk stats` and
`/ctk-stats` read them; both label figures as **counted** (events CTK saw) or **measured**
(figures Claude Code reported). Claude Code exposes no per-worker cost, so none is shown or
estimated.

**Readiness (`/ctk-doctor`).** A read-only command (`plugins/ctk/hooks/doctor.ts`, pure logic;
the host reads are in `register.tsx`) that answers from three reads: the teams flag
(`env.get`, which also sees values from `settings.json` `env`), the settings object
(`settings.read`) and the tool list (`tool.list`). It reports: the mod is active (it answered),
the cap and whether a plugin option sets it, the teams flag (`ok`, `action` with the one exact
fix, or `unknown` when the read failed), task tools (`ok` only when `TaskCreate` is listed,
otherwise `unknown`, never `missing`: deferred tools are not listed, so absence proves nothing),
whether `statusLine` is configured, and the band and stats options. The status tool
`ctk_team_status` returns the same preflight facts (`cap`, `teamsEnabled`, `taskTools`), which
the `team` skill's step 0 reads: tool absent means the mod is inactive; `teamsEnabled` false
means spawn nothing and give the one-time setting.

Every host call in the mod is wrapped so that a failure degrades (no band, no stats) without
touching a spawn decision. The band, stats and counters can fail; the cap fails closed.

### The status line fallback

`ctk-statusline.mjs` is intended for builds without mods (older Claude Code; WSL is reported
unsupported for mods and has not been tested). Claude Code runs it as the `statusLine` command and passes a JSON document on stdin;
the script prints one line such as `Opus high · ctx 42% · 5h 24% · 7d 61% · $1.23 · 12m · main*`.
It reads only that JSON, `.git/HEAD` for the branch (and the repository's git config files),
and runs one `git status --porcelain -uno` (250 ms timeout) for the dirty marker. A repository's
own config can make git run commands (`core.fsmonitor`, filters, hooks, pagers, aliases,
credential helpers and similar); if the script sees any of those, it skips the dirty marker and
still shows the branch. The git call also runs with `core.fsmonitor=false`, no `hooksPath`, and
without the inherited `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` and `GIT_EXTERNAL_DIFF`
variables. System and global git config are honoured (Git for Windows ships `core.autocrlf=true`
in the system config); only repo-local config is distrusted. Control characters are stripped from
every string taken from the JSON. The script shows no worker data, makes no network call, and
prints a line even for empty or malformed input. `COLUMNS` is honoured; ANSI is off unless
`CTK_COLOR=1`. A `statusLine` you already have is never replaced, so with your own status
line the HUD is the mod band only.

## The CLI

```
src/cli/        bin.ts, index.ts (router, parseArgs), commands/{config,doctor,stats,sync}.ts
src/install/    install, update, marketplace, undo (rollback/uninstall), apply (settings), statusline, txn
src/sync/       engine (init/status/pull/publish/resolve), merge3, secrets, files, git
src/core/       paths, schema, profilestore, settings, ledger, fsx, jsonx, claude
```

Exit codes: `0` ok, `1` error, `2` needs attention (conflicts, warnings). With `--json` every
command prints one JSON document.

### Configuration layers

An effective profile is resolved as **CTK Defaults -> User Profile -> Device Overrides**:
objects merge key by key, arrays and scalars are replaced by the later layer. The result is
validated with a strict schema (unknown keys are rejected). Full field list:
[CONFIGURATION](CONFIGURATION.md).

```
effective profile ──profileToPluginOptions──▶ settings.json /pluginConfigs/ctk@ctk-kit/options/*
                                                         │
                                  Claude Code ◀──────────┘
                                       │ register(on, options)
                                       ▼
                                 readOptions(options)  (clamps and defaults every value)
```

`readOptions` re-validates whatever it receives, so a hand-edited `settings.json` cannot push
the mod outside its limits (for example, `maxWorkers` is clamped to 1-12).

### What `install` does

1. Reads `claude --version`. If it is older than 2.1.287, skills, agents and the status line
   still install and the mod stays inactive until Claude Code is upgraded.
2. Refuses to continue if `settings.json` exists but is not a JSON object.
3. Prints the plan; with `--dry-run` it stops there. CTK writes nothing; Claude Code itself may still create `.claude.json` and `backups/` in the config directory or normalize `settings.json` (for example `"opus"` becoming `"opus[1m]"`) when CTK runs its `claude` commands.
4. Backs up `settings.json`, Claude's plugin registry files and any status line script it will
   replace into `<config>/ctk/backups/<id>/`.
5. Registers the marketplace with `claude plugin marketplace add <package root>` and installs
   `ctk@ctk-kit` with `claude plugin install ctk@ctk-kit --scope user`, skipping what is
   already in place. Plugin enablement is always done through the `claude plugin` CLI, never
   by editing `enabledPlugins`. A plugin you have disabled stays disabled (with a note).
6. Copies the status line script to `<config>/ctk/bin/ctk-statusline.mjs`. If the script on
   disk is neither the packaged one nor what CTK last wrote, it is yours: it is left alone and
   reported as a conflict (exit `2`).
7. Writes the settings keys it owns (below) and records everything in the ledger.

A second run changes no file and creates no backup or transaction.

**Moving the checkout.** The marketplace is registered from the directory of the installed
package. After moving it, run `ctk install` (or `ctk update`) from the new location:

- If CTK registered the marketplace (the ledger says so) or the old directory no longer
  exists, CTK re-points it itself in one backed-up transaction: `claude plugin marketplace
  remove ctk-kit` (which also uninstalls the plugin and deletes its saved options),
  `marketplace add <new root>`, `plugin install ctk@ctk-kit --scope user`, then the options
  are written again from your profile. Side effect: a plugin you had disabled comes back
  enabled.
- If someone else registered `ctk-kit` and the old directory still exists, CTK stops with exit
  `2` and prints the manual route: `claude plugin marketplace remove ctk-kit`, then
  `ctk install` from the checkout you want to keep.

Until you do this, `ctk doctor` fails with Claude Code's own load error (for example
`Marketplace ctk-kit failed to load: cache-miss`) and a fix hint.

### Ownership, the ledger and transactions

`settings.json` is edited only by JSON pointer, preserving every other key, key order and
indentation. CTK owns exactly these pointers:

| Pointer | Written when |
|---|---|
| `/pluginConfigs/ctk@ctk-kit/options/<option>` (seven keys) | Always. |
| `/env/CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` = `"1"` | Key absent and `claude.enableAgentTeams` is true. |
| `/statusLine` | Key absent (or already CTK's command) and `hud.statusLine` is `auto`. The command is `'<node>' '<script>'` with each path single-quoted for POSIX shells; on Windows, double-quoted forward-slash paths, and paths containing `" $ ` %` are refused. |
| `/model`, `/effortLevel`, `/teammateMode`, `/outputStyle`, `/language` | Present in `portable.settings` of the effective profile. |

For each pointer the rules are:

| Current value | Action |
|---|---|
| Absent, never written by CTK | Write it; record the prior state as absent; CTK owns it. |
| Absent, but CTK had written it | You removed it: it stays removed, is recorded as yours, and a note is printed (exit `0`). The exception is the plugin options right after the plugin was reinstalled, which Claude Code deletes and CTK writes again. |
| Equal to the desired value | Record it as not owned; never removed by CTK. |
| Different, CTK never wrote it | Conflict: leave it, report it, exit `2`. (`statusLine` and the agent-teams flag are *soft*: kept silently with a note.) |
| CTK wrote it, user has since changed it | Treated as the user's from then on: left alone and reported. |

`<config>/ctk/ledger.json` (schema version 1) records every settings key (prior value, value
written, owned or not), every file CTK copied (with SHA-256) and whether CTK added the
marketplace and installed the plugin, plus a list of transactions. Each transaction records
the changes it made and the id of the backup taken before it. The ledger is written before
`settings.json` is modified, with each touched entry marked with the state `settings.json` is
still in. If the process dies in between, the next run finishes the write instead of mistaking
it for your edit, and CTK's keys are never orphaned. A ledger that does not validate is never
replaced silently.

`ctk rollback` undoes the latest transaction (`--to <id>` undoes that one and every later
one). `ctk uninstall` reverses every owned entry, newest first. Both check the live value
against what CTK wrote before changing it; a value that has changed is left in place and
reported. Backups are never deleted by CTK. See [ROLLBACK](ROLLBACK.md).

`ctk uninstall` removes everything under `<config>/ctk` except `backups/`, `devices/` and
`sync/` (your device overrides and the profile clone; it prints their paths). If anything
could not be reverted, it keeps `<config>/ctk`, the ledger included, and exits `2`, so running
it again can finish the job. Because `claude plugin uninstall` deletes the plugin's whole
saved-options entry, an option you edited cannot be left in place when CTK uninstalls the
plugin: it is reported as removed, with the backup that holds your value. After a rollback,
CTK notes any profile field that still sets a value it just reverted, since the next
`ctk update` or `ctk config` would apply it again.

### Skills synced from a profile repo

`ctk sync` can also install skills listed in the profile's `skills` array from the profile
repo into `<config>/skills/<name>/`, each marked with a `.ctk-managed` file. A destination
directory without that marker is never touched. `ctk doctor` compares the marked directories
with the profile's list.

### Sync

Sync is git only: no server, no account, no credentials handled by CTK (git's own helpers and
ssh agent apply). The local clone lives in `<config>/ctk/sync/repo`.

```
profile repo
  ctk-profile.json            { "schemaVersion": 1, "name": "..." }
  profiles/<name>.json        a profile layer (the User Profile)
  skills/<name>/**            skills listed in that profile's "skills"
```

- `sync init --remote <url|path> [--branch main]` clones, or initialises an empty repo.
- `sync pull` (also bare `sync`) fetches and fast-forwards only, then three-way merges the
  remote profile with the local user layer using the last synced snapshot
  (`<config>/ctk/sync/base.json`) as the common ancestor. Per key: equal on both sides ->
  keep; changed on one side only -> take that change; changed differently on both sides, or
  deleted on one and modified on the other -> **conflict**: the local value is kept, the
  conflict is written to `<config>/ctk/sync/conflicts.json`, and the command exits `2`.
  `sync resolve <pointer> ours|theirs` settles one conflict.
- `sync publish` pulls first, aborts on conflicts, scans everything it would commit for
  secrets, writes `profiles/<name>.json` from the user layer plus managed skills, commits
  only those paths and pushes. It never force-pushes. The device layer is never published.
  Before the push it re-checks every commit the remote does not have yet: only whitelisted
  paths, and no secret-like content in any version of a file. A failed publish restores the
  clone so the next pull can fast-forward, and says so if the restore itself failed.
- Skill files are text only (`.md .txt .json .yaml .yml .mjs .js .ts .sh`), at most 256 KiB
  each and 100 files per skill, no symlinks, no path traversal, no control characters or `:`
  in paths. If `ctk-profile.json`, `profiles/`, `skills/` or a skill directory in the clone is
  a symlink, pull and publish refuse (exit `1`). Anything else in the repo is ignored on pull
  and refused on publish.
- `sync init` rejects remote URLs that carry a password or token, and `git` runs with a
  scrubbed environment. Details: [THREAT-MODEL](THREAT-MODEL.md#secrets-handling).
- The `skills` list is one value in the profile, so two devices adding different skills
  produce a conflict (`sync resolve` takes one list).

Secret scanning is described in [THREAT-MODEL](THREAT-MODEL.md#secrets-handling).

## Design constraints

- **Thin layer over native Agent Teams.** No phase state machine, no scheduler, no resident
  processes. The only things CTK adds to a team are a cap, model routing by role, and
  visibility.
- **Fixed context stays small.** Descriptions are the always-on cost and are limited to 25
  words; skills use progressive disclosure; CI fails above 500 estimated tokens.
- **Measured, not invented.** Anything shown as a figure comes from Claude Code or from a
  counter CTK increments, and is labelled as such. Missing figures are dashes.
- **Reversible.** Every settings or file change is in the ledger and backed up. Nothing
  outside the ledger is removed.
- **One config root.** CTK writes under `<config>/ctk`, plus the settings keys above, managed
  skills and the files `claude plugin` writes. `<config>` is `--config-dir`, then
  `$CLAUDE_CONFIG_DIR`, then `~/.claude`.

## Contributor notes

- TypeScript with `erasableSyntaxOnly` (no enums, parameter properties or namespaces);
  relative imports use the `.ts` extension. Compiled output requires Node >= 22 (the `engines` field); tests run
  `.ts` files directly and need a Node that can strip types (CI uses 22 and 24; tests have been
  run on Node 22.19 and 24.21; Node 20 is not declared and not tested).
- Tests use `node:test` and `node:assert/strict` in `test/**/*.test.ts`, with a temporary
  config dir per test and no network. CLI tests drive a stub `claude` script; one test uses
  the real binary and skips when it is absent.
- Plugin rules enforced by `claude plugin validate`: one hook per event per module as written,
  function hooks receive `$` only in top-level functions of the same file, event names are
  string literals, and imports are relative inside the plugin plus `claude-code`. Types for
  `claude-code` are generated into `plugins/ctk/.claude-plugin/types/` (git-ignored).
- The root `npm run typecheck` does not cover `plugins/ctk/hooks` or the plugin tests. The gates
  for those are `claude plugin test plugins/ctk` and `claude plugin validate plugins/ctk --strict`.
  The types for `claude-code` are generated by running
  `claude --plugin-dir plugins/ctk -p "/ctk-stats"` with a scratch `CLAUDE_CONFIG_DIR`, after
  which `tsc -p plugins/ctk` can be run.
- Checks: `npm run check` runs the type check, unit tests, `claude plugin test plugins/ctk`
  and both `claude plugin validate` calls. The last two need the `claude` binary but no login.
- `npm pack` and `npm publish` run the build first through the `prepack` script, so the tarball
  always contains a fresh `dist/`.
- Paths use `path.join`; paths written into settings use forward slashes. `claude` is spawned
  with an argv array and `shell: false`, except for Windows `.cmd` shims, which are isolated
  in one helper (`src/core/claude.ts`).
- Keep the change small: no abstraction without a second caller. See
  [CONTRIBUTING](../CONTRIBUTING.md).
