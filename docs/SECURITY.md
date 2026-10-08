# Security

This document says what CTK touches, what it deliberately does not, where it can still hurt
you, and how to report a vulnerability. It describes version 0.1.0 and is based on the source
code and on running the CLI against a scratch config directory; it is not an audit.

## Reporting a vulnerability

Open a **private security advisory** on the repository. Do not file a public issue for a
vulnerability. Please include the CTK version (`ctk --version`), your OS, the Claude Code
version (`claude --version`), and steps to reproduce. Do not paste real credentials, tokens or
the contents of your `settings.json`; redact them first.

## Threat model

**What CTK protects**

- Your Claude Code credentials and account state.
- Your existing `settings.json`, and anything else in the config directory that CTK did not
  create.
- Secrets in your settings or skills, against being published to a sync remote by accident.
- Your team's cap on concurrent teammates, against a runaway spawn loop.

**Actors considered**

| Actor | What CTK does about it |
|---|---|
| You, making a mistake (publishing a token, overwriting a setting) | Secret scan before publish, whitelist of syncable settings, ledger with per-key ownership, backups, rollback. |
| A second tool editing `settings.json` | CTK only writes keys it owns and re-checks the live value before undoing anything. A key someone else changed is left alone and reported. |
| A model that spawns too many teammates | The `agent.spawn` hook denies spawns above the cap and fails closed if it cannot count. |
| A profile repo containing unexpected content | Whitelist, secret scan, symlink refusal and path checks on pull and publish (see the limits below). |

**Out of scope**

- A compromised local account or another process running as you. Anything that can write
  your config directory can already do what CTK does.
