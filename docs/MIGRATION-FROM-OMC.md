# Migrating from oh-my-claudecode (OMC)

CTK is a much smaller tool than OMC. It does not replace all of it, and it does not try to.
This page says what maps to what, what has no CTK equivalent, how the two behave together,
and how to turn OMC off yourself when you are ready.

**CTK never modifies, disables or removes OMC.** Nothing in CTK's code refers to OMC, and
`ctk install`, `ctk update`, `ctk rollback` and `ctk uninstall` only touch the keys and files
listed in [INSTALLATION](INSTALLATION.md#what-install-changes). Turning OMC off is a step you
take with Claude Code's own commands (below).

What I checked and what I did not is at the end. OMC facts come from reading OMC 5.3.0's
plugin files (skills, hooks, docs) in a local plugin cache, not from running OMC tasks.

## Running both at once

They coexist. In one scratch config directory, with both installed:

```
$ claude plugin list
  ❯ ctk@ctk-kit
    Version: 0.1.0
    Scope: user
    Status: ✔ enabled

  ❯ oh-my-claudecode@omc
    Version: 5.3.0
    Scope: user
    Status: ✔ enabled
```

and `claude -p "/ctk-stats"` still printed the CTK summary, so the mod loads next to OMC.
Things to know:

| Topic | What happens |
|---|---|
| Skill names | Both define `team`, `review`, `debug`. Use the full names: `/ctk:team`, `/oh-my-claudecode:team`. I did not test how Claude Code resolves a bare `/team` when two plugins define it. |
| `statusLine` | OMC's HUD is a `statusLine` command. CTK sets `statusLine` only when the key is absent, so it keeps OMC's and prints `note: statusLine: your own status line is kept; the HUD runs via the mod band only`. You then get CTK's team band (from the mod) but not CTK's status line script. |
| Agent Teams flag | Both use `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`. If it is already `"1"`, CTK records it as not its own and never removes it. |
| Team cap | **CTK's cap is not limited to CTK's agents.** The mod gates every teammate spawn in the session (a spawn that Claude Code marks as starting a teammate), whoever asked for it. With CTK enabled, an OMC `/team 5:executor` is held to `team.maxWorkers` (default 3): the extra spawns are refused with `TEAM_CAPACITY_REACHED`. This is from the code and Claude Code's type definitions; I did not run an OMC team against the cap. OMC's skill does not know that code, and a refused spawn can still show as "Done" in the transcript. Raise the cap (`ctk config set team.maxWorkers 8`) or disable CTK while you run OMC teams. |
| Model routing | CTK changes the model only for `ctk:*` agents that give no model. OMC's agents are not routed. |
| Always-on context | `claude plugin details` estimates the cost added to every session: OMC about 2,093 tokens, CTK about 187. That excludes the instructions OMC's setup may have written into your `CLAUDE.md`. |
| Uninstalling CTK | `ctk uninstall` leaves OMC alone. With OMC installed (and disabled) in the same directory, its plugin entry, marketplace and disabled state were unchanged afterwards. |

## What maps to what

| OMC | CTK | Differences that matter |
|---|---|---|
| `/oh-my-claudecode:team N:agent-type "task"` | `/ctk:team <goal>` | OMC runs a staged pipeline (`team-plan`, `team-prd`, `team-exec`, `team-verify`, `team-fix`, looping), picks specialist agents per stage, accepts up to 20 workers, and can start Codex, Gemini or Antigravity CLI workers. CTK has no fixed pipeline: the lead agent decides whether a team is warranted at all (default is one agent), cuts independent vertical slices, creates native tasks with real dependencies, and spawns at most `team.maxWorkers` (default 3, maximum 12) as `ctk:implementer` or `ctk:explorer`. Workers get context pointers, not pasted text. A spawn counts only if the result carries a teammate id. No non-Claude workers, no `ralph` mode. |
| `/oh-my-claudecode:review` | `/ctk:review [spec]` | Both are advisory and ask for `file:line` and a concrete failing case. CTK picks the depth from the diff: low risk is a self-review checklist, medium spawns `ctk:reviewer`, high (auth, money, migration, concurrency, public API, security) spawns `ctk:high-risk-reviewer` on Opus. There is no separate security-review or simplification lane. |
| `/oh-my-claudecode:debug` | `/ctk:debug <symptom>` is **not the same thing** | OMC's `debug` diagnoses the current OMC or Claude Code *session* (logs, traces, state). CTK's `debug` is a method for a bug in your code: reproduce, minimize, hypotheses with one probe each, fix, regression test, and stop to ask after three refuted hypotheses. For session diagnosis, the CTK counterparts are `ctk doctor` and `/ctk-stats`. |
| `/oh-my-claudecode:hud`, the OMC HUD | team band (mod) and the status line script | The band is one line above the prompt: `team 1 busy · 2 idle · 1 done / cap 3 · tasks 2/5 · rejected 1 · models haiku×1 sonnet×2 · $0.42 · 12m`. The status line script prints `Model effort · ctx 42% · 5h 24% · 7d 61% · $1.23 · 12m · branch*` and shows no worker data. Turn them off with `ctk config set hud.band false` and `ctk config set hud.statusLine off`. |
| OMC agents such as `executor`, `explore`, `code-reviewer` | `ctk:implementer`, `ctk:explorer`, `ctk:reviewer`, `ctk:high-risk-reviewer` | Four agents, each with a fixed model and effort in its frontmatter (`haiku/medium`, `sonnet/medium`, `sonnet/medium`, `opus/high`). The model can be changed per role in the profile; the effort cannot. |
| `omc-doctor` | `ctk doctor` | CTK checks only itself. |
| Cost and usage in the OMC HUD | `ctk stats`, `/ctk-stats`, the band | Figures are labelled counted (events CTK saw) or measured (Claude Code reported). Per-worker cost is not shown because Claude Code does not report it. |

## What has no CTK equivalent

CTK is meant to stay small: always-on context under 500 tokens, one narrow mod, no
persistent state beyond `<config>/ctk`. These OMC features are out of scope. If you rely on
them, keep OMC for those or use Claude Code's own features.

- Persistence and autonomy loops: `autopilot`, `ralph`, `ultragoal`, `autoresearch`,
  `self-improve`.
- Planning and requirements workflows: `plan`, `ralplan`, `deep-interview`, `execute`,
  `verify`, `launch`, `ask-navigator`. CTK's `team` skill plans slices itself and `review`
  checks the result; there is no separate spec or PRD stage.
- Tracing and session diagnosis: `trace`, OMC's `debug`.
- Memory and knowledge: `wiki`, `remember`, notepad, project memory, session search.
- Keyword triggers and prompt hooks (the `UserPromptSubmit` hooks that route prompts to
  skills). CTK has no prompt hooks; its skills run when you invoke them.
- OMC's MCP tools (LSP, AST search, Python REPL, state).
- Non-Claude workers (Codex, Gemini, Antigravity CLIs), `omc ask`, notifications, release
  helpers, worktree session manager.
- The other OMC specialist agents (architect, planner, critic, analyst, verifier, ...).

CTK-only: the hard cap with explicit `TEAM_CAPACITY_REACHED` refusals, model routing by role,
`ctk sync` for a portable profile through a git repo you own, and the ledger with
`ctk rollback`. I did not check which of these OMC offers in some other form.

## Turn OMC off yourself

Do these deliberately, in this order of how reversible they are. CTK does none of them.

1. **Per session, without changing anything on disk.** OMC documents `DISABLE_OMC=1` as the
   switch that disables all OMC hooks, and `OMC_SKIP_HOOKS=<comma-separated names>` for
   individual ones:

   ```sh
   DISABLE_OMC=1 claude
   ```

   I did not test this. It disables hooks, not the skills or the always-on skill list.

2. **Disable the plugin.** Verified in a scratch directory:

   ```
   $ claude plugin disable oh-my-claudecode@omc --scope user
   ✔ Successfully disabled plugin: oh-my-claudecode (scope: user)
   ```

   `claude plugin list` then shows `Status: ✘ disabled`, and `settings.json` has
   `"enabledPlugins": { "oh-my-claudecode@omc": false }`. Undo with
   `claude plugin enable oh-my-claudecode@omc --scope user`. Check the scope in
   `claude plugin list`: a project or local scope can enable it separately.

3. **Remove what OMC put outside the plugin.** Disabling the plugin does not undo OMC's
   setup. According to OMC's own skills, setup can write OMC instructions into
   `~/.claude/CLAUDE.md` (or `CLAUDE-omc.md`), and the HUD setup copies a script to
   `~/.claude/hud/omc-hud.mjs` and sets `statusLine` to it. Review those yourself, using OMC's
   own documentation, and keep a copy of anything you remove. Per-project `.omc/` directories
   are also OMC's.

4. **Hand the status line to CTK, if you want it.** Remove the OMC `statusLine` key from
   `settings.json` yourself, then run `ctk update`. In a scratch directory, with the key removed,
   `ctk update` wrote CTK's `statusLine` and `ctk doctor` reported `statusline: CTK status line
   active`. Skip this to keep any other status line; the mod band does not depend on it.

5. **Last: uninstall OMC** with `claude plugin uninstall oh-my-claudecode@omc`, only after you
   are sure. I did not test that command.

## Checklist before switching

1. **Inventory what you use.** For a week, note which OMC skills you actually invoke. Compare
   with the two lists above. Anything in "no CTK equivalent" that you use is a reason to keep
   OMC, or to stay on both.
2. **Snapshot your setup yourself.** Copy `settings.json` and `CLAUDE.md` from your config
   directory. CTK backs up only what it changes.
3. **Dry run.** `ctk install --dry-run`. Read the `conflict:` and `note:` lines, especially
   the `statusLine` note.
4. **Install CTK next to OMC.** `ctk install`, restart Claude Code, then `ctk doctor` and
   `claude -p "/ctk-stats"` ([Verify](INSTALLATION.md#verify)).
5. **Decide the cap.** If you still run OMC teams, raise `team.maxWorkers` or expect refusals
   (see the table above).
6. **Compare on a real task in a throwaway repository.** Measure, do not guess:
   - always-on cost: `claude plugin details ctk@ctk-kit` and
     `claude plugin details oh-my-claudecode@omc`;
   - session cost and rate-limit use: `/ctk-stats` (measured figures) against what your OMC HUD
     shows;
   - wall time, review findings that survive verification, and whether the team stayed under
     the cap.
   I have not run `/ctk:team` on a full real task with live agents, so the comparison of
   quality and cost on real work is yours to make.
7. **Trial with OMC disabled** (step 2 above) before removing anything.
8. **Only then** clean up the leftovers (step 3) and decide about the status line (step 4).

## What I verified and what I did not

Verified here, on Claude Code 2.1.294 in scratch config directories: both plugins installed and
enabled together; the CTK mod loading beside OMC; `ctk install` keeping a pre-existing
`statusLine`; `claude plugin disable` on OMC; `ctk update` taking over the status line once the
key was removed; `ctk uninstall` leaving OMC untouched; the token estimates quoted above.

Not verified: any OMC workflow actually running (team, review, debug, HUD) with or without
CTK; the cap acting on OMC's teammates; `DISABLE_OMC=1`; how a bare `/team` resolves with two
plugins; what OMC's setup writes on your machine beyond what its skill files describe; OMC
uninstall. I ran OMC's `statusLine` case with a placeholder command, not OMC's real HUD.
