# Review guide

For external reviewers. It says what CTK is made of, why it is built that way, how to
reproduce every check, and where to push hardest. Statements are facts that were run or read;
anything else is marked `UNVERIFIED`. Numbers were produced on macOS with Node 24.21 and Claude
Code 2.1.294 at the time of writing.

Related: [ARCHITECTURE](ARCHITECTURE.md) (design), [THREAT-MODEL](THREAT-MODEL.md) (what is read
and written, secrets), [LIMITATIONS](LIMITATIONS.md) (evidence levels), [ROLLBACK](ROLLBACK.md)
(undo behaviour with real output), [../SECURITY.md](../SECURITY.md) (reporting).

## 1. Architecture on one screen

```
ctk (Node CLI)                          Claude Code
src/cli      router, help, exit codes     plugin ctk@ctk-kit  (plugin/ctk)
src/install  install update undo apply      hooks/register.tsx + team.ts + band.ts   the mod
             marketplace statusline txn     shared/policy.ts stats.ts format.ts      option defaults, stats record
src/core     claude.ts (only spawner of     skills/{team,review,debug}  agents/*.md  prompts, no code
             `claude`) ledger settings      statusline/ctk-statusline.mjs            fallback HUD, copied out
             fsx jsonx schema paths
src/sync     engine git files secrets     <config> = Claude config dir
                                            settings.json      CTK edits owned keys by JSON pointer
                                            ctk/ledger.json    what CTK wrote, prior values, transactions
                                            ctk/backups/<id>/  copies taken before each write
                                            ctk/stats/*.json   written by the mod
```

Data flow for options: profile (defaults, user layer, device layer) is resolved by
`src/core/schema.ts`, written by `src/install/apply.ts` to `settings.json` under
`/pluginConfigs/ctk@ctk-kit/options`, and read by the mod through `register(on, options)` and
`readOptions` in `plugin/ctk/shared/policy.ts`. The mod never reads the profile files.

Processes: `ctk` spawns `claude plugin ...` (argv array, `CLAUDE_CONFIG_DIR` set) and, for
sync, `git`. The mod runs inside Claude Code. The status line script runs as a separate `node`
process started by Claude Code and runs one `git status`. There is no daemon and no network
client in CTK's code (`grep` for `node:http`, `node:https`, `node:net`, `fetch(` in `src/`,
`plugin/ctk/hooks`, `plugin/ctk/shared` and the status line script returns nothing).

## 2. Key decisions and reasons

| Decision | Reason |
|---|---|
| The team cap is a Mods hook on `agent.spawn`, not a setting | Claude Code has no official worker cap (Reported). A hook is the only enforcement point, and a hook can deny a spawn. |
| Fail closed: if the roster cannot be read, deny with `TEAM_GUARD_FAILED` | An unreadable roster must not become unlimited workers. |
| A refusal carries a fixed token, `TEAM_CAPACITY_REACHED`, and the `team` skill keys off it | A refused spawn can still render as "Done" in the transcript (Reported); the lead agent needs a text signal that survives that. |
| Acceptance is verified (agent id and teammate id present) before it is counted | A result without ids did not start a teammate. |
| CTK edits `settings.json` by JSON pointer and records the prior value of every key | Rollback and uninstall can then compare the live value with what CTK wrote and touch nothing else. |
| Plugin enablement only through `claude plugin ...`, never by editing `enabledPlugins` | Claude Code owns that file's plugin state; two writers would disagree. |
| Effort is not configurable from a profile | The spawn hook can set a model but not an effort; effort comes from the agent files. |
| Sync is git only, with a whitelist and a scanner that has no override flag | No server to run or trust; publishing a secret is not recoverable. |
| One runtime dependency (`zod`) | Small install surface; everything else is `node:` built-ins. |
| Always-on context under 500 tokens | Measured by `scripts/measure-context.mjs` (CI budget argument 500). |
| The marketplace is the package directory itself | `claude plugin marketplace add <dir>` is the only registration path that needs no hosting. Cost: moving the directory breaks the plugin; `ctk install` re-points it. |

## 3. Risks, stated plainly

- **Early-access dependency.** The mod API and the version floor (`2.1.287`) can change in a
  Claude Code release; the cap, band and `/ctk-stats` would stop working with no change to CTK.
