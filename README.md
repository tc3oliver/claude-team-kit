<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
    <img src="docs/assets/logo-light.svg" alt="Claude Team Kit: Native agent teams. Under control." width="520">
  </picture>
</p>

<p align="center"><b>Hard worker limits, live team visibility, and portable configuration for Claude Code.</b></p>

<p align="center">
  <a href="https://github.com/tc3oliver/claude-team-kit/actions/workflows/ci.yml"><img src="https://github.com/tc3oliver/claude-team-kit/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/stats-dark.svg">
    <img src="docs/assets/stats-light.svg" alt="Default worker cap 3; about 187 always-on plugin tokens (fixed context only); 0 extra LLM calls from the HUD" width="720">
  </picture>
</p>

Claude Team Kit (CTK) is a Claude Code plugin for the built-in Agent Teams. It caps how many teammates run at once, puts each role on a suitable model, and shows the team in one line above your prompt. The lead and the teammates stay Claude Code's own: CTK does not add a second orchestrator.

<p align="center">
  <img src="docs/assets/team-demo-d.svg" alt="Recording of a live /ctk:team session: the lead checks the cap, creates six tasks, starts three workers for five modules, and the team line counts tasks from 0/6 to 6/6" width="900">
</p>

<p align="center"><sub>One live session, installed through the Plugin Manager. A Sonnet lead checks the cap, creates six tasks (the final test run blocked by the module tasks), starts three workers for five modules and hands the last two to whoever finishes first. The <code>tasks</code> count above the prompt goes from 0/6 to 6/6, matching the lead's report: 43 tests, 0 failures, $0.94, 117 s played back in 40 s. This recording predates the current line format (the first band showed team figures only). Recording notes, including what went less smoothly: <a href="docs/DEMO.md#run-d-the-same-recipe-after-the-plugin-fixes">docs/DEMO.md</a> (also as <a href="docs/assets/team-demo-d.gif">GIF</a> and <a href="docs/assets/team-demo-d.mp4">MP4</a>).</sub></p>

## Install

In Claude Code:

```
/plugin marketplace add tc3oliver/claude-team-kit
/plugin install ctk@ctk-kit
```

Then `/reload-plugins` (or restart). Needs Claude Code 2.1.287 or newer for the cap and the team line. Claude Code may print `7 userConfig options not yet set`: that is harmless, every option has a default.

**One setting a plugin cannot make for you.** Agent Teams are experimental and off by default. Add this to `~/.claude/settings.json` and restart:

```json
{ "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" } }
```

