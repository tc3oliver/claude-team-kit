# The team demo: one real session

[`assets/team-demo.svg`](assets/team-demo.svg) (animated), [`team-demo.gif`](assets/team-demo.gif) and
[`team-demo.mp4`](assets/team-demo.mp4) show one live `/ctk:team` session on a small fixture project.
Nothing in them is staged: they are rendered from [`team-demo.frames.jsonl`](assets/team-demo.frames.jsonl),
a frame-by-frame capture of the real terminal. Four still frames come from the same file:
[workers running](assets/team-demo-workers.svg), [a permission prompt](assets/team-demo-approval.svg),
[the lead's report](assets/team-demo-summary.svg) and [`/ctk-stats`](assets/team-demo-stats.svg).

## What was run

| | |
|---|---|
| Prompt, typed at 30 ms per character | `/ctk:team Add one node:test file per module in src/, named test/<module>.test.js, one worker per module. Then run npm test and report the results.` |
| Project | `wordkit`, the fixture in `scripts/demo/fixture`: five small, independent text modules in `src/` (`caesar`, `rle`, `roman`, `slugify`, `wordcount`), no tests, one git commit |
| Lead | `claude --model sonnet`, which is Sonnet 5.5 |
| Workers | chosen by CTK's roles; the status line reported `claude-sonnet-5-5` ×3 (`implementer` runs on Sonnet by default) |
| Claude Code | 2.1.294 on macOS, agent teams enabled by `ctk install` |
| CTK | 0.1.0, commit `88e658f` plus uncommitted changes (the frames file says `-dirty`), default settings, cap of 3 workers |
| Config | a dedicated Claude Code config dir with CTK installed, separate from any personal one |
| Permissions | `acceptEdits` mode and allow rules for `Read`, `Write`, `Edit`, `Bash(npm test:*)`, `Bash(node --test:*)`, `Bash(ls:*)`, `Bash(cat:*)` |
| Session environment | a clean environment (`env -i`), a throwaway `HOME`, short paths under `/tmp/ctk-demo`, terminal 120 by 34 |

The recorder was told to watch and not to intervene, with two exceptions: it presses Enter on a
permission prompt (and lists each press in the metadata line), and it kills the session if more than
three workers are busy or the status line shows a cost of $10 or more (the recipe has since been tightened to $2; Runs A and B and attempt 1 all stayed under $1). Neither guard triggered.

## What the recording shows

The session lasted 75 s of wall clock. The animated versions play it at about 1.8 times real speed,
with idle gaps capped at 2 s, so the playback is about 40 s.

- **Plan.** After the prompt the lead says there are five modules and the default cap is 3, so it will
  start three workers and hand the other two modules to whichever worker finishes first.
- **Spawns.** Three workers (`w-caesar`, `w-rle`, `w-roman`, all `ctk:implementer`) start within about
  three seconds, at 16 s to 18 s. The status line goes from `team 0 busy` to `team 3 busy · 0 idle · 0 done / cap 3`.
- **Counts.** `/ctk-stats` at the end reports `teammate spawns: 3 accepted, 0 refused at capacity, 0 failed
  closed` and `peak live teammates: 3 (cap 3); now 0`. **The cap was reached but never exceeded, and no spawn was
  refused in this recording.** The status line never showed a `rejected` counter.
- **Hand-over.** The other two modules were not given new workers. As `w-caesar` and `w-roman` finished,
  the lead gave `slugify` to `w-caesar` and `wordcount` to `w-roman`. The final report says
  "w-caesar did caesar and slugify, w-roman did roman and wordcount, and w-rle did rle".
- **Task states.** The status line shows teammates as busy or idle; its `done` count stayed 0 for the whole
  run, and `/ctk-stats` printed `tasks created/completed: – (no task event seen)`. The lead coordinated the
  workers by messages, so this recording does not show task states changing. A probe in the same setup (a Haiku
  session, interactive and `-p`, asked to list tools with `Task`, `Team` or `SendMessage` in the name) found only
  `TaskStop`, `SendMessage` and `mcp__ctk__ctk_team_status`: no `TaskCreate`, `TaskUpdate` or `TaskList`.
- **Permission prompt.** One worker (`w-roman`) asked to run a shell command that the allow rules did not
  cover (`node --test …; node -e "…"`). The recorder pressed Enter twice, at 41.2 s and 43.2 s (the first press
  did not clear the prompt in the sampled screen, so the second is probably redundant); the choice was "1. Yes",
  once. This is recorded as `permissionApprovals` in the metadata line.
- **Result.** The lead ran `npm test` itself and reported: caesar 10, rle 11 (10 pass, 1 todo), roman 8,
  slugify 8, wordcount 7. Running `npm test` on the resulting project afterwards gave the same totals: 44 tests,
  43 pass, 0 fail, 1 todo. Nothing was committed; `test/` was left untracked.
- **What the workers found.** The tests turned up four things in `src/`, none of which was fixed: `rle.encode`
  does not escape digits (`decode(encode('1'))` returns `'11'`); `roman.fromRoman` accepts `'IIII'` and `'IC'`;
  `wordcount` counts `'hi'` and `hi` as different words; the diacritic regex in `slugify` holds literal combining
  characters. The `rle` worker wrote a test for its bug and marked it `todo`, so the suite stays green while the
  bug is still there. The lead said so in its report and left the decision to the reader.
- **Cost.** `/ctk-stats` and the status line both showed `$0.64` for the whole session, context 5 %. The
  per-worker split is not available from Claude Code, and CTK does not claim one.

## Oddities and honesty notes

- **Two attempts.** Attempt 1 is not the published run; see the next section. The second attempt is the one
  shown, unedited.
- **Input box suggestions.** The grey text in the input box (`fix the rle digit bug`, `/ctk:review`, `run npm test`)
  is Claude Code's own prompt suggestion. The recorder typed only the three inputs listed above, plus `/exit`.
- **Masks.** Account name, email, organisation id, login name and plan name were replaced at capture time
  (68 replacements); the metadata line lists these categories, not the strings. The recorder's cost guard in `team-demo.sh` stops a session at `$2.00` or more, or when more than three teammates are busy. The plan name appears as `Claude plan`.
- **Frames.** The frames file keeps only screens that changed. Playback caps idle gaps (and the GIF and MP4 merge
  frames closer than 100 ms); no frame is invented or edited.
- **After the result.** The recorder waited 3 s after the lead's report (once the status line had shown no busy
  teammates for 12 s), typed `/ctk-stats`, waited 3 s, and typed `/exit`. The last held frame is the
  "Resume this session" line Claude Code prints on exit.

