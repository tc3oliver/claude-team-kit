# Installation

CTK is two things that install together: a Claude Code **plugin** (skills, agents, and a
"mod" that enforces the team cap and draws the team band) and the **`ctk` command line tool**
that installs, checks, updates and removes it. This page covers installing from a checkout or
from an npm tarball. Nothing here needs a published package.

## Prerequisites

| Need | Version | Check |
|---|---|---|
| Node.js | 22 or newer (CI tests 22 and 24) | `node --version` |
| Claude Code | 2.1.287 or newer for the mod (the cap and the band). Older builds still get the skills, agents and status line. | `claude --version` |
| `claude` on `PATH` | | `ctk` runs `claude plugin ...` for you |
| git | only for `ctk sync` | |

`ctk` needs no login and no network to install: every command in this page was run against
a logged-out Claude Code in a scratch config directory. You do need to log in to Claude Code
to actually use a team.

## Option A: from a checkout

```sh
cd claude-team-kit          # your checkout of this repository
npm ci
npm run build               # writes dist/, which is not committed
node dist/src/cli/bin.js --version
```

```
0.1.0
```

From the checkout, `npm run ctk -- <args>` runs the built CLI (`npm run ctk -- doctor`,
`npm run ctk -- install --dry-run`). Everywhere else, use
`node /path/to/claude-team-kit/dist/src/cli/bin.js` wherever this page says `ctk`, or make
yourself an alias or a wrapper script. (`npm link` should also expose `ctk`; it was not tested.)

