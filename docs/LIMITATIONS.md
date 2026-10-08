# Known limitations and unverified items

This page lists what CTK cannot do, what depends on experimental Claude Code features, and what
has not been verified. Read it before you depend on CTK for something expensive.

Evidence levels used below:

- **Live**: run against a real Claude Code (2.1.294) with a scratch config directory, in this
  documentation pass.
- **Reported**: observed live by the project's maintainers (for example in the proof of
  concept) but not reproduced here.
- **Tests**: covered by CTK's automated tests (stub `claude`, simulated host, temporary
  directories), not against real agents.
- **Code only**: read in the source, never executed.
- **Not verified**: nobody has run it.

## Claude Code features CTK depends on

| Limit | Detail |
|---|---|
| Agent Teams are experimental | They are enabled by `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`. Claude Code allows **one team per session** (Reported). Behaviour can change in any Claude Code release. |
| There is no official worker cap | Claude Code has no setting that limits live teammates (Reported). CTK's cap is a **mod** (a function hook on `agent.spawn`) shipped in the plugin. |
| Mods are early access | The mod API and the version floor (`2.1.287`) can change. A Claude Code update can break the cap, the band or `/ctk-stats` without any change to CTK. |
| Mods do not exist everywhere | On Claude Code builds older than 2.1.287 the mod is not available: the cap and the band are inactive, while skills, agents and the status line script still work. Mods are also reported unsupported in WSL sessions; that was not tested. `ctk install` and `ctk doctor` decide this from the Claude Code **version only**; they do not detect WSL for this purpose and print "mods supported" there. |
| `doctor` does not prove the mod is running | "mods supported" is a version comparison, not a check that the mod loaded. `doctor` does fail when `claude plugin list --json` reports load errors (Live: after the install directory was moved, Claude Code reported `failed to load`, `/ctk-stats` disappeared and `ctk doctor` failed). Confirm with `claude -p "/ctk-stats"`. If that command is unknown, **the cap is not enforced**. |
| The cap is by teammate, not by plugin | It gates every teammate spawn in the session, including ones another plugin (for example OMC) starts. See [MIGRATION-FROM-OMC](MIGRATION-FROM-OMC.md). Code only for the other-plugin case. |

## The hard cap

- **Reported**: observed live on Claude Code 2.1.294 in the project's proof of concept (six
  concurrent teammate spawns with the cap at 3: three started, three refused). Not reproduced in
  the independent verification, which covered the cap with simulated-host tests and mutation
  checks only.
- **Tests**: the same logic against a simulated host: reservation of slots before the first
  `await`, refusal text, fail-closed behaviour, and an accepted spawn that lacks ids not being
  counted.
- A refused spawn can still be drawn as **"Done"** in the transcript (Reported). That is why the mod
  answers with `TEAM_CAPACITY_REACHED: live=N starting=M max=K ...` and the `/ctk:team` skill
  treats that text, a missing teammate id, or a bare "Done" row as **not started** and keeps the
  task `pending`. A model can still misread it; the skill reduces that risk, it cannot remove it.
- The slot reservation can count a spawn twice for a moment, so the cap errs towards refusing,
  never towards exceeding.
- If the roster cannot be read, the spawn is refused with `TEAM_GUARD_FAILED` (fails closed).
- Only teammate spawns are gated. Ordinary subagents are neither counted nor limited.
- The cap limits how many teammates are alive, not how much they spend.

## Cost, effort and routing

- **Per-worker token and cost figures are not available.** Claude Code reports session cost,
  context and rate-limit use, not per teammate. CTK shows session figures, labelled measured, and
  its own event counts, labelled counted. It never estimates a per-worker number.
- **Effort per role comes from the agent files and cannot be set from a profile.** The spawn
  hook can set a model but not an effort. `explorer`, `implementer` and `reviewer` are `medium`,
  `high-risk-reviewer` is `high`, as written in `plugin/ctk/agents/*.md`. A profile with
  `routing.<role>.effort` is rejected (Live: `error: routing.implementer.effort:
  routing.implementer: Unrecognized key: "effort"`). To change effort, edit or fork the agent
  files.
- **Model routing** applies only to `ctk:*` agents that give no model, and never overrides an
  explicit one. Tests cover the resolution. **Not verified live:** that the resolved model is
  the one each teammate actually runs on, in every team mode (in-process, tmux, iTerm2) and
  with `inherit`.

## Workflows not run end to end

- **`/ctk:team` on a full real task** (plan slices, create dependent tasks, spawn live
  workers, integrate, verify, shut down) has not been run with live agents. The pieces were
  checked: the skill text, the cap, the refusal and the stats.
