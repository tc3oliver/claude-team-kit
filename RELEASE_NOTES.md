# Claude Team Kit 0.1.2 (prerelease)

A hardening release: every problem a full code review of `main` found is fixed, verified by a test
that fails without the fix, and green across the whole CI matrix. No features and no new runtime
dependencies. The worker cap, Mission Control's behaviour and the plugin's always-on context are
unchanged.

This is still a **public preview**. Agent Teams are experimental in Claude Code and Mods (which
carry the cap and the team line) are early access, so it can break when Claude Code changes. Read
"Known limitations" before you rely on it.

## Breaking change: an `http(s)` sync remote may no longer carry any userinfo

`ctk sync init` now refuses **any** userinfo in an `http` or `https` remote URL — previously a bare
user name (`https://abc123@host`) was accepted as "not a credential". Two reasons: the URL is stored
in `sync/config.json` as plaintext, and with `GIT_TERMINAL_PROMPT=0` a username-only http(s) URL
cannot authenticate anyway, so it never worked.

If you stored such a remote, re-run `ctk sync init` with a clean URL. Use a git credential helper or
an SSH key. SCP-style (`git@host:org/repo.git`) and plain `https://host/org/repo.git` remotes are
unaffected. No error message ever echoes the credential.

## Security

- **A referenced skill can no longer be deleted from the shared repo.** `publish` decided which
  skills were stale by reading every tracked sibling profile, and a profile that failed to parse was
  silently treated as "references nothing" — so its skills were deleted, recoverable only from git
  history. A tracked profile that is missing, unreadable, invalid JSON or schema-invalid now refuses
  the whole publish: nothing is deleted, committed or pushed.
- **Credentials are no longer written to disk from a remote URL** (the breaking change above), and
  `redactUrls` now hides userinfo in any scheme, not only `http(s)`.
- **The secret scanner catches authorization-style keys.** `"authorizationHeader": "Bearer …"` used
  to pass every rule — the key deny-list held only the exact word `authorization`, and the value
  rules need the keyword immediately before the secret. The deny-list now matches by prefix, so
  `authorizationHeader`, `authorization_header`, `AuthorizationValue` and `authHeader` are refused
  whatever the value looks like, including a placeholder. Plain `auth*` keys that are not
  credentials (`author`, `authority`, `authentication`, `authorizedKeysFile`) are still not flagged.
- **Reading a skill directory fails safe.** A file or subdirectory that is unreadable or disappears
  mid-walk is recorded as a problem that makes the whole skill unusable, instead of throwing a raw
  filesystem error that bypassed the refusal path.
- **No path can reach `rmSync` unvalidated.** Every tracked path a publish would delete is checked
  with `isSafeRelPath` first; a crafted `../`, `.git` or absolute entry in the git index refuses the
  publish rather than deleting something outside the clone. This is the check `publish` already
  applied to unpushed commits.

## Data integrity