**Keep the checkout where it is.** `ctk install` registers the checkout directory with
Claude Code as a plugin marketplace named `ctk-kit`. If you move or delete it, the plugin
stops loading. See [Moving or deleting the install directory](#moving-or-deleting-the-install-directory).

## Option B: from an npm tarball

Build once, pack, then install the tarball anywhere:

```sh
npm ci
npm run build               # optional here: a prepack script runs it during npm pack anyway
npm pack                    # writes claude-team-kit-0.1.0.tgz (about 112 kB, 74 files)
npm install -g ./claude-team-kit-0.1.0.tgz
ctk --version
```

The same tarball was also installed with a local prefix instead of `-g`:
`npm install --prefix <dir> ./claude-team-kit-0.1.0.tgz`, then `<dir>/node_modules/.bin/ctk`.
That `ctk install` registered `<dir>/node_modules/claude-team-kit` as the marketplace and the
plugin loaded from it. The same directory-must-stay-put rule applies, so install into a
location you will keep.

Once the package is published to npm, `npm install -g claude-team-kit` replaces the tarball
step. It is not published yet, which is why CTK's own hints say to clone the repository and
build it.

## Install

Always look first:

```sh
ctk install --dry-run
```

```
plan: darwin, Claude Code 2.1.294, config /Users/you/.claude
  marketplace ctk-kit: add /path/to/claude-team-kit
  plugin ctk@ctk-kit: install
  status line script: copy
  settings.json: 9 key(s): /pluginConfigs/ctk@ctk-kit/options/maxWorkers, /pluginConfigs/ctk@ctk-kit/options/explorerModel, ... /env/CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, /statusLine
```

(Paths shortened and the key list abbreviated here; the real output lists all nine.)
`--dry-run` makes CTK write nothing. One side effect is not CTK's: on a config directory
Claude Code has never touched, the `claude plugin list` that CTK runs to build the plan makes
Claude Code create `<config>/.claude.json` and `<config>/backups/` itself.

Then install:

```sh
ctk install
```

```
install: darwin, Claude Code 2.1.294, config /Users/you/.claude
  marketplace ctk-kit: add /path/to/claude-team-kit
  plugin ctk@ctk-kit: install
  status line script: copy
  settings.json: 9 key(s): ...
installed.
Restart Claude Code (or run /reload-plugins).
Try: /ctk:team <goal>   (status: /ctk-stats)
Undo any time: ctk uninstall
```

The last three lines are the next steps; they are also in the `nextSteps` field of `--json`
output. Running it again changes nothing:

```
  marketplace ctk-kit: already registered
  plugin ctk@ctk-kit: already installed
  status line script: up to date
  settings.json: no key changes
already installed; nothing to change.
```

### Help

```sh
ctk --help               # all commands and the global options
ctk install --help       # one command
ctk help install         # same thing
ctk sync --help          # sync prints its own usage
```

Each command's help states what it changes and its options.

### If install cannot start

These are the messages for the failures a first run can hit. Each one stops before CTK
changes anything (exit `1`):

| Situation | Message |
|---|---|
| `claude` not on `PATH` | `error: Claude Code was not found. Install it from https://code.claude.com/docs/en/quickstart, then run ctk install again.` |
| Config directory not writable | `error: the Claude config dir <dir> is not writable (EACCES); fix its permissions or pick another with --config-dir.` |
| `settings.json` is not valid JSON | `error: <config>/settings.json is not valid JSON (...); refusing to modify it` then a second line saying that CTK will not modify `<config>/settings.json` and to fix it by hand (or move it aside) and run the command again |
| The CTK package is incomplete (for example `dist/` copied without `plugin/`) | `error: the ctk package at <dir> is incomplete (missing .claude-plugin/marketplace.json, plugins/ctk/.claude-plugin/plugin.json); get a complete copy (clone the repository, then run "npm ci && npm run build") and run ctk from there.` |

A failing `claude plugin ...` step prints Claude's own message and then says that nothing
else was changed and that whatever CTK had added is in its ledger, so running the command
again is safe.

Options:

| Option | Effect |
|---|---|
| `--no-statusline` | Do not install or set the status line script. Stored in this machine's device layer, so later `ctk update` and `ctk sync` keep honouring it. |
| `--no-enable-teams` | Do not set the Agent Teams environment flag (see below). Stored the same way. |
| `--config-dir <dir>` | Install into that Claude config directory instead of `$CLAUDE_CONFIG_DIR` or `~/.claude`. |
| `--json` | One JSON document instead of text. |

To undo `--no-statusline` later: `ctk config set hud.statusLine auto --device-layer`, then
`ctk update`. For teams: `ctk config set claude.enableAgentTeams true --device-layer`.

Exit codes: `0` done, `1` error, `2` finished but something needs your attention (a conflict
or a registered-elsewhere marketplace). Details are in the output.

## Multiple config directories

Claude Code reads `CLAUDE_CONFIG_DIR`. CTK follows the same rule (`--config-dir`, then
`$CLAUDE_CONFIG_DIR`, then `~/.claude`) and passes the directory to every `claude` command it
runs. Each directory is a separate installation with its own plugin registry, settings,
ledger, backups and profile:

```sh
CLAUDE_CONFIG_DIR=~/.claude-work ctk install
CLAUDE_CONFIG_DIR=~/.claude-work ctk doctor
ctk doctor --config-dir ~/.claude-personal
```

Install once per directory. One checkout can serve many directories. The marketplace name
`ctk-kit` is registered per directory, but within one directory it can point at only one
checkout (next section).

## First launch and approval prompts

A config directory Claude Code has never run in starts with its onboarding. In a fresh
directory (`claude` 2.1.294) the interactive session showed a text-style (theme) choice, then the
login method screen. The check went no further, because that needs a login.

Not tested: whether the interactive session asks you to approve or trust the
plugin or its mod the first time it loads. In non-interactive mode
(`claude -p "/ctk-stats"`) no prompt appeared and the mod loaded. If you are asked, approve
the `ctk` plugin; then confirm the mod is live as described under [Verify](#verify).

`ctk doctor` has an "onboarding" check, but it only tests that `.claude.json` exists. On a
directory Claude Code has never touched, `doctor` looks before it runs any `claude` command and
warns (`Claude Code not started yet (no .claude.json)`). But every `claude plugin` command,
including the ones `ctk install` and `ctk update` run, creates that file, so after `ctk install`
the check passes even if you have never launched `claude`. Launch `claude` yourself and log in;
do not rely on that line.

## Enabling agent teams

Claude Code's Agent Teams are experimental and are switched on by an environment variable.
`ctk install` sets it for you in `settings.json`:

```json
"env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }
```

Only if the key is absent. A value you already set is never replaced. Skip it with
`ctk install --no-enable-teams`, or set the flag yourself. `ctk doctor` reports it
("agent teams flag set" counts either `settings.json` or your shell environment).

## Verify

```sh
ctk doctor
```

```
[ok  ] node: Node 24.21.0
[ok  ] claude: Claude Code 2.1.294
[ok  ] mods: mods supported (>= 2.1.287)
[ok  ] wsl: platform darwin
[ok  ] settings: settings.json parses
[ok  ] plugin: ctk@ctk-kit 0.1.0 installed and enabled
[ok  ] marketplace: marketplace ctk-kit registered
[ok  ] profile: profile layers valid
[ok  ] agent-teams: agent teams flag set
[ok  ] statusline: CTK status line active
[ok  ] onboarding: Claude Code has been started once
[ok  ] ledger: ledger matches settings.json (11 entries, 1 transactions)
[ok  ] skills: no synced skills
[ok  ] backups: 1 backup(s) restorable
all checks passed
```

Exit `0` all passed, `2` warnings, `1` failures. A warning or failure prints a `fix:` line
under it. `doctor` fails when `claude plugin list --json` reports load errors for the plugin
(after the install directory was moved: `plugin: ctk@ctk-kit failed to load: Marketplace
ctk-kit failed to load: cache-miss` and `marketplace: ... registered at <path>, which does not
exist`), and warns when the plugin is installed but disabled.

What `doctor` still does **not** prove: "mods supported" is a version comparison, not a check
that the mod loaded. So also run the real check, the mod's own command, in a project
directory:

```sh
claude -p "/ctk-stats"
```

```
ctk: CTK session 23ad5256-00a1-41ca-9e43-12bcdb2a6897
counted by CTK:
  teammate spawns: 0 accepted, 0 refused at capacity, 0 failed closed
  peak live teammates: 0 (cap 3); now 0
  worker models: –
  tasks created/completed: – (no task event seen)
measured (reported by Claude Code):
  cost: $0.00  context: –  5h limit: –  7d limit: –
  elapsed: 0s
  per-worker cost: not available from Claude Code
```

If `/ctk-stats` is not recognised, the mod is not loaded and **the team cap is not enforced**.
(In interactive Claude Code the same command is `/ctk-stats`.) `ctk stats` prints the saved
per-session files from outside Claude Code.

Plugin footprint, as Claude Code itself estimates it:

```sh
claude plugin details ctk@ctk-kit
```

```
  Skills (3)  debug, review, team
  Agents (4)  reviewer, explorer, high-risk-reviewer, implementer
  Always-on:   ~187 tok   added to every session
```

The skills are invoked as `/ctk:team`, `/ctk:review` and `/ctk:debug`.

## What install changes

Everything `ctk install` does is recorded in `<config>/ctk/ledger.json` so it can be undone
([ROLLBACK](ROLLBACK.md)). Before the first write it copies the files it is about to change
into `<config>/ctk/backups/<timestamp>-install/`.

**Claude Code's own registry** (written by `claude plugin ...`, which CTK runs, not by CTK):

- marketplace `ctk-kit` pointing at the CTK directory, plugin `ctk@ctk-kit` installed at user
  scope;
- as a result Claude Code adds `extraKnownMarketplaces.ctk-kit` and
  `enabledPlugins["ctk@ctk-kit"]` to `settings.json`, and writes `<config>/plugins/*`.

**`settings.json` keys CTK writes** (by JSON pointer, other keys and their order untouched):

| Key | Written when |
|---|---|
| `pluginConfigs["ctk@ctk-kit"].options.{maxWorkers, explorerModel, implementerModel, reviewerModel, highRiskModel, hudBand, recordStats}` | each one absent. Defaults are in [CONFIGURATION](CONFIGURATION.md). |
| `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` = `"1"` | absent, and `claude.enableAgentTeams` is true |
| `statusLine` = `'<node>' '<config>/ctk/bin/ctk-statusline.mjs'` on macOS and Linux (each path single-quoted) | absent, and `hud.statusLine` is `auto` |

**Files under `<config>/ctk/`**: `ledger.json`, `bin/ctk-statusline.mjs`, `backups/`; later
`profile.json`, `devices/<device>.json`, `stats/<session>.json` (written by the mod) and
`sync/` (only if you use `ctk sync`). On macOS and Linux the backups and ledger are mode 0600.

If a key already holds a different value that CTK did not write, CTK leaves it and reports a
`conflict:` line (exit `2`). The same goes for `<config>/ctk/bin/ctk-statusline.mjs` if you
edited it: `install` and `update` report `edited since CTK wrote it; not overwritten`
(exit `2`); restore or delete the file and run `ctk install` again. A key CTK wrote and you
then **deleted** stays deleted: you get a note (`removed by you since CTK wrote it; not
re-added`, exit `0`) until you `ctk uninstall` and `ctk install` again. A plugin you disabled
with `claude plugin disable` stays disabled through `install`, `update` and a marketplace
re-point (note: `installed but disabled, left disabled`), and `ctk doctor` warns. A `statusLine` of your own is kept without a conflict. Example
from a settings file that already had `pluginConfigs["ctk@ctk-kit"].options.maxWorkers = 5`
and an OMC-style `statusLine`:

```
  note: statusLine: your own status line is kept; the HUD runs via the mod band only
  conflict: /pluginConfigs/ctk@ctk-kit/options/maxWorkers: a different value is set that CTK did not write; left unchanged
conflicting keys were left untouched; make them match your profile (see "ctk config list") or remove them, then re-run "ctk install".
```

The status line command contains the absolute path of the `node` that ran `ctk install`
(for example a version-manager path). After you change or remove that Node, run `ctk update`,
which re-points the command at the Node running `ctk`.

## What install never touches

- Any `settings.json` key not listed above, including `permissions`, `hooks`, `model`, and the
  rest of `env`.
- `enabledPlugins` by hand (always through `claude plugin`), and any other plugin.
- Credentials. `~/.claude.json` is checked for existence and never read. CTK code makes no
  network calls; `ctk sync` runs your `git` and nothing else.
- `CLAUDE.md` or any memory or instruction file.
- OMC or any other plugin's files or settings. See [MIGRATION-FROM-OMC](MIGRATION-FROM-OMC.md).
- A `settings.json` that is not a valid JSON object. CTK refuses to continue and exits `1`.

Claude Code itself rewrites `settings.json` when you run any `claude` command, which can
reorder keys. In one fresh config directory it also changed `"model": "opus"` to
`"opus[1m]"` on the first `claude plugin list`, with no CTK involved. Expect a diff you did
not make.

## Updating

```sh
ctk update --dry-run
ctk update
```

`ctk update` refreshes the marketplace and plugin when the packaged plugin version differs,
re-copies the status line script if it changed, and re-applies your profile. A plugin you
disabled stays disabled. It never changes the `ctk` package itself. Its closing hint, because
the package is not published to npm yet, is `To upgrade ctk itself, pull the latest checkout and
rebuild (git pull && npm ci && npm run build), then run "ctk update" again.` Only the no-change path was exercised (the package and
the installed plugin were both 0.1.0); a real version bump was not.

## Moving or deleting the install directory

Claude Code copies the plugin into its cache at install time, but the marketplace it keeps
refers to the original directory. After that directory was moved, Claude Code reported:

```
  ctk@ctk-kit
    Version: 0.1.0
    Scope: user
    Status: ✘ failed to load
    Error: Marketplace ctk-kit failed to load: cache-miss
```

and `/ctk-stats` was no longer a command, so the cap was not enforced. `ctk doctor` fails
with `fix: run "ctk install" from the checkout you want to keep`. Do exactly that, from the new
location:

```
$ ctk install
  marketplace ctk-kit: re-point from <old>/claude-team-kit to <new>/claude-team-kit (Claude removes the plugin with the marketplace, so it is reinstalled)
  plugin ctk@ctk-kit: reinstall
  status line script: up to date
  settings.json: no key changes
installed.
Restart Claude Code (or run /reload-plugins).
...
```

`ctk update` does the same (`plugin ctk@ctk-kit: reinstall`). After it, `doctor` passed and
`claude -p "/ctk-stats"` worked. Claude Code removes a marketplace together with its plugin
and the plugin's options, so CTK removes and re-adds both in one transaction and writes the
options again. A plugin you had disabled is disabled again afterwards:
`plugin ctk@ctk-kit: reinstall, then disable it again (it was disabled)`.

If `ctk-kit` was registered by something other than CTK and the old directory still exists,
CTK will not move it. It exits `2` and prints the manual command
(`claude plugin marketplace remove ctk-kit`, which also uninstalls `ctk@ctk-kit`, then
`ctk install` from the checkout you want to keep).

## Windows and WSL

What the code does for Windows, and what has and has not been tested:

- `claude` is looked up as `claude.exe`, then as `claude.cmd`. `.cmd` shims have to run
  through a shell, so CTK quotes each argument and refuses an argument containing a double
  quote.
- On Windows the status line command is written with forward slashes and both paths in double
  quotes, because Claude Code runs it through Git Bash, which eats backslashes. A path containing
  `"`, `$`, a backtick or `%` is refused. This is from the code and its comments; it was not run
  on Windows.
- CTK's tests and the plugin validation and plugin test jobs ran on `windows-latest` in GitHub
  Actions and passed ([CI run](https://github.com/tc3oliver/claude-team-kit/actions/runs/37816500991), 2026-10-09). That is automated coverage only.
- **Not verified interactively:** a real `ctk install`, the mod, or `/ctk:team` on native Windows,
  Windows Terminal, VS Code's terminal, or WSL.
- WSL: install CTK and Claude Code inside the Linux distribution and keep
  `CLAUDE_CONFIG_DIR` on the Linux filesystem. `ctk doctor` warns when it is under `/mnt/`.
  Mods are reported unsupported in WSL sessions, so there the cap and band would not be
  active and the status line script would be the HUD; WSL was not tested.
  `ctk install` does not detect this: it checks only the Claude Code version and still
  reports "mods supported" in WSL.

## Uninstall

`ctk uninstall` and `ctk rollback` remove only what CTK caused. `settings.json` returns to its
original content, and a fresh config directory returns to `{}`: the `enabledPlugins` and
`extraKnownMarketplaces` objects that `claude plugin` creates are removed again when they did not
exist before and are empty. Claude Code may reorder keys when it rewrites the file. Details and
the real output are in [ROLLBACK](ROLLBACK.md).
