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

## The native install

The plugin installs with `/plugin marketplace add tc3oliver/claude-team-kit` and
`/plugin install ctk@ctk-kit` and needs no CLI ([INSTALLATION](INSTALLATION.md)). What that means
in practice:

- **A stranger-style install from the public repository was verified once, with a narrow scope.**
  The repository is public. On one macOS machine with Claude Code 2.1.294, in a scratch config
  directory with an empty `HOME`, a clean environment, `GIT_CONFIG_GLOBAL=/dev/null` and ssh blocked
  (`GIT_SSH_COMMAND=/usr/bin/false`; `git ls-remote` over ssh failed there, over https worked),
  `claude plugin marketplace add tc3oliver/claude-team-kit` cloned over HTTPS on its own,
  `claude plugin install ctk@ctk-kit` succeeded (3 skills, 4 agents at that time) and
  `claude -p "/ctk-doctor"` ran with no model call. Not covered: other machines, operating systems
  or Claude Code versions; anything that calls a model; typing `/plugin install` in an interactive
  session (the CLI form was run). A local-directory marketplace is also covered by
  `test/native-install.integration.test.ts`.
- **Nothing in a native install turns Agent Teams on.** You add
  `{"env":{"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS":"1"}}` to `settings.json` once. Until then
  `/ctk:team` spawns nothing and says so; `/ctk-doctor` shows the one exact fix (Live for
  `/ctk-doctor`; the skill's preflight is skill text, not run with a live model).
- **A plugin cannot install a status line or edit settings.** The status line, the flag edit,
  profiles and sync are CLI-only. The skill edits `settings.json` only if you say yes, through the
  Edit tool, so you approve it.
- **Task tools cannot be detected reliably.** On Claude 5.x models Claude Code omits the Task
  tools by default, and a deferred tool is not in the mod's tool list. `/ctk-doctor` therefore
  reports them as `ok` or `unknown`, never `missing`. The team skill creates the task list whenever
  `TaskCreate` exists; the maintainers report a recorded run in which a lead skipped it while the wording allowed, which
  is why the wording is now unconditional (Reported). Whether a lead model now always follows it is
  not verified.
- **Options are defaults until you configure them.** `claude plugin install` prints
  `7 userConfig options not yet set`; that is harmless. `/plugin configure ctk@ctk-kit` was not run
  (it is interactive); `--config KEY=VALUE` at install was (Live).
- **Updating** is `/plugin update ctk@ctk-kit`. A real version bump through it was not run.
- **Removal leaves traces.** After `/plugin uninstall` and `/plugin marketplace remove`,
  `settings.json` keeps empty `enabledPlugins` and `extraKnownMarketplaces` objects, and the mod's
  counters stay in `<config>/ctk/stats/` until you delete them (Live).
- **`/team` costs more than the always-on estimate.** The fixed cost is +425 tokens measured; invoking `team`
  adds about 850, `review` 330, `debug` 280 (`claude plugin details`, estimates).

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

## The HUD

- **Rate-limit figures are subscriber-only.** Claude Code reports the 5-hour and weekly windows
  (percentage and reset time) only for subscription plans, after the first API response. With an API
  key the band and status line show `5h –` and `Wk –`. CTK does not estimate them, call a usage
  API or read credentials to fill the gap.
- **A reset countdown is only as fresh as the last redraw.** It is the reported reset time minus
  the clock at the last update, which happens on events, not on a timer.
- **Tool calls are counted by the mod, so only the band shows them.** Claude Code's status line
  JSON has no tool-call count and CTK does not read the transcript. The count is every call the
  model made this session (lead, subagents and teammates), once per `tool_use_id`, including
  calls a hook later denied. It starts from zero when the mod starts, and continues from the
  session's stats file when the same session starts the mod again.
- **The status line is not redrawn on resize.** Claude Code runs it again on its next update;
  until then it shows its own cut (`…`) of the old line. The band is redrawn at once.
- **Terminals that draw `│` and `…` two cells wide** need `CTK_AMBIGUOUS_WIDTH=2`; CTK cannot
  detect that.
- **Both lines use Claude Code's own widths.** The band is terminal − 5 columns, the status line
  terminal − 4 (measured on 2.1.295); another Claude Code version may differ.

## Mission Control

- **It shows only what was observed.** Task detail needs `TaskCreate`/`TaskUpdate` calls, which Claude
  Code leaves out on current models unless `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`; per-worker figures need the
  worker's loop to run in this process (not a tmux or iTerm2 pane); "current task" is the in-progress task
  whose owner is the worker's name. Everything else reads *unavailable*. Details:
  [MISSION-CONTROL](MISSION-CONTROL.md#what-it-shows).
- **Keyboard entry takes two chords.** Opening the pane from the focused band does not give the pane the
  keys (Claude Code refuses focus while the band holds it). `/ctk-mission` opens it already focused.
- **An option change reloads the mod.** Claude Code reloads the module a moment after `$.config.set`, so
  per-worker detail and the task board start over (counters continue from the stats file). CTK refuses to
  apply a change while a teammate is starting, because a reload forgets spawns still in flight.
- **The HUD form button is session-only.** There is no way to save it from the pane: a saved choice would
  be a settings write, and CTK writes settings only through the confirmed option change.
- **Pane placement is Claude Code's.** Docked beside the transcript in the fullscreen layout, above the
  prompt otherwise; a pane opened by a person's own press or command is placed at any width.

## Cost, effort and routing

- **Per-worker token and cost figures are not available.** Claude Code reports session cost,
  context and rate-limit use, not per teammate. CTK shows session figures, labelled measured, and
  its own event counts, labelled counted. It never estimates a per-worker number.
- **Effort per role comes from the agent files and cannot be set from a profile.** The spawn
  hook can set a model but not an effort. `explorer`, `implementer` and `reviewer` are `medium`,
  `high-risk-reviewer` is `high`, as written in `plugins/ctk/agents/*.md`. A profile with
  `routing.<role>.effort` is rejected (Live: `error: routing.implementer.effort:
  routing.implementer: Unrecognized key: "effort"`). To change effort, edit or fork the agent
  files.
- **Model routing** applies only to `ctk:*` agents that give no model, and never overrides an
  explicit one. Tests cover the resolution. **Not verified live:** that the resolved model is
  the one each teammate actually runs on, in every team mode (in-process, tmux, iTerm2) and
  with `inherit`.

## Workflows not run end to end

- **`/ctk:team` on a real task** was run live in the recorded demos (`docs/DEMO.md`: Runs C, D and E):
  the lead cut slices, created dependent tasks, spawned up to three workers, and the cap held.
  What stayed unverified is whether the lead follows every step of the skill (verify command before
  closing a task, shutdown requests); the skill only instructs, and a recorded run showed tasks
  marked done before the lead verified them.
- **`/ctk:review` and `/ctk:debug`** have been validated as plugin components (frontmatter,
  size, description budget), not exercised on real changes.
- **`isolation: worktree` and the cap exclude each other.** Observed live on 2.1.295: a named agent that passes
  `isolation` is not a teammate, so the cap neither counts nor refuses it. The team skill never sets `isolation`;
  overlapping file scopes are handled by ordering the slices (`addBlockedBy`) or narrowing them. A user who asks for
  worktree workers gets workers CTK does not limit, and Mission Control shows how many started outside the cap.
  Whether a later Claude Code changes which calls are teammates is not something CTK can know in advance.
- **Model routing in recordings:** the lead and the implementers were both Sonnet in the recorded
  runs, so routing to different models was not shown live.
- **The band** is verified by rendering tests (80-column truncation, missing figures as `–`),
  not by watching a live multi-worker session.

## Platforms

| Platform | Status |
|---|---|
| macOS | Live: install, rollback, uninstall, doctor, a same-version `update`, the mod in `claude -p`, npm tarball install. |
| Linux | Automated test and plugin jobs passed in CI ([run](https://github.com/tc3oliver/claude-team-kit/actions/runs/37829085745), ubuntu-latest, Node 22 and 24, plus plugin validate and plugin test). Interactive behaviour not verified. |
| Windows native | Automated test and plugin jobs passed in CI ([run](https://github.com/tc3oliver/claude-team-kit/actions/runs/37829085745), windows-latest, Node 22 and 24, plus plugin validate and plugin test). The first Windows runs failed and found real bugs, since fixed (see [REVIEW](REVIEW.md#5a-found-by-ci-on-windows)). A real `ctk install`, the mod and `/ctk:team` were not run interactively; the `.cmd`/`.exe` handling and the Git Bash status line command are covered only by CI's unit tests. |
| Windows Terminal, VS Code terminal | Not verified. |
| WSL | Not tested. Mods are reported unsupported there; the status line script is the fallback. |
| CI (`.github/workflows`) | The latest run passed all 10 jobs ([run](https://github.com/tc3oliver/claude-team-kit/actions/runs/37829085745), 2026-10-09): tests on ubuntu, macos and windows with Node 22 and 24, plugin validate `--strict` and plugin test on the three systems, and the pack audit. Earlier runs after the move to `plugins/ctk` passed too. They used GitHub-hosted runners only, and Claude Code came from npm `latest` at the time. |

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
- **With the CLI's local-directory install, the directory must stay in place.** The marketplace
  `ctk-kit` points at it, and the plugin stops loading if it is moved or deleted (Live). A native
  install from GitHub has no such directory. Fix a move by running `ctk install`
  (or `ctk update`) from the new location; CTK re-points a marketplace it added in one
  transaction (Live). Claude Code removes the plugin and its options along with the
  marketplace, so CTK reinstalls it, and a plugin you had disabled comes back enabled. A
  marketplace registered by another tool is not moved: CTK exits `2` and prints the manual
  command (Live).
- **`uninstall` removes the plugin only if `ctk install` installed it** and the marketplace only if
  `ctk install` added it; a native install is left in place with the command to remove it
  (Live). It deletes `stats/` and `profile.json` (the latter is in the uninstall backup,
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
  recognise; see [THREAT-MODEL](THREAT-MODEL.md#known-limitations).
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
