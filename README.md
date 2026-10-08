# Claude Team Kit (CTK)

A lightweight, token-efficient, portable team companion for Claude Code.

CTK sits on top of Claude Code's native Agent Teams. It does not run its own orchestrator: it
adds a hard cap on live teammates, model routing by role, three short skills (`team`,
`review`, `debug`), four agent definitions, a one-line team status band, and a CLI that
installs all of it reversibly and syncs your settings between machines through a plain git
repository.

Status: version 0.1.0, pre-release. Read [Experimental or early-access
dependencies](#experimental-or-early-access-dependencies) and [Unsupported or unverified
environments](#unsupported-or-unverified-environments) before relying on it.

## Core values

1. **Lightweight.** No resident processes and no MCP server. The plugin's runtime part is one
   in-process Claude Code mod. The status line fallback runs a short-lived `node` and `git` per
   refresh. `claude plugin details ctk@ctk-kit` lists `Hooks (0)` and `MCP servers (0)`.
2. **Token-efficient.** The always-on context is about 187 tokens (measured, see
   [below](#differences-from-oh-my-claude-code)). Skill details are read only when needed, and
   workers get pointers (spec path, task id, file list, commit sha) instead of pasted text.
3. **Portable.** One profile (defaults, user layer, per-device overrides) follows you across
   machines via `ctk sync`. Every change CTK makes to `settings.json` is recorded, backed up,
   and undoable; it never replaces a setting you set yourself.

CTK reports only what it can measure. Claude Code does not expose per-worker cost, so CTK
shows none and does not estimate one.

## Quick start

Requirements: Node >= 20, Claude Code (>= 2.1.287 for the team cap and band), git (only for
`ctk sync`). Details and platform notes: [docs/INSTALLATION.md](docs/INSTALLATION.md).

From a checkout of this repository:

```bash
npm install
npm run build
node dist/src/cli/bin.js install --dry-run   # print the plan; CTK writes nothing (see note)
node dist/src/cli/bin.js install
node dist/src/cli/bin.js doctor
```

(`ctk` is the package's `bin` name; the examples below use it.)

Note on `--dry-run`: CTK writes nothing; Claude Code itself may still create `.claude.json` and `backups/` in the config directory or normalize `settings.json` (for example `"opus"` becoming `"opus[1m]"`) when CTK runs its `claude` commands. Then restart Claude Code or
run `/reload-plugins`. In a session:

```
/ctk:team add rate limiting to the API and cover it with tests
/ctk:review
/ctk:debug login fails after a token refresh
/ctk-stats
```

`ctk install` registers the marketplace `ctk-kit` from the package directory, installs
`ctk@ctk-kit` at user scope with the `claude plugin` CLI, copies a status line script, and
writes a small set of keys to `settings.json` (plugin options, the Agent Teams flag, and a
`statusLine` only if you have none). Run it with `--config-dir <dir>` to try it against a
scratch directory first. To undo: `ctk rollback` (latest change) or `ctk uninstall`; see
[docs/ROLLBACK.md](docs/ROLLBACK.md). Coming from Oh My Claude Code:
[docs/MIGRATION-FROM-OMC.md](docs/MIGRATION-FROM-OMC.md).

## Commands

CLI (`ctk <command>`). Global options: `--config-dir`, `--profile`, `--device`, `--dry-run`,
`--json`, `--yes`, `--help`, `--version`. Exit codes: `0` ok, `1` error, `2` needs attention.

| Command | What it does |
|---|---|
| `ctk install [--no-statusline] [--no-enable-teams]` | Install the plugin, status line script and settings keys. Idempotent. |
| `ctk doctor` | Check Node, Claude Code, mods support, plugin, settings, ledger and backups. Exit `0` ok, `2` warnings, `1` failures. |
| `ctk update` | Refresh the plugin, re-copy the status line script, re-apply the profile. |
| `ctk config list\|get\|set\|unset <path> [value] [--device-layer] [--no-apply]` | Edit the profile and apply it. |
| `ctk sync init --remote <url\|path> [--branch main]` | Connect a git profile repository. |
| `ctk sync [pull]`, `sync status`, `sync publish [-m msg]`, `sync resolve <pointer> ours\|theirs` | Pull (fast-forward only), inspect, publish (secret-scanned), settle conflicts. |
| `ctk stats` | Per-session and total team figures, labelled counted or measured. |
| `ctk rollback [--to <id>]` | Undo the latest transaction, or that one and every later one. |
| `ctk uninstall` | Remove what CTK added. Keeps backups, device overrides and the sync clone. |

Inside Claude Code:

| Command | What it does |
|---|---|
| `/ctk:team <goal>` | Lead a capped native team: default to one agent, split into independent slices only when worthwhile, confirm every spawn. |
| `/ctk:review [spec]` | Risk-based review: checklist (low), `ctk:reviewer` (medium), `ctk:high-risk-reviewer` (high). |
| `/ctk:debug <symptom>` | Reproduce, minimize, diagnose by hypothesis, fix, regression test; stop and ask after three refuted hypotheses. |
| `/ctk-stats` | This session's counted and measured figures. |

Agent types: `ctk:explorer` (haiku), `ctk:implementer` (sonnet), `ctk:reviewer` (sonnet),
`ctk:high-risk-reviewer` (opus). Models are configurable; see
[docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## What the team cap does

When a teammate spawn would exceed `maxWorkers` (default 3, maximum 12), the mod denies it with
`TEAM_CAPACITY_REACHED: live=N starting=M max=K ...`, and the `team` skill keeps that task
pending. If the cap cannot be checked, the spawn is denied (`TEAM_GUARD_FAILED`) rather than
allowed. A spawn counts as started only if Claude Code returns an agent id and a teammate id.
Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Without mods (older Claude Code) the cap
is not enforced; WSL is reported unsupported for mods and has not been tested.

Evidence: the cap was observed live on Claude Code 2.1.294 in the project's proof of concept
(6 concurrent teammate spawns: 3 started, 3 refused). In this repository it has been
re-verified only with simulated-host tests and mutation checks.

## Differences from Oh My Claude Code

CTK is not a drop-in replacement for Oh My Claude Code (OMC). It is a thin layer over native
Agent Teams. The statements about OMC in the table below are per the maintainers' analysis of
OMC 5.3.0 and have not been re-verified in this repository; the CTK column is checked against
this repository.

| | OMC | CTK |
|---|---|---|
| Orchestration | Phase-based workflow state machine | None: no phase state machine; Claude Code's Agent Teams do the work |
| Extra hooks and Node processes | Provides them | None: one in-process mod, `Hooks (0)`, `MCP servers (0)` |
| Codex / Gemini workers in tmux | Supported | Not provided |
| HUD data sources | Includes OAuth / Usage API access | None: the status line reads only the JSON Claude Code passes it; the mod uses the host's session API |
| Always-on plugin context | ~2,093 to ~3,174 tokens (OMC 5.3.0; two measurements, below) | ~187 tokens |

All figures come from the same command, `claude plugin details <plugin>`, which prints
"Projected token cost / Always-on". Treat them with care:

- The OMC figures are as measured by the maintainers on OMC 5.3.0 on two installs, and have not
  been independently reproduced: ~3,174 tokens on the maintainers' main install (an earlier
  proof of concept), and ~2,093 tokens in a fresh scratch config directory next to CTK. The
  cause of the gap was not determined. The CTK figure is verified with the same command
  (`claude plugin details`): ~187 tokens, the names and
  descriptions of its skills (`team` is `disable-model-invocation`, so it adds little) and
  four agents. That is a reduction of roughly 91% to 94% of fixed context (187 against
  2,093 to 3,174), not 99%. An earlier 26-token CTK figure came from a proof of concept with
  one skill and no agents; it does not describe this release.
- They compare **fixed context only**: what each plugin adds to every session before any work
  starts. They are not totals for a task. Total tokens depend on the work, the models and the
  team size, and CTK does not claim to lower them for a given task.
- The numbers are estimates reported by Claude Code and may differ from actual usage.
- Reproduce the CTK figure in a scratch config directory, in a throwaway shell (this does not touch `~/.claude`):

  ```bash
  export CLAUDE_CONFIG_DIR=$(mktemp -d)
  claude plugin marketplace add "$PWD"      # from the repository root
  claude plugin install ctk@ctk-kit
  claude plugin details ctk@ctk-kit         # Projected token cost / Always-on
  ```

  `node scripts/measure-context.mjs 500` checks CTK's always-on text against a 500-token
  budget.

## Experimental or early-access dependencies

CTK's central features rest on parts of Claude Code that can change.

| Dependency | State | What CTK needs it for | If it is missing |
|---|---|---|---|
| Agent Teams | Experimental; needs `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` | Teammates, task list, `SendMessage` | `ctk install` sets the flag in `settings.json` when it is absent (opt out: `--no-enable-teams`). Without it `/ctk:team` cannot spawn teammates. |
| Mods (plugin function hooks) | Early access; Claude Code >= 2.1.287 | Teammate cap, model routing, team band, stats | Skills, agents and the status line still install. The cap, routing, band and stats are inactive. `ctk doctor` warns. |
| `claude plugin` CLI (`marketplace add`, `install`, `uninstall`, `list --json`, ...) | Command surface set by Claude Code | Installing and removing the plugin | `ctk install` stops with Claude's own error; anything it had already added is in the ledger and can be rolled back. |
| Status line JSON on stdin | Format set by Claude Code | Fallback status line | Missing fields print `–`. |

## Unsupported or unverified environments

- **WSL.** Mods are reported unsupported in WSL; this has not been tested. If so, only the
  status line fallback would work there and the cap would not be enforced. `ctk doctor`
  reports when it is running under WSL.
- **Windows Terminal, VS Code and WSL end to end.** The UI behavior of the band and status
  line in these has **not** been verified.
- **Tested.** macOS with Claude Code 2.1.294 and Node 24.
- **Linux and Windows.** Covered by a CI configuration (`.github/workflows/ci.yml`: Ubuntu,
  macOS and Windows; Node 22 and 24) that has not been run.
- Not tested: Claude Code versions other than 2.1.294, Node 20 (declared in `engines`; not
  tested; tests pass on Node 22.19 and 24.21), any remote or shared home directory.

More in [docs/LIMITATIONS.md](docs/LIMITATIONS.md).

## Documentation

| | |
|---|---|
| [Installation](docs/INSTALLATION.md) | Requirements, install, verify, platform notes |
| [Migration from OMC](docs/MIGRATION-FROM-OMC.md) | Moving from Oh My Claude Code |
| [Configuration](docs/CONFIGURATION.md) | Profile schema, layers, every field and default, file locations |
| [Architecture](docs/ARCHITECTURE.md) | Components, ownership rules, sync, contributor notes |
| [Threat model](docs/THREAT-MODEL.md) | What CTK reads and writes, secrets handling, known limits |
| [Security policy](SECURITY.md) | Supported versions and how to report a vulnerability |
| [Rollback](docs/ROLLBACK.md) | Undoing changes |
| [Limitations](docs/LIMITATIONS.md) | Known gaps |
| [Release notes](RELEASE_NOTES.md), [Changelog](CHANGELOG.md), [Contributing](CONTRIBUTING.md), [Third-party notices](THIRD_PARTY_NOTICES.md) | |

## Development

```bash
npm run check   # typecheck, unit tests, `claude plugin test`, `claude plugin validate --strict`
```

The last two steps need the `claude` binary but no login.

## License

MIT. See [LICENSE](LICENSE).