## Attempt 1: the cap refusing live (not the published run)

Attempt 1 was stopped early by the operator for an environment reason (`npm` missing from the recorded
`PATH`), so it was not published as the demo. It is kept because it shows what the published run does not:
the cap refusing a spawn in a live session. Its frames are in
[`team-demo-attempt1.frames.jsonl`](assets/team-demo-attempt1.frames.jsonl) (masked the same way; only the
metadata line was extended to say it is not the published run), and
[`team-demo-refusal.svg`](assets/team-demo-refusal.svg) is the frame where the refusal is on screen.

- The lead started `w-caesar`, `w-rle` and `w-roman`, said "slugify and wordcount are waiting for a free slot",
  and when two workers had finished said "Two slots are free, so I'm starting the last two workers."
- Both new spawns were refused. The text on screen was: `Subagent spawn denied by a plugin: TEAM_CAPACITY_REACHED:
  live=3 starting=0 max=3. Do not treat this worker as started; leave its task pending; reuse an idle teammate via
  SendMessage or wait for one to finish.` The status line went to `rejected 1`, then `rejected 2`.
- The refusal came from the cap counting idle teammates as live: `w-caesar` and `w-rle` had finished and were
  idle, but still occupied two of the three slots. Claude Code's own list afterwards showed the two refused
  spawns as "2 ctk:implementer agents finished … 0 tool uses … Done", which reads as success; the lead did not
  take it that way and said "Both spawns were refused because idle workers still count toward the cap."