- Compromise of Claude Code itself, of git, of Node, or of the npm registry.
- A malicious sync remote you chose to trust (see [A pulled profile is trusted
  input](#a-pulled-profile-is-trusted-input)).
- Anything in the Mac mini / WSL / Windows host environment beyond the config directory.

## What CTK reads

| Reads | Why |
|---|---|
| `<config>/settings.json` | Parse it, compare keys it owns, write changes by key. Invalid JSON stops CTK before it writes anything. |
| `<config>/plugins/*.json` (indirectly) | Only through `claude plugin list --json` and `claude plugin marketplace list --json`. |
| `claude --version`, `claude plugin ...` | Version gate and plugin management. CTK runs `claude` with `CLAUDE_CONFIG_DIR` set to the config dir it was given. |
| `<config>/ctk/**` | Its own ledger, profile layers, stats, sync state and backups. |
| Existence of `.claude.json` | Only `doctor`, only whether the file exists, to report whether Claude Code has been started once. The content is never opened. |
| `/proc/version` (Linux) | To detect WSL. |
| The profile repo clone | `ctk sync` reads `ctk-profile.json`, `profiles/<name>.json` and listed `skills/<name>/**` files. |
| The packaged plugin directory | To copy the status line script and compare versions. |
| Claude Code's status line JSON on stdin | The status line script only: model, effort, context %, rate-limit %, cost, duration, directory. |
| `.git/HEAD` and the git config files of your working directory's repository, and one `git status --porcelain -uno` | The status line script only, for the branch and a dirty marker (250 ms timeout; any failure shows nothing). The config files are read to decide whether it is safe to run `git status` at all (see Process execution). |
| The mod's host API | Roster (`agent.list`), session id and usage, clock, its own stats file (`fs.read`, to continue counters), and the env vars `CLAUDE_CONFIG_DIR`, `HOME`, `USERPROFILE`. `claude plugin validate` reports the exact list. |

## What CTK writes

| Writes | When |
|---|---|
| `<config>/settings.json`: only the keys in [CONFIGURATION](CONFIGURATION.md#settingsjson-keys-ctk-may-write) | `install`, `update`, `config`, `sync pull/resolve`. Other keys, key order and indentation are preserved. |
| `<config>/ctk/**` | Ledger, profile layers, status line script, stats, sync state, backups. |
| `<config>/skills/<name>/` | Only skills listed in your profile, only as directories CTK created (marked `.ctk-managed`). |
| Claude Code's plugin registry | By `claude plugin ...`, not by CTK directly. CTK backs the registry files up first. |
| The profile repo clone and its remote | `ctk sync publish`: the paths listed by `--dry-run`, a commit, a normal (never forced) push. |

`settings.json`, the ledger, profile layers and sync state are written atomically (temporary
file, then rename). Nothing is deleted except entries
CTK created and that still match what CTK wrote; `backups/` is never deleted.

## What CTK never touches

- Credentials. CTK does not read, print, log, copy or sync API keys, OAuth tokens, the
  keychain, `.credentials.json`, or the content of `~/.claude.json`. It makes no OAuth or
  usage API calls; usage figures come from fields Claude Code itself passes to the status line
  and the mod.
- Conversation transcripts, history, prompts, file contents or paths from your sessions.
- Other plugins, their settings, hooks, permissions or MCP servers. CTK does not edit `hooks`,
  `permissions` or `mcpServers`, and it does not set `ANTHROPIC_*` variables.
- Any setting outside the whitelist above, including `env` entries other than
  `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`.
- The network, apart from the two cases below.

**Network use.** The mod and the status line make no network calls. The CLI contacts the
network only when you run `ctk sync`, and then only through `git` to the remote you configured
(`file`, `git`, `http`, `https` and `ssh` transports; `ext::` and remotes starting with `-`
are refused). `claude plugin` operations are whatever Claude Code does; CTK adds a local
directory marketplace.

## What the stats files contain

`<config>/ctk/stats/<sessionId>.json` holds counts and figures only: the session id,
timestamps, the configured cap, accepted/refused/guard-failed spawn counts, peak live
teammates, a count per resolved model name, task created/completed counts, and the latest
cost, context %, 5-hour and 7-day limit % that Claude Code reported. It contains no prompts,
task text, file paths, agent names or per-worker cost (Claude Code reports none, and CTK does
not estimate one). Set `stats.record` to `false` to stop writing it.

## Secrets handling

CTK never asks for a secret and has no field that stores one.

**Syncing.** Only fields that the profile schema allows are ever published, plus text files
of skills you list. Before every publish CTK scans every file it is about to commit, and the
commit message, and refuses on any finding (exit `1`, nothing written to the repo). There is
no flag to override the refusal. Before pushing, it also checks every commit that the remote
does not have yet (`origin/<branch>..HEAD`): each must touch only whitelisted paths, and every
version of each file in it is scanned, because a push sends all of them. The scan also runs on
incoming content during `pull`; a finding blocks the whole pull. The scanner is a heuristic
and can miss things. It looks for:

- Known token shapes: Anthropic, OpenAI, GitHub, AWS, Google, Slack and Stripe keys, Slack
  webhooks, private key blocks, JWTs, `Authorization: Bearer ...`, and URLs with
  `user:password@`.
- A value of 8 or more non-space, non-quote characters after one of the keywords `api_key`,
  `access_key`, `private_key`, `secret`, `token`, `password`/`passwd`, `pwd`, `auth` or
  `credential` (with `:` or `=`). Skipped: two or more lowercase words joined by `-` or `_`
  (prose such as `use-the-keychain`), the placeholder words `required`, `optional`,
  `disabled`, `enabled`, `default`, `unset`, `redacted`, `example`, `placeholder`,
  `sensitive`, and references: values starting with `$`, `<`, `{{` or `%`, and file paths.
- Long hex or base32 segments (32+ characters, mixed letters and digits) in the path or query
  of an `http(s)` URL, unless the preceding segment names a git object (`commit`, `blob`,
  `raw`, ...).
- Random-looking strings of 24+ characters (upper and lower case plus digits, high entropy),
  and standalone base32 of 32+ characters. Hex is never judged on its own, and lockfile
  digests (`sha512-...`, `h1:...`), git SHAs and UUIDs are not flagged.
- In JSON files, key names such as `apiKey`, `token`, `secret`, `password`, `credentials`,
  `authorization`, `refreshToken`, `apiKeyHelper`, `env`, and anything starting with `oauth`.

Findings are reported as `file:line rule (preview)`, where the preview is at most the first
two and last two characters.

**Repository hygiene.** If any existing path segment of the clone that sync reads or writes
(`ctk-profile.json`, `profiles/`, `skills/`, `skills/<name>/...`) is a symlink, `pull` and
`publish` refuse and exit `1`. Skill files must be regular text files (symlinks, odd file
types and unsafe paths are rejected), and a skill path containing a control character or `:`
is refused. Control characters in names that come from the remote are stripped before CTK
prints them, and URLs in CTK's own output have their userinfo replaced by `***`.

**Remote URLs.** `sync init` rejects a URL whose userinfo carries a password, a token-looking
value, or anything the scanner flags, and the same check applies to a stored `config.json`.
Use a git credential helper or an ssh key.

**Device layer.** `<config>/ctk/devices/<device>.json` is never put in the profile repo: `sync`
publishes the user layer and nothing else. Put machine-specific values there.

**If a secret does get out.** A credential that reached a git remote, a terminal, a log or a
transcript should be treated as compromised and rotated. Removing it from history is a
separate step CTK does not perform.

## Process execution

CTK starts `claude` and `git` only, with argument arrays and no shell, with one exception:
on Windows a `claude.cmd` shim can only run through a shell, so its arguments are quoted and
an argument containing a double quote is refused. `git` runs with `GIT_TERMINAL_PROMPT=0`, so
CTK never blocks on or handles a credential prompt; authentication is whatever your git
credential helper or ssh agent provides. The environment passed to `git` is scrubbed of
`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_COMMON_DIR`,
`GIT_NAMESPACE`, `GIT_CONFIG_PARAMETERS` and `GIT_CONFIG_COUNT`, so it cannot be pointed away
from the clone, and `GIT_LITERAL_PATHSPECS=1` stops path names being read as patterns. Commits use `--no-verify`, which skips git hooks of
the CTK-managed clone only.

The `statusLine` entry makes Claude Code run `'<node>' '<config>/ctk/bin/ctk-statusline.mjs'` on
each refresh, with each path single-quoted for POSIX shells (embedded quotes escaped). On
Windows the command uses double-quoted forward-slash paths, and CTK refuses to build it for a
path containing `"`, `$`, a backtick or `%`. The script is a single dependency-free file copied
from the package; its hash is in the ledger, `ctk update` replaces it only if the packaged copy
changed, and a copy you edited yourself is never overwritten (reported as a conflict).

A repository's own git config can make `git status` run commands (an fsmonitor hook, filters,
hooks, pagers, aliases, credential helpers). Because a status line runs on every refresh in
whatever directory you open, the script reads the repository's config first and skips the
dirty marker if any such setting is present. When it does run `git status`, it passes
`core.fsmonitor=false` and an empty `core.hooksPath`, ignores the system git config and
`GIT_DIR`-style environment variables, and ignores submodules. Strings from Claude Code's JSON
have control characters removed before they are printed.

## File permissions

CTK preserves the existing permission bits of any file it rewrites (a `settings.json` with
mode `600` stays `600`). Files it creates itself (ledger, profile layers, sync state, status
line script) are owner-only: `600`, and backup directories `700` with `600` copies. This is
POSIX behaviour; on Windows CTK relies on the ACLs of your user profile.

Not covered: files created by an earlier build keep their old mode; the `<config>/ctk`
directory itself and the sync clone use default modes (the files inside are `600` or git's
own); and the stats files are written by Claude Code on the mod's behalf, so their permissions are
set by Claude Code's host write, not by CTK (not checked). If the config directory is shared, restrict the
directory itself (`chmod 700`).

## Known limitations

These are current behaviours, not guarantees.

### A pulled profile is trusted input

`ctk sync pull` fetches and applies in one step; `--dry-run` does not fetch, so it cannot
preview incoming changes. Anything the whitelist allows is applied without a prompt:
the plugin options, `model`, `effortLevel`, `teammateMode`, `outputStyle`, `language`, and the
text files of skills named in the profile (`.md`, `.txt`, `.json`, `.yaml`, `.yml`, `.mjs`,
`.js`, `.ts`, `.sh`). Skills are instructions that Claude follows and may contain scripts it
can run. Whoever can push to your profile repo can therefore change how your Claude Code
behaves. Use a private repository that only you can write to, enable two-factor authentication
and branch protection on the host, and read `git log -p` in `<config>/ctk/sync/repo` after a
pull from a repository you do not fully control. Files that `pull` changes are backed up first.
The symlink check covers the profile repo; pulled skills are not symlink-checked on the local
`<config>/skills` side.

### Backups contain your settings

Each backup holds copies of `settings.json` and Claude Code's plugin registry files exactly
as they were, including any credentials or tokens you keep in `env`. Backups stay on the
machine, are not synced, and CTK never deletes them. Delete them yourself when you no longer
need them, and keep the config directory out of cloud-sync folders and repositories.

### Remote URL checks are not exhaustive

A short, low-entropy userinfo in an `https` URL (for example `https://abc123@host`) is treated
as a user name and accepted. CTK redacts URLs in its own output, but not in what `git` itself
writes (its config file in the clone, its error messages when run by hand).

### Commit messages carry the device name

The default publish message is `ctk: update profile <name> from <device>`, where the device
name comes from your host name unless you pass `--device`. Use `-m` or `--device` if the host
name is sensitive. No tool or author trailers are added.

### Scanner limits

The secret scan is best effort. A secret in a form it does not recognise (short, low
entropy, or split across lines) will not be caught; a value shorter than 8 characters after a
keyword is not examined. In the other direction, a single lowercase word after a keyword
(`token: somevalue`) is flagged, so a legitimate value can be refused, and because there is no
override flag you have to change the text. The scan is a safety net; do not put secrets in
profile fields or skills in the first place.

### Skills sync as one value

The `skills` list is one value in the profile, so two devices that each add a different skill
produce a conflict that `ctk sync resolve` settles by taking one list, not both.

### Experimental dependencies

The cap and the band depend on Claude Code features that are experimental (Agent Teams) or in
early access (mods), and on the `claude plugin` command line. If their behaviour changes, the
cap may stop applying. `ctk doctor` reports whether mods are supported by the installed
Claude Code version, but it cannot confirm at run time that the hook is enforcing. When mods
are unavailable, the cap is not enforced and the `team` skill's instructions are the only
control. See [LIMITATIONS](LIMITATIONS.md).