- **Shared file.** `settings.json` is also rewritten by Claude Code. CTK writes atomically (temp
  file and rename) but no test races it against a running Claude Code.
- **The cap is global to the session.** It gates every teammate spawn, including other plugins'.
- **Secrets.** `settings.json` backups can contain what the user keeps in `env`. Backups are
  mode 0600 on macOS and Linux and are never deleted by CTK.
- **A pulled profile is trusted input** within the whitelist (see
  [THREAT-MODEL](THREAT-MODEL.md#known-limitations)).

## 4. Reproduce every check

Prerequisites: Node 22.19 or newer or 24 (tests run `.ts` directly), Claude Code on `PATH`
for the plugin checks (no login needed), git for the sync tests. Run from the repository root.

```sh
npm ci
npm run typecheck          # tsc -p tsconfig.json --noEmit
npm test                   # node --test test/**/*.test.ts and the status line .mjs tests
npm run test:plugin        # claude plugin test plugin/ctk
npm run validate:plugin    # claude plugin validate plugin/ctk --strict, and the marketplace
npm run check              # all four of the above, in order
node scripts/measure-context.mjs 500    # always-on text budget; exit 1 above 500 tokens
npm run build && npm pack --dry-run     # package contents (prepack also builds)
```

Reproducing the real-binary flows (scratch config directory, never `~/.claude`):

```sh
export CLAUDE_CONFIG_DIR="$(mktemp -d)"
npm run ctk -- install --dry-run
npm run ctk -- install
npm run ctk -- doctor
claude -p "/ctk-stats"              # the mod answers: proves it loaded
claude plugin details ctk@ctk-kit   # Claude Code's own always-on estimate
npm run ctk -- uninstall
cat "$CLAUDE_CONFIG_DIR/settings.json"   # {} for a fresh directory
```

Reproducing the plugin types (they are generated, not committed):
`claude --plugin-dir plugin/ctk -p "/ctk-stats"` with a scratch `CLAUDE_CONFIG_DIR` writes
`plugin/ctk/.claude-plugin/types/`; then `npx tsc -p plugin/ctk --noEmit` typechecks the mod.

Documentation consistency (`test/docs.test.ts`, part of `npm test`): every `ctk` command shown
in a doc parses against the router, every relative link and anchor resolves, no machine-local
path appears, and `docs/*.md` has no first-person voice.

## 5. Please look hard at

Each item gives the code to read, the invariant, the tests that pin it, and the mutation result.
"Mutation" means: one source line was changed in a scratch copy of the tree, the named suite was
run, and the copy was reset. KILLED means at least one test failed; SURVIVED means all passed.
The mutations were made at the time of writing, one at a time, and are not a CI job.

### 5.1 Hard concurrency limit and race handling

- **Read:** `plugin/ctk/hooks/register.tsx` (`agent.spawn` handler, `liveTeammates`, `.catch`),
  `plugin/ctk/hooks/team.ts` (`effectiveLive`, `PENDING_TTL_MS`, `capacityDeny`, `guardDeny`).
- **Invariant:** with cap N, the number of live teammates plus accepted-but-unlisted teammates
  plus in-flight reservations never exceeds N when a spawn is allowed; concurrent spawns see each
  other's reservations; an accepted teammate stays counted until the roster lists it or 10 s pass;
  any failure before `next()` denies (`TEAM_GUARD_FAILED`); only `isTeammate === true` spawns are
  gated.
- **Tests** (`plugin/ctk/tests/cap.test.ts`, `policy.test.ts`, run by `claude plugin test`; simulated
  host): "6 concurrent teammate spawns: exactly 3 start, 3 refused, peak never above 3", "2 already
  live + 6 concurrent: exactly 1 more starts", "fails closed when the roster cannot be read", "the
  same roster failure never blocks a plain subagent", race stress, double-count window, and
  "roster lags behind an accepted spawn" (lag of 2, 3 and 7 list calls; listed-as-completed frees
  the slot; never listed within 10 s releases it).
- **Mutations:**
  - no reservation at all (increment and decrement removed): KILLED (26 tests);
  - check ignores in-flight reservations (`live` only): KILLED (26);
  - pending teammates not counted: KILLED (6);
  - pending never expires: KILLED (1, the 10 s release test);
  - guard fails open (`.catch` returns `next(e)`): KILLED (1);
  - unreadable roster tolerated (`.catch(() => [])`): KILLED (1);
  - reservation taken after the first `await` instead of before: **this mutant is semantically
    still safe** (the cap still admits exactly 3), and it first SURVIVED because no test pinned
    *which* spawns are refused. A 12-case test (`early reservation > 6 concurrent, roster answers
    after N ticks, spawn takes M: each sees the others' reservations`) now pins that the first
    three spawns are refused with `starting=5,4,3` and the last three start. With it the mutant is
    KILLED (12 tests). What the early reservation guarantees is the order of refusals, not the
    number admitted.
- **Live evidence:** Reported by the maintainers (6 concurrent spawns on 2.1.294: 3 started,
  3 refused); not reproduced independently. `UNVERIFIED` live.

### 5.2 Worker spawn refusal and capacity recovery

- **Read:** `plugin/ctk/skills/team/SKILL.md` (sections 3 and 4), `plugin/ctk/skills/team/references/protocol.md`,
  `capacityDeny` in `team.ts`, the acceptance check in `register.tsx`.
- **Invariant:** a refusal text always begins `TEAM_CAPACITY_REACHED:` (or `TEAM_GUARD_FAILED:`);
  the skill treats that text, a missing teammate id, or a bare "Done" row as "not started" and
  keeps the task `pending`; a result without both `agentId` and `teammateId` is not counted as
  accepted; freed capacity (finished, shut-down teammates) allows later spawns.
- **Tests:** `test/contract.test.ts` (the `team` skill text contains `TEAM_CAPACITY_REACHED`,
  size and description budgets); `cap.test.ts` ("finished teammates free their slot; idle ones
  do not", "sequential spawns after a teammate finishes are allowed again"); "verified acceptance and
  stats > an accepted spawn without agentId and teammateId is not counted".
- **Mutations:** refusal text without the token: KILLED (2); accepted spawn counted without ids:
  KILLED (1).
- **Not covered:** whether a live model follows the skill text after a refusal. The `/ctk:team`
  workflow has not been run end to end with live agents. `UNVERIFIED`.

### 5.3 Mods API compatibility

- **Read:** `plugin/ctk/.claude-plugin/plugin.json`, `plugin/ctk/tsconfig.json`,
  `MODS_MIN_VERSION` and `probeClaude` in `src/core/claude.ts`, the version branch in
  `src/install/install.ts`, the "mods" check in `src/cli/commands/doctor.ts`.
- **Invariant:** every host call in the mod is wrapped so an unsupported API degrades (no band,
  no stats) and the cap stays fail-closed; on Claude Code older than 2.1.287 `ctk install` still
  installs skills, agents and the status line and says what is inactive; `claude plugin validate
  --strict` passes for the build in use.
- **Tests:** `claude plugin test plugin/ctk` (76 tests) and `validate:plugin` (both pass);
  `test/firstrun.test.ts` "Claude Code older than 2.1.287: says what is unavailable and which
  version is needed, then installs the rest" (stub `claude`); `test/doctor.test.ts` ("old Claude
  Code warns about mods").
- **Types:** generated per build into `plugin/ctk/.claude-plugin/types/` (git-ignored); they are the
  contract the mod was written against. A different build can ship different types.
- **What happens on an unsupported build:** version below the floor: stub-tested as above. A build
  at or above the floor where the API changed: **not tested**; the mod would fail to load, and
  `ctk doctor` would still pass its "mods supported" check because that check compares versions
  only. `claude -p "/ctk-stats"` is the real check.
- **Mutation:** not mutation-tested.

### 5.4 HUD permissions and data sources

- **Read:** `claude plugin validate plugin/ctk --strict` output, `plugin/ctk/hooks/register.tsx`
  (`statsPath`, `persist`, `boot`), `plugin/ctk/hooks/band.ts`, `plugin/ctk/statusline/ctk-statusline.mjs`.
- **Invariant:** the mod calls only read-only host APIs plus `$.fs.write` for its own stats file,
  `$.fs.read` for that same file, `$.tool.register` and `$.command.register`; it reads only the
  environment variables `CLAUDE_CONFIG_DIR`, `HOME` and `USERPROFILE`, writes none; no network, no
  credentials, no transcript. The status line script reads the JSON on stdin, `.git/HEAD`, the
  repository's git config files (only to decide whether `git status` is safe to run), and runs one
  `git status`.
- **Validator output (this tree):**
  `calls: $.agent.list, $.clock.now, $.command.register, $.env.get, $.fs.read, $.fs.write,
  $.session.id, $.session.usage, $.tool.register, $.ui.invalidate, $.ui.resolve`;
  `env reads: CLAUDE_CONFIG_DIR, HOME, USERPROFILE`; `env writes: nothing`.
- **Tests:** `plugin/ctk/tests/hud.test.tsx` (band content, 80-column truncation, missing
  figures as dashes, hidden when `hudBand` is false, yields to the survey prompt), stats tests in
  `cap.test.ts`/`policy.test.ts` (file content, throttling, a failing write never affects a spawn,
  `recordStats=false` writes nothing), `plugin/ctk/statusline/test/statusline.test.mjs`.
- **Stats file content:** counters, percentages, cost, model names, session id. No prompts, paths
  or per-worker figures ([THREAT-MODEL](THREAT-MODEL.md#what-the-stats-files-contain)).
- **Mutation:** not mutation-tested (the band and stats code).

### 5.5 Git profile sync security

- **Read:** `src/sync/engine.ts` (`assertNoCredentials`, `publish`, `checkUnpushed`), `src/sync/git.ts`
  (`gitEnv`, `REDIRECTS`, `redactUrls`), `src/sync/files.ts` (`collectSkill`, `symlinkOnPath`,
  `isSafeRelPath`), `src/sync/secrets.ts`, `src/cli/commands/sync.ts`.
- **Invariants:**
  - nothing outside the whitelist (`ProfileLayer` fields, `skills/<name>/**` for listed names) is
    read, applied or published; skill files are text only, at most 256 KiB, at most 100 per skill;
  - a symlink anywhere on a path inside the clone is refused, so reads and writes stay in the clone;
  - git runs with an argv array, `GIT_TERMINAL_PROMPT=0`, `GIT_LITERAL_PATHSPECS=1`, a restricted
    `GIT_ALLOW_PROTOCOL`, and `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`,
    `GIT_COMMON_DIR`, `GIT_NAMESPACE`, `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT` removed from its
    environment;
  - publish scans everything it would commit, the commit message, and every unpushed commit's
    file versions; there is no override flag; it never force-pushes and never publishes the
    device layer;
  - a remote URL with a password or token is refused and never printed (`redactUrls`).
- **Tests:** `test/sync.engine.test.ts` (38), `test/sync.files.test.ts`, `test/sync.secrets.test.ts`,
  `test/sync.merge3.test.ts`, `test/sync.integration.test.ts` (local bare repositories as remotes),
  for example "a symlinked profiles/ in the remote is a refusal on pull, and nothing is written
  outside the clone", "git calls ignore GIT_DIR and friends from the environment", "publish refuses
  unpushed commits that touch non-whitelisted paths and pushes nothing", "init rejects remote URLs
  that carry credentials and stores nothing", "a secret in a skill blocks publish".
- **Mutations:**
  - symlink check on repo paths disabled: KILLED (3);
  - symlink entry in a skill directory accepted: KILLED (3);
  - `GIT_*` redirect variables not scrubbed: KILLED (1);
  - unpushed-commit scan skipped: KILLED (2);
  - password in remote URL accepted: KILLED (2);
  - scan of the planned publish files skipped: KILLED (2);
  - Anthropic key rule removed from the scanner: KILLED (2);
  - `ext::` added to the default `GIT_ALLOW_PROTOCOL`: first SURVIVED; now KILLED (2) by "git
    helper pins the transport allow-list: plain transports only, never ext or fd" and "git itself
    refuses to run an ext:: transport started through the helper".
- **Known gaps:** the scanner is pattern and entropy based; the remote URL check is not
  exhaustive; a pulled profile is trusted within the whitelist; only local bare repositories were
  exercised (no hosted remote, no authentication flow). See
  [THREAT-MODEL](THREAT-MODEL.md#known-limitations).

### 5.6 Config ownership, rollback and uninstall

- **Read:** `src/install/apply.ts` (`planSettings`, `applySettings`, `noteAbsentContainers`,
  `pruneContainers`), `src/install/undo.ts` (`undoChanges`, `rollback`, `uninstall`, `wipeCtkDir`),
  `src/install/marketplace.ts`, `src/core/ledger.ts`, `src/install/txn.ts`.
- **Invariants:**
  - a `settings.json` key is changed or removed only when its current value equals what CTK wrote
    (or equals the prior value already); anything else is left, reported, and no longer tracked;
  - the ledger is saved with a `pending` marker before `settings.json` is written, so a crash
    between the two is finished by the next run and not mistaken for a user edit;
  - `containersAbsentBefore` lists containers (`/enabledPlugins`, `/extraKnownMarketplaces`, and
    ancestors of keys CTK created) that did not exist before CTK; uninstall deletes one only if it
    is still listed and is now an empty object, so `settings.json` returns to its original content
    (a fresh directory returns to `{}`);
  - a key the user deleted stays deleted (note, exit 0); an edited status line script is a
    conflict, never overwritten; a plugin the user disabled stays disabled, including after a
    re-point reinstall;
  - uninstall keeps `backups/`, `devices/`, `sync/`, and keeps the whole `ctk/` directory with its
    ledger when any step conflicts or fails, so a re-run can finish;
  - `claude plugin uninstall` deletes the whole `pluginConfigs["ctk@ctk-kit"]` entry; CTK reports
    user-edited options as removed with the plugin, naming the backup that holds them.
- **Tests:** `test/apply.test.ts`, `test/undo.test.ts` (21), `test/install.test.ts` (21),
  `test/update.test.ts`, `test/firstrun.test.ts`, `test/doctor.test.ts`,
  `test/install.integration.test.ts` (real `claude` in a scratch directory, skipped when absent).
  Examples: "uninstall restores settings, removes plugin/marketplace/ctk dir, keeps backups and
  foreign keys", "rollback refuses to overwrite a value the user changed after the transaction",
  "a crash between the ledger save and the settings write is finished by the next run", "a failed
  plugin uninstall keeps the ledger and ctk dir; a re-run completes", "rollback with a
  pre-existing plugin".
- **Mutations:**
  - undo reverts without comparing the current value: KILLED (4);
  - a user-edited key treated as CTK-written when planning: KILLED (1);
  - prune removes non-empty containers: KILLED (5);
  - uninstall removes the ledger despite conflicts: KILLED (3);
  - containers never recorded as absent before: KILLED (8);
  - `pending` marker ignored on recovery: KILLED (1).
- **Live evidence:** install, idempotent re-install, doctor, rollback, uninstall, marketplace
  re-point, disabled plugin, edited script and edited options were each run against the real
  `claude` 2.1.294 in scratch config directories on macOS.
- **Not tested:** a real interruption (kill -9) of `ctk` between the ledger save and the settings
  write; only the simulated crash. Concurrent writes by a running Claude Code. `UNVERIFIED`.

### 5.7 Windows and WSL fallback

- **Read:** `runClaude` and `quoteWin` in `src/core/claude.ts`, `statuslineCommand` in
  `src/install/statusline.ts`, `isWsl` and the `/mnt/` check in `src/cli/commands/doctor.ts`.
- **Invariant:** on Windows `claude` resolves as `claude.exe`, then `claude.cmd` (run through a shell
  with every argument quoted; an argument containing `"` is refused); the status line command uses
  forward slashes and double quotes, and refuses a path containing `"`, `$`, a backtick or `%`; on
  POSIX each path is single-quoted with `'` escaped.
- **Tests:** `test/apply.test.ts` "statusline command, win32: ..." and "statusline command, POSIX:
  ..." (pure string functions on any OS); `test/claude.test.ts` ("runClaude reports a missing
  binary instead of throwing and passes CLAUDE_CONFIG_DIR to the child").
- **Mutation:** POSIX single-quote escaping removed: KILLED (1). Windows paths: not mutation-tested.
- **Untested:** everything that needs Windows or WSL to run: real `ctk install`, the `.cmd` shim
  path, Git Bash handling of the status line command, the mod under Windows Terminal or VS Code,
  WSL behaviour (mods are reported unsupported there; `ctk install` decides by version only and does
  not detect WSL for this). `UNVERIFIED`. CI on `windows-latest` passed ([CI run](https://github.com/tc3oliver/claude-team-kit/actions/runs/37816500991)); that is automated coverage only.

### 5.8 Status line git-config gate

- **Read:** `repoConfigSafe`, `repoConfigFiles`, `UNSAFE_CONFIG`, `isDirty`, `gitEnv` in
  `plugin/ctk/statusline/ctk-statusline.mjs`.
- **Invariant:** the script runs `git status` only if none of the repo-local config files git would
  read for this worktree (gitdir config, `config.worktree`, the common dir's config for a linked
  worktree) is over 64 KiB or matches a pattern that can make git run a command (fsmonitor,
  filter drivers, hooksPath, textconv, include, pager, sshCommand, askpass, alias, editor, external,
  gpg, program, credential). When a file does match, the branch is still shown and the dirty marker
  is skipped. `git` is called with `core.fsmonitor=false`, `core.hooksPath=` and
  `--no-optional-locks`, a 250 ms timeout, stdin ignored. It prints one line for garbage input.
- **Environment and config:** the child environment drops `GIT_DIR`, `GIT_WORK_TREE`,
  `GIT_INDEX_FILE` and `GIT_EXTERNAL_DIFF`. System and global git config are **honoured**: Git
  for Windows ships `core.autocrlf=true` in the system config, and ignoring it (an earlier
  `GIT_CONFIG_NOSYSTEM=1`) made every clean Windows repository show a dirty marker. Only repo-local
  config is distrusted.
- **Tests:** `plugin/ctk/statusline/test/statusline.test.mjs` (31 tests): "inherited GIT_DIR cannot
  redirect the dirty check", "system autocrlf", "hostile repo config (fsmonitor)
  never runs and the branch still shows", "hostile repo config (filter driver) skips the dirty
  marker", "hostile common config reached from a linked worktree skips the dirty marker", "oversized
  repo config skips the dirty marker", "control characters from HEAD and input are stripped",
  "process latency well under the 300 ms debounce".
- **Mutations:**
  - the config gate replaced by `true`: KILLED (2);
  - the `GIT_*` deletion removed: first SURVIVED; now KILLED (1, "inherited GIT_DIR cannot
    redirect the dirty check");
  - only `GIT_EXTERNAL_DIFF` dropped from the list: **SURVIVED**. That half is a guard only:
    `git status` never runs an external diff, so no test can observe it;
  - `-c core.fsmonitor=false` flipped to `true`: **SURVIVED**. The repo-config gate already
    skips `git status` for any repo-local fsmonitor setting; the flag is defence in depth for a
    value coming from global config, which no test sets;
  - `GIT_CONFIG_NOSYSTEM=1` reintroduced: KILLED (1, "system autocrlf").
- **Known limit:** a pattern list is a blocklist; a git configuration key that executes a command
  and is not in the list would pass.

## 5a. Found by CI on Windows

The first runs of the workflow on `windows-latest` found three defects that no run on macOS or
Linux had shown. All three are fixed. CI run: [https://github.com/tc3oliver/claude-team-kit/actions/runs/37816500991](https://github.com/tc3oliver/claude-team-kit/actions/runs/37816500991).

- **Invalid YAML in a skill description.** The `debug` skill's frontmatter `description` contained an
  unquoted colon. macOS and Linux validators accepted it; the Windows run rejected it as invalid YAML.
- **Status line dirty marker wrong on every Windows repository.** The script ran git with
  `GIT_CONFIG_NOSYSTEM=1`. Git for Windows ships `core.autocrlf=true` in the system config, so
  ignoring it made a clean repository report changes. The variable is gone (see 5.8).
- **Tests that assumed POSIX.** Some tests used `/dev/null` and POSIX paths.

Windows is verified only through CI results. Nothing was run interactively on Windows:
the `UNVERIFIED` rows for Windows Terminal, VS Code and a real `ctk install` stand.

## 6. Verification status

| Item | Status | Evidence |
|---|---|---|
| Type check | PASS | `npm run typecheck`, exit 0 |
| Unit and integration tests | PASS | `npm test`: 324 tests (31 of them the status line tests), 324 pass, 0 fail. One earlier run in the same session had `test/demo-render.test.ts` "record captures a real tmux session" fail once (timing: `idle` where `until` was expected); it passed on later runs. |
| Plugin tests | PASS | `npm run test:plugin`: 76 pass, 0 fail |
| Plugin and marketplace validation | PASS | `npm run validate:plugin` (`--strict`), both manifests |
| Mod type check | PASS | `npx tsc -p plugin/ctk --noEmit`, exit 0 (types generated locally) |
| Always-on context budget | PASS | `scripts/measure-context.mjs`: 664 chars, about 166 tokens (budget 500); `claude plugin details` estimate: about 187 tokens |
| Real `claude` 2.1.294, macOS: install, idempotent re-install, doctor, rollback, uninstall, re-point, disabled plugin, edited script/options | PASS | run in scratch config directories (see section 4 to repeat) |
| Mod loads in `claude -p "/ctk-stats"` | PASS | output printed; also with OMC installed beside it |
| npm tarball install (`--prefix`) and install from it | PASS | `npm pack`, `npm install --prefix`, `ctk install`, plugin loaded |
| Documentation consistency | PASS | `test/docs.test.ts`, part of `npm test` |
| Mutation checks | PARTIAL | 30 single-line mutations: 28 KILLED, 2 SURVIVED (5.8: the `GIT_EXTERNAL_DIFF` half of the scrub, a guard that cannot be observed; the `core.fsmonitor=false` override, defence in depth behind the repo-config gate). Three earlier survivors (5.1 early reservation, 5.5 `ext` transport, 5.8 `GIT_DIR` scrub) were pinned by new tests and re-run: now killed. |
| CI on GitHub, commit f4b9a13: tests on ubuntu, macos and windows x Node 22 and 24; plugin validate `--strict` and plugin test on ubuntu, macos and windows; pack audit | PASS (10 of 10 jobs, 2026-10-08 UTC) | [https://github.com/tc3oliver/claude-team-kit/actions/runs/37816500991](https://github.com/tc3oliver/claude-team-kit/actions/runs/37816500991). Earlier runs failed on Windows and found real bugs (section 5a). The repository was private during these runs; they used GitHub-hosted runners only, with Claude Code from npm `latest` at the time. |
| Hard cap against real concurrent spawns | UNVERIFIED (independently) | Reported by the maintainers: 6 concurrent, 3 started, 3 refused, on 2.1.294; simulated-host tests pass |
| `/ctk:team` on a real task with live agents | UNVERIFIED | skill text and cap checked separately |
| `/ctk:review`, `/ctk:debug` on real changes | UNVERIFIED | validated as plugin components only |
| Model routing on live teammates, per team mode | UNVERIFIED | resolution is unit-tested |
| Team band in a live multi-worker session | UNVERIFIED | rendering tests only |
| Interactive first launch: plugin or mod approval prompts | UNVERIFIED | the interactive check stopped at the login screen; `-p` mode showed no prompt |
| Windows Terminal, VS Code terminal, WSL; interactive use on Linux and Windows | UNVERIFIED | only automated CI jobs ran on Linux and Windows (previous row); nothing was run interactively |
| Sync against a hosted remote or with authentication | UNVERIFIED | local bare repositories only |
| Plugin version bump through `ctk update`; rollback to an older tag | UNVERIFIED | only same-version update was run |
| `settings.json` written concurrently by a running Claude Code | UNVERIFIED | atomic write only |
| A real process kill between ledger save and settings write | UNVERIFIED | simulated crash test only |
| Node versions other than 22 and 24 | UNVERIFIED | `engines` is `>=22`; CI and local runs used 22 and 24 only (22.19, 24.21 locally) |

## 7. Known limitations

See [LIMITATIONS](LIMITATIONS.md) for the full list with evidence levels. The ones that change a
decision: the cap exists only while the mod loads (check with `claude -p "/ctk-stats"`); Agent Teams
are experimental and one team per session; effort cannot be set from a profile; there is no
per-worker cost; the install directory must stay in place.

## 8. Unresolved issues

- Two mutation survivors (section 5.8) have no test, for the reasons given there.
- `ctk doctor`'s onboarding check passes after `ctk install` on a directory where `claude` was
  never launched (any `claude plugin` command creates `.claude.json`).
- The next-step lines (`Try: /ctk:team <goal>`) print after a no-change install even when the
  plugin was left disabled.
- Undo output says `restored <key>` for a key it deleted because it did not exist before.
- Backups are never pruned and `stats/` is deleted by uninstall without a copy.
- `test/demo-render.test.ts` failed once in this session with a tmux timing mismatch.
- The CI row in section 6 is unfilled until the first GitHub Actions run.