- The lead recovered as the message advised: it gave slugify to `w-caesar` and wordcount to `w-rle` through
  `SendMessage`, then waited for all three reports.
- At 57 s the lead tried `npm test`, found that `npm` was not on the session's `PATH`, and ran `node --test`
  instead. That is the environment fault that led to the second attempt. The lead's final report came at about
  80 s: 51 tests, 47 passing, 4 failing (the workers had left failing tests for the `rle`, `wordcount` and `roman`
  bugs instead of marking them `todo`), and it asked whether to fix the bugs or relax the tests. The recorder was
  stopped at that point, so attempt 1 had in practice run to its end.
- Cost: `$0.73` on the status line, 3 workers on `claude-sonnet-5-5`, no permission prompt approved by hand
  (one was auto-approved, as in the published run).

The two attempts therefore differ in more than the cap: the same prompt gave 44 tests with one `todo` in one run
and 51 tests with four failing in the other. The model's choices vary from run to run.

## Run B: the same session with the task list enabled

Run A had no task events because Claude Code leaves the task tools out on Sonnet 5.5 by default. Run B is a
new, separately authorised run (not a retry) that turns them on through CTK's own opt-in, then repeats Run A.
Files: [`team-demo-b.svg`](assets/team-demo-b.svg), [`team-demo-b.gif`](assets/team-demo-b.gif),
[`team-demo-b.mp4`](assets/team-demo-b.mp4), [`team-demo-b.frames.jsonl`](assets/team-demo-b.frames.jsonl) and
the stills [workers](assets/team-demo-b-workers.svg), [permission prompt](assets/team-demo-b-approval.svg),
[lead's report](assets/team-demo-b-summary.svg) and [`/ctk-stats`](assets/team-demo-b-stats.svg).

**Setup.** `ctk config set claude.enableTaskTools true` on the dedicated config dir; `ctk doctor` then reported
`task-tools: Task tools are on (CLAUDE_CODE_ENABLE_TODO_TOOLS is set)` and `settings.json` contained
`CLAUDE_CODE_ENABLE_TODO_TOOLS=1` next to the agent teams flag. Everything else is as in Run A: a fresh copy of the
fixture, the same typed prompt, `claude --model sonnet`, the same masks and allow rules, and the same limits
(10 minutes, kill above 8 teammates). Two differences: `npm` is on the session's `PATH` this time, and the
recording was made from a clean tree, commit `ee0a69c` (the metadata line has no `-dirty`). The plugin sources
were still at `plugin/ctk` then; the directory was renamed to `plugins/ctk` in a later commit, after the recording.
One attempt, so no attempt was discarded.

**What the frames show.**

- **Task tools: enabled, but not used.** The lead did not use the task tools even though they were enabled. No `TaskCreate`, `TaskUpdate` or `blockedBy` appears anywhere on screen. The status line
  never showed a tasks segment, and `/ctk-stats` printed `tasks created/completed: – (no task event seen)`, as in Run A.
  The lead's text mentions only "five independent module slices with no dependencies between them" and "queue
  slugify and wordcount"; the word "task" does not otherwise come up in its messages.
- **Were the tools available?** A probe run after the recording, with the same config (Sonnet, `-p`, asked to list
  tools named `Task…` or `SendMessage`), returned `TaskCreate`, `TaskGet`, `TaskList`, `TaskStop`, `TaskUpdate` and
  `SendMessage`. So with the opt-in on, the tools exist for a Sonnet session. The probe ran after the plugin
  directory had been moved in the working tree, and it no longer listed `mcp__ctk__ctk_team_status`, so the
  plugin may not have loaded in the probe; treat it as indicative, not as proof about the recorded session.
- **Against the skill text.** The `team` skill at that commit says: if `TaskCreate` is in the tool list, create one
  task per slice and add real dependencies with `addBlockedBy`; otherwise say so in one line and keep a numbered
  list. The recording shows the lead doing neither visibly: no task creation, and no one-line statement about the
  task list. This contradicts the skill text as written.
- **Workers and cap.** Three workers started at 16 s to 18 s (`w-caesar`, `w-rle`, `w-roman`, all `ctk:implementer`
  on `claude-sonnet-5-5`); the status line peaked at `team 3 busy`. The lead did not try to start a fourth: it gave
  `slugify` to `w-caesar` and `wordcount` to `w-roman` through messages as they finished. `/ctk-stats`:
  `teammate spawns: 3 accepted, 0 refused at capacity, 0 failed closed`, `peak live teammates: 3 (cap 3); now 0`.
  **No refusal occurred in Run B**, so there is no refusal frame; the only live refusal is in attempt 1 above.
- **Permission prompt.** One worker asked to run `node --test test/rle.test.js …; node -e "…"`, not covered by the
  allow rules; the recorder pressed Enter once, at 42.2 s ("1. Yes", once). It is in the metadata.
- **Results.** The lead ran the full suite itself and reported "npm test ran 49 tests: 48 pass and 0 fail", the 49th
  being the `rle` digit round-trip test marked `todo`. Per file: caesar 9, rle 10 (9 pass, 1 todo), roman 10,
  slugify 9, wordcount 11. Running `npm test` on the result afterwards gave the same: 49 tests, 48 pass, 0 fail, 1 todo.
  The lead also listed things the tests left unasserted (`fromRoman` accepting `IIII` and `IC` and giving `NaN`
  for other input, apostrophes counted as word characters in `wordcount`, Japanese text slugifying to an empty
  string) and shut the workers down. Nothing was committed.
- **Cost and time.** 89 s of wall clock; `$0.78` on the status line and in `/ctk-stats`, context 5 %.
- **Oddities.** The input box shows Claude Code's own prompt suggestions (`spawn the remaining two workers`,
  `/ctk:review`), not recorder input. The `done` count in the status line stayed 0 again.