- **`/ctk:review` and `/ctk:debug`** have been validated as plugin components (frontmatter,
  size, description budget), not exercised on real changes.
- **The band** is verified by rendering tests (80-column truncation, missing figures as `–`),
  not by watching a live multi-worker session.

## Platforms

| Platform | Status |
|---|---|
| macOS | Live: install, rollback, uninstall, doctor, a same-version `update`, the mod in `claude -p`, npm tarball install. |
| Linux | CI configuration only; not run. |
| Windows native, Windows Terminal, VS Code terminal | Not verified end to end. CI is configured to run unit tests on `windows-latest`; the `.cmd`/`.exe` handling and the forward-slash status line command are code only. |
| WSL | Not tested. Mods are reported unsupported there; the status line script is the fallback. |
| CI workflows (`.github/workflows`) | They have never been run, on any platform. Treat the Linux and Windows rows above as untested. |

In an interactive session, whether Claude Code asks you to approve the plugin or its mod on
first load was not tested: the interactive check went as far as the login screen, which needs
credentials. In `-p` mode no prompt appeared.

## Files CTK edits

- **`settings.json` rewrites by Claude Code are not stress-tested.** CTK edits by JSON pointer
  and writes atomically (temp file and rename), but Claude Code rewrites the same file while
  it runs, so a change made in that window can be lost. Run `ctk install`, `update`, `rollback`
  and `uninstall` with Claude Code closed. Claude Code also reorders keys and migrates values on
  its own (Live, fresh directory: `"model": "opus"` became `"opus[1m]"` after `claude plugin list`
  alone).
- **A key CTK wrote and Claude Code later changed** is treated as yours from then on.
- **The install directory must stay in place.** The marketplace `ctk-kit` points at it, and
  the plugin stops loading if it is moved or deleted (Live). Fix a move by running `ctk install`
  (or `ctk update`) from the new location; CTK re-points a marketplace it added in one
  transaction (Live). Claude Code removes the plugin and its options along with the
  marketplace, so CTK reinstalls it, and a plugin you had disabled comes back enabled. A
  marketplace registered by another tool is not moved: CTK exits `2` and prints the manual
  command (Live).
- **`uninstall` deletes `stats/` and `profile.json`** (the latter is in the uninstall backup,
  `stats/` is not). It keeps `devices/` and `sync/`. A value you edited under
  `pluginConfigs["ctk@ctk-kit"]` is removed by Claude Code with the plugin; CTK names the backup
  that holds it. Details: [ROLLBACK](ROLLBACK.md#uninstall).
- **`rollback` reverts `settings.json` only**, not `profile.json` or the device layer, so the
  next `ctk update` can re-apply what you rolled back. CTK prints a note with the
  `ctk config unset` command when that applies.
- **Edits you make to CTK-managed files are never overwritten.** An edited
  `<config>/ctk/bin/ctk-statusline.mjs` is a reported conflict (exit `2`) on `install` and
  `update`, and makes `uninstall` stop (`uninstall incomplete`, ledger kept). A key you deleted
  stays deleted until you uninstall and install again. A plugin you disabled stays disabled.
  All Live.
- **Backups are never pruned** and are not encrypted. A `settings.json` backup can hold secrets
  from your `env`. They are mode 0600 on macOS and Linux; Windows permissions are not verified.
- **`ctk doctor`'s onboarding check is weak.** It tests that `.claude.json` exists. It looks
  before running any `claude` command, but any `claude plugin` command (including
  `ctk install`) creates the file, so after an install it passes on a directory where you
  never launched `claude`.

## Sync

- Cross-device merge and conflict handling are verified against **local bare git repositories
  only**. No hosted remote, no authentication flow and no network failure was exercised. CTK
  stores no credentials; git's own helpers do the authentication.
- Sync is git only, never force-pushes, and refuses to publish anything the secret scanner
  flags. The scanner is pattern and entropy based and will miss secrets in forms it does not
  recognise; see [SECURITY](SECURITY.md#known-limitations).
- The device layer is never published.

## Updates and versions

- **Plugin updates are not verified.** Only a same-version `ctk update` (nothing to change) was
  run. A real version bump through `claude plugin update`, and a rollback of one, were not.
- **Rolling back to an older CTK release (git tag or older tarball) is not verified.** The
  expected path is `ctk uninstall`, install the old version, `ctk install`.
- CTK is not published to npm or any marketplace host. Install is from a checkout or a tarball
  you build.

## Reporting a gap

If something here is wrong for your setup, run `ctk doctor`, `ctk doctor --json` and
`claude -p "/ctk-stats"` and include the output.