Not sure? Run `/ctk-doctor`. It changes nothing and prints the exact fix for anything missing. On Claude 5.x models, also add `"CLAUDE_CODE_ENABLE_TODO_TOOLS": "1"` to the same `env` if you want the shared task list shown in the demo; without it the lead coordinates by messages. Details: [Installation](docs/INSTALLATION.md#one-time-setup-agent-teams).

## Your first team

```
/ctk:team <goal>
```

The demo ran this prompt on the small fixture in [`scripts/demo/fixture`](scripts/demo/fixture/README.md) (five text modules, no tests):

```
/ctk:team Add one node:test file per module in src/, named test/<module>.test.js, one worker per module. Then run npm test and report the results.
```

Before spawning anything, `/ctk:team` checks that teams are on and reads the cap; if the flag is missing it spawns nothing and offers the settings edit, which you approve. It then splits the goal into independent tasks, starts workers up to the cap, and runs their verify commands itself before reporting. `/ctk-stats` shows what the session counted.

## Why Claude Team Kit?

- **A hard worker limit.** Claude Code's docs say there is "no hard limit on the number of teammates". CTK enforces one: default 3, settable from 1 to 12. A spawn above it is refused with `TEAM_CAPACITY_REACHED` and its task stays pending; if CTK cannot count the team, it refuses rather than guesses.
- **Live team visibility.** One line above the prompt: model, 5-hour and weekly usage with reset countdowns, tool calls, agents against the cap, tasks, context and cost, fitted to your terminal (full, abbreviated or essentials only; whole figures are dropped, never cut in half). It reads only what Claude Code hands it: no network calls, no credential reads, no model calls.
- **Models by role.** Explorers on Haiku, implementers and reviewers on Sonnet, the high-risk reviewer on Opus.
- **Three skills, small footprint.** `/ctk:team`, `/ctk:review` (scaled to risk) and `/ctk:debug`. About 187 tokens load on every turn; a skill's body loads only when you use it (`/ctk:team` about 850).
- **Honest numbers.** `/ctk-stats` labels each figure as counted by CTK or measured by Claude Code. Claude Code does not report per-worker cost, so CTK shows none.

<p align="center">
  <img src="docs/assets/hud-widths.svg" alt="The CTK HUD in real captures at 200, 130, 100, 80 and 60 terminal columns, alone above the prompt and split with the optional status line" width="760">
</p>

<p align="center"><sub>The HUD at five terminal widths, copied from live captures (Claude Code 2.1.295; usage figures are the maintainer's account at that moment). Wide terminals get full wording, narrower ones abbreviations, and the narrowest only the three figures that matter most. Details: <a href="docs/ARCHITECTURE.md#layout">layout</a>.</sub></p>

## Hard limit and team line

<p align="center">
  <img src="docs/assets/team-demo-d-tasks.svg" alt="Three workers live at the cap; the lead keeps two tasks pending; the task list shows the final run blocked by tasks 4 and 5; the team line reads team 3 busy, cap 3, tasks 3/6" width="49%">
  <img src="docs/assets/team-demo-refusal.svg" alt="A spawn refused live with TEAM_CAPACITY_REACHED: live=3 starting=0 max=3; the team line shows rejected 1" width="49%">
</p>

<p align="center"><sub><b>Left (the demo):</b> at the cap, the lead keeps tasks #4 and #5 pending instead of spawning; the final run is <code>blocked by #4, #5</code>; the team line reads <code>team 3 busy · … / cap 3 · tasks 3/6</code>. No spawn was refused in this run. <b>Right (an earlier attempt, not the published demo, stopped for an unrelated <code>PATH</code> problem):</b> the only recorded live refusal. Claude Code's own agent list showed the refused spawns as "Done"; the lead read the refusal and reused idle workers through <code>SendMessage</code> (<a href="docs/DEMO.md#attempt-1-the-cap-refusing-live-not-the-published-run">notes</a>).</sub></p>

## Model routing and portable configuration

Change the cap, the model per role, the team line and stats recording with `/plugin configure ctk@ctk-kit` ([options](docs/INSTALLATION.md#options)). An explicit model in a spawn is never overridden.

**Advanced: the optional `ctk` CLI.** For a status line, profiles synced between machines through a git repository you own (whitelisted keys, a secrets scan before every publish, three-way merge), and an install ledger with `ctk rollback` and `ctk uninstall`. It is built from a checkout (`git clone`, `npm ci`, `npm run build`, then `npm run ctk -- install`): see [the optional CLI](docs/INSTALLATION.md#the-optional-ctk-cli) and [Configuration](docs/CONFIGURATION.md).

## Status

Public preview (v0.1.0): not on npm or in an official plugin directory. Agent Teams are experimental and Mods, which carry the cap and the team line, are early access; where Mods are missing (older builds, reportedly WSL) `/ctk:team` says the cap and team line are off, and `/ctk-doctor` is not available. Used interactively on macOS; Windows and Linux are covered by [CI](https://github.com/tc3oliver/claude-team-kit/actions/workflows/ci.yml) only.

## Learn more

[Installation](docs/INSTALLATION.md) · [Limitations](docs/LIMITATIONS.md) · [Demo notes](docs/DEMO.md) · [Configuration](docs/CONFIGURATION.md) · [Architecture](docs/ARCHITECTURE.md) · [Comparison with OMC, superpowers and claude-hud](docs/COMPARISON.md) (fixed context only: about 94% and 91% less than OMC 5.3.0, as measured by the maintainers) · [Coming from OMC](docs/MIGRATION-FROM-OMC.md) · [Threat model](docs/THREAT-MODEL.md) · [Verification record](docs/REVIEW.md) · [Rollback](docs/ROLLBACK.md)

---

[Contributing](CONTRIBUTING.md) · [Code of Conduct](CODE_OF_CONDUCT.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md) · MIT [License](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