- **Post-capture mask.** The banner of this run carried an account promotion line ("guest passes", on 60 frames).
  It was not in the mask list at capture time, so it was removed afterwards with `scripts/demo/mask-frames.mjs`: the
  line is blank in every frame, and the metadata line says `maskedAfterCapture: ["promotional banner line"]`.
  Frame count, timing and every other line are unchanged, and the SVG, GIF and MP4 were rendered again from the
  masked frames. The line does not appear in Run A or in attempt 1, so those files were not touched.

**Reading.** Enabling the task tools through the opt-in works at the configuration level (the doctor check, the
environment variable and the probe agree), but in this run it did not change what the lead did: it coordinated
with messages and worker reuse exactly as in Run A. One run says nothing about how often a lead would use the task
list; it does show that turning the tools on is not enough to make a Sonnet lead follow the skill's task-list step.

## Run C: native install, no CLI, and the strengthened team skill

Run C is a third, separately authorised run. It exercises exactly the path the README teaches: the plugin installed
with Claude Code's own commands and no `ctk` CLI anywhere near the demo config, plus the team skill as of commit
`0aaa9a0`, which creates the task list before spawning anyone. Files: [`team-demo-c.svg`](assets/team-demo-c.svg),
[`team-demo-c.gif`](assets/team-demo-c.gif), [`team-demo-c.mp4`](assets/team-demo-c.mp4),
[`team-demo-c.frames.jsonl`](assets/team-demo-c.frames.jsonl) and the stills
[task list and HUD](assets/team-demo-c-tasks.svg), [workers](assets/team-demo-c-workers.svg),
[the lead's report](assets/team-demo-c-summary.svg), [`/ctk-stats`](assets/team-demo-c-stats.svg) and
[`/ctk-doctor`](assets/team-demo-c-doctor.svg).

**Setup.** The demo config was reset first: `claude plugin uninstall ctk@ctk-kit`, `claude plugin marketplace
remove ctk-kit`, the CLI's leftover `ctk` directory deleted and its `statusLine` removed from `settings.json`
(login kept). Then the native flow:

```sh
claude plugin marketplace add tc3oliver/claude-team-kit
claude plugin install ctk@ctk-kit
```

The install printed `7 userConfig options not yet set — run /plugin configure ctk@ctk-kit in Claude Code, or pass
--config KEY=VALUE.` The defaults applied anyway (the cap showed as 3 and the band as on). The installed copy was
checked against the checkout: the plugin cache recorded commit `0aaa9a0`, and `skills/team/SKILL.md` was identical
to `plugins/ctk/skills/team/SKILL.md` (the cache lacks only development files such as `tsconfig.json`). The two
one-time settings went into `settings.json` as a plain JSON edit, next to the allow rules from the other runs:

```json
{ "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1", "CLAUDE_CODE_ENABLE_TODO_TOOLS": "1" } }
```

Readiness check, `claude -p "/ctk-doctor"` before the recording (no model call):

```text
ctk: CTK readiness (read-only; nothing is changed):
[ok]     mod: active (it answered this command)
[ok]     cap: 3 live teammates (default)
[ok]     agent teams: enabled (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS)
[ok]     task tools: TaskCreate is available
[info]   statusLine: none configured (optional)
[ok]     team band: on
[ok]     stats recording: on
ready
```

The recording typed the same prompt into `claude --model sonnet` on a fresh copy of the fixture, with the same masks (now
including the promotion line, 59 replacements), allow rules, limits and a `PATH` that includes `npm`, from a clean
tree (`ctkCommit` `0aaa9a0`, no `-dirty`). The metadata also says `install: native (marketplace add
tc3oliver/claude-team-kit)`. The repository slug is the one deliberate exception to the personal-name grep. One
attempt. At the end the recorder typed `/ctk-stats`, then `/ctk-doctor`, then `/exit`. The footer is Claude Code's own,
with the CTK band as a line above the input box; no CTK status line was configured.

**What the frames show.**

- **Preflight failed.** At about 13 s the lead called `ctk_team_status`, as the skill's step 0 says. The call
  failed: `Error: tool.call step resolved mcp__ctk__ctk_team_status with a result that does not match its output
  shape`, with a schema error (`invalid_union … expected string, received object`). The lead said the check came back malformed, assumed the default cap of 3 and verified each
  spawn through its Agent result. This is a defect in the plugin's MCP tool output, visible in the recording.
- **Tasks were created, before any worker.** The status line showed `tasks 0/4` at 18 s, `tasks 0/6` at 19 s, and
  the first worker started at about 22 s. The task list had six tasks: one per module (`Test src/caesar.js`,
  `rle`, `roman`, `slugify`, `wordcount`) and a final `Run npm test and report`, shown as `blocked by #3, #4, #5`
  at 33 s, `#4, #5` at 38 s, `#5` at 43 s, and unblocked at 49 s as the blockers finished (the list hides blockers
  that are already done, and no sampled frame shows the full list of five). The final task was completed at 54 s,
  after the lead's own verification. The tool calls themselves are collapsed on screen, so the recording shows
  the `blocked by` marks but not the literal `addBlockedBy` arguments.
- **HUD tasks segment.** `tasks 0/4`, `0/6`, `2/6` (33 s, matching two ticked tasks in the list), `3/6`, `4/6`, `5/6`
  and `6/6` (54 s). The end state agrees with `/ctk-stats` (`tasks created/completed: 6/6`) and with the lead's
  report ("Task #6 is already closed"). The teammate `done` count in the same line stayed 0, as in the other runs.
- **Workers and cap.** Three workers (`w-caesar`, `w-rle`, `w-roman`, `ctk:implementer`, `claude-sonnet-5-5`)
  started at 22 s to 24 s. The lead did not try a fourth: it gave slugify to `w-caesar` (at 38 s) and wordcount to
  `w-rle` (at 43 s) when they finished. `/ctk-stats`: `teammate spawns: 3 accepted, 0 refused at capacity, 0 failed
  closed`, `peak live teammates: 3 (cap 3); now 0`. **No refusal occurred in Run C.**
- **Permission prompts.** None; `permissionApprovals` in the metadata is empty.
- **Results.** The lead ran several of the test files itself and then the full suite: "All five test files are written
  and npm test passes: 40 tests, 40 pass, 0 fail." Running `npm test` on the result afterwards gave the same: 40
  tests, 40 pass, 0 fail, 0 todo. Nothing was committed.
- **Cost and time.** 83 s of wall clock; `$0.91` on the status line and in `/ctk-stats`; context 6 %.
- **Doctor at the end.** `/ctk-doctor` inside the session printed the same readiness list as before the run.

**Oddities and fit with the skill.**

- The preflight error above is the one thing that went wrong. The skill's step 0 does not say what to do when the
  tool errors; the lead improvised sensibly.
- The lead created the tasks before spawning and added a verification task blocked by the slices, as the skill's
  unconditional rule asks. It closed the verification task only after running the suite itself.
- The lead's last message asks "I haven't run /ctk:review on the change. Do you want me to?"; the skill says to
  review the result with `/ctk:review`, and the lead left it to the user. The report is a single line of results
  plus follow-up notes, not the tasks, files and checks list the skill's close step describes.
- A few worker messages arrived after the lead had verified their work, including an echo of the lead's own
  task assignment; the lead said they changed nothing. `w-caesar` had not confirmed shutdown when the lead
  stopped waiting.

**Reading.** With the native install, the two settings and the strengthened skill, the lead did create and use
the shared task list, and the HUD tasks segment tracked it correctly from 0/6 to 6/6. Compared with Runs A and B
that is the visible difference: those runs coordinated by messages alone. One run says nothing about how reliably a
lead follows the rule, and the failing preflight call means the cap check in this run rested on the lead's
assumption, not on the tool.

## Reproduce

`scripts/demo/team-demo.sh` rebuilds everything: the fixture repository, the CTK install into a dedicated config
dir, the permission rules, the recording and all renderings. It needs `tmux`, `ffmpeg`, Chrome, a logged-in
dedicated config dir and a masks file, and it spends real money (this run cost under a dollar). See
[`scripts/demo/README.md`](../scripts/demo/README.md) for the tools and the exact commands.

```sh
CTK_DEMO_CONFIG_DIR=<dedicated config dir> CTK_DEMO_MASKS_FILE=<masks.json> scripts/demo/team-demo.sh all
CTK_DEMO_RUN=b CTK_DEMO_CONFIG_DIR=<dedicated config dir> CTK_DEMO_MASKS_FILE=<masks.json> scripts/demo/team-demo.sh all   # Run B
CTK_DEMO_RUN=c CTK_DEMO_CONFIG_DIR=<dedicated config dir> CTK_DEMO_MASKS_FILE=<masks.json> scripts/demo/team-demo.sh all   # Run C, native install
```

The model is not deterministic: another run will split the work differently, may spawn more or fewer workers,
and may hit the cap.

## What this does not prove

It is one run on one small project with one model family. It shows that CTK installs, that the lead can start
workers through it, that the status line and `/ctk-stats` count them, and that the cap held at 3. It does not
show that the cap refuses spawns (this run never asked for a fourth), how CTK behaves when workers fail or
run for a long time, or anything about cost or speed compared with a single agent or with another tool: there
is no baseline run. It does not judge the quality of the generated tests beyond the fact that they pass, and
the allow rules and the automatic Enter on one prompt made the session smoother than a default configuration would.