- **`settings.json` writes are a compare-and-swap.** CTK and Claude Code both read-modify-write the
  file; the atomic rename prevented corruption but not a lost update, so an edit landing while CTK
  was planning was silently overwritten. CTK now records a content hash when it reads the file and
  refuses the write if the file changed underneath it — nothing on disk changes, and you re-run to
  pick up the new content. This is not a lock: a lockfile cannot bind Claude Code, and the narrow
  window between the re-read and the rename is documented in the [threat
  model](docs/THREAT-MODEL.md#settingsjson-compare-and-swap-is-not-a-lock) rather than claimed away.
- **A minified `settings.json` stays minified.** The indentation heuristic never matched a
  single-line file, so CTK's next write reformatted the whole user file to two-space indent.
- **Backups hash what they actually stored.** `createBackup` hashed the source *after* copying it, so
  a source changed in between produced a manifest SHA matching neither copy — `verifyBackup` then
  reported "backup copy differs" and rollback or uninstall refused to restore. One read now feeds
  both the copy and the hash.

## Reliability

- **Rollback is crash-consistent.** Several transactions were reverted in a loop but the ledger was
  saved once at the end, so a crash mid-rollback left reverted files against a ledger with no
  `undoneAt` — and the next run reverted them again. The ledger is now the per-transaction commit
  point. A re-run is idempotent because every write re-checks live state first, and a value you
  changed after the crash is kept as a conflict, never overwritten. Verified by fault injection at
  three stages (before the first transaction, after its files, during the ledger write) plus a
  middle-transaction crash.
- **`ctk uninstall` restores instead of deleting.** An out-of-CTK-dir file with a prior version and
  a backup copy used to be forced down the delete branch; it is now restored from the backup.
- **`ctk doctor` no longer crashes on an odd filesystem.** It parses `ledger.json` once per run
  instead of twice, and reports a skills path that exists but is not a directory instead of throwing
  `ENOTDIR`.
- **A flag-shaped value cannot hijack the CLI.** `ctk config set outputStyle --version` printed the
  version and exited 0, because global flags were detected by scanning raw `argv` before parsing.
  They are decided from parsed tokens now; `--version` counts only before the command word.

## Performance (measured, not estimated)

- **Mission Control builds its model once per pane frame instead of three times.** The pane drew the
  Mission three times per frame — for the motion timer, the observation and the render — so
  `buildMission` ran its O(n²) task rows three times for one snapshot. It is now built once and
  threaded to all three, so motion, rows and pending state read one view. Measured **3 → 1**
  `buildMission` calls per draw; host calls per draw unchanged.
- **A burst of task events no longer storms the host.** `TaskCreated`/`TaskCompleted` each fired a
  full refresh (roster, usage, clock, model, `.git/HEAD`, a stats write) while the equivalent
  tool-call counter already used a throttled path. They use it too: a burst of 50 events costs
  **300 → 150** host calls, loses no counter and adds no delay to the task board, which rides a
  different event.
- **Fewer allocations per frame:** one pending-change sweep per draw instead of three, and the stats
  view's matcher is hoisted to module scope instead of being rebuilt per segment per frame.

## Also

- **One live-status predicate.** The cap, the band's subagent count and Mission Control each had
  their own test and diverged on an unknown status. An unrecognised status now counts as live
  everywhere, so the cap refuses rather than over-admits and no view hides a possibly-running agent.
- **Task eviction respects the DAG.** Past 500 remembered tasks, eviction refreshed nothing, so an
  actively-updated old task could be dropped while newer finished ones stayed and then resurrected.
  Updates refresh recency now, and terminal, unreferenced tasks go first — a task another retained
  task depends on outlives them.
- **Dead code removed:** `listFiles`, `merge3`'s `unchanged` field, `busyStatuses`, the never-read
  `Change.to`, the unused `from` of a parsed pending change, and a `priorEq` duplicated in two
  modules (now one, beside the type it operates on). Three copies of the backup file list are one
  exported `backupSet`.

## Upgrade

`/plugin marketplace update ctk-kit`, then `/plugin update ctk@ctk-kit`. **An update only arrives
when the plugin `version` changes** (the manifest pins it), and it did — 0.1.1 to 0.1.2 — so a
normal update reaches you and keeps your options. Verified on a scratch config directory: a 0.1.1
install with `maxWorkers=3`, `reviewerModel=opus` and `hudIdle=minimal` updates to 0.1.2 with all
three options, the worker cap and model routing intact.

If you are on a preview installed from an earlier commit at the same version, reinstall to catch up:
`/plugin uninstall ctk@ctk-kit`, then install again with `--config KEY=VALUE`, because
**uninstalling deletes the plugin's options** from `settings.json` (note your cap first;
`/ctk-doctor` shows it).

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
tc3oliver/claude-team-kit#v0.1.1`) and install again with your options. Details:
[docs/INSTALLATION.md](docs/INSTALLATION.md#update-and-remove-native).

## Known limitations

Full list: [docs/LIMITATIONS.md](docs/LIMITATIONS.md). The ones to know first:

- The cap needs Mods (Claude Code 2.1.287 or newer; reportedly not available in WSL). Without them
  there is no cap, no team line, and `/ctk:team` says so before starting.
- Worktree isolation and the cap exclude each other: a named `Agent` call that passes
  `isolation: worktree` is an ordinary subagent, which the cap does not count.
- The settings compare-and-swap is not a lock; see above and the threat model.
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

This is the GitHub **prerelease** `v0.1.2` with the npm tarball attached. The earlier prereleases
`v0.1.1` and `v0.1.0` are unchanged. Not published to npm and not in any official Claude Code
plugin directory. The repository works as a plugin marketplace as it is, and installing from the tag
is what `/plugin marketplace add tc3oliver/claude-team-kit#v0.1.2` does. `npm publish` stays a
manual step after review.
