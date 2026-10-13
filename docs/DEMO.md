# The team demo: one real session

The recorded demo is Run F below. Runs A to E (the team-demo set and Run E's Mission Control recording) were removed
from the working tree to keep the repository small. Where other documents cite "Run A" to "Run E", the prose and the
files are in git history: `git show cbf785d:docs/DEMO.md`, with the files under `docs/assets/` at that commit.

## Run F: the redesigned Mission Control, docked beside a live team

This is the recording for the redesigned Mission Control. Files:
[`mission-control-f.svg`](assets/mission-control-f.svg) (animated, no scripts),
[`mission-control-f.gif`](assets/mission-control-f.gif), [`mission-control-f.mp4`](assets/mission-control-f.mp4),
[`mission-control-f.frames.jsonl`](assets/mission-control-f.frames.jsonl) and the stills
[the band](assets/mission-control-f-band.svg), [overview](assets/mission-control-f-overview.svg),
[workers](assets/mission-control-f-workers.svg), [tasks](assets/mission-control-f-tasks.svg),
[usage](assets/mission-control-f-usage.svg) and [poster](assets/mission-control-f-poster.svg).

**Setup.** The plugin installed through the Plugin Manager from commit `e637906` into the dedicated, logged-in
config directory; a fixture of five small modules (`caesar`, `rle`, `roman`, `slugify`, `wordcount`); Agent Teams and
the task tools on in that directory's `settings.json`; `maxWorkers=3` passed with `--config`. Claude Code 2.1.295, a
Sonnet 5.5 lead, 120 x 38 terminal. The playback is 45 s of a 185 s session. Prompt suggestions were switched off in
the dedicated configuration (`promptSuggestionEnabled: false` and `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false`) so
that no grey suggestion text appears on the input line. The recording has four rendering masks (the account plan name,
twice; the account e-mail address; the organisation name); the replaced text is not part of the story and nothing else
was edited.

**What was typed.** One sentence that asks for seven tasks: one test file per module (at least twelve cases each), a
task that only runs `npm test`, and a task that writes `TEST-REPORT.md`. It also tells the lead to run nothing
itself and every command to be a single `node --test test/<module>.test.js` or `npm test`, so that no permission
prompt interrupts the recording; this is a recording choice, not the usual way to prompt. The clicks are real mouse
reports sent through tmux at positions found on the screen at that moment: the `CTK ▸` entry of the band (once
`Agents 3/3` had stayed on screen for two seconds), then `2: Workers`, `3: Tasks`, `4: Usage`, `1: Overview` and
`[ Close ]`. Finally a second plain-words question about the team and the 5-hour usage.

**What the frames show** (recorded seconds).

- **The lead loaded `ctk:team`, created seven tasks and started three workers** (`Skill(ctk:team)` at 54 s,
  `Agents 3/3` at 80 s). It ran one `ls` before planning and said so in its own text, which broke the "run nothing
  yourself" instruction in the prompt; it ran nothing else.
- **The pane opened at 83 s next to the transcript** and stayed up for 47 s: Workers 6.6 s, Tasks 27 s (the 25 s wait
  ended on its soft timeout), Usage 5 s, Overview 4.3 s. In real cells the docked pane was about 48 cells wide, so the
  graph shows short titles.
- **The task graph moved with the work.** Tasks 1 to 5 fan in to `#6 Run npm test`, which leads to `#7 Write
  TEST-REPORT.md`. At 93 s node 1 was done and 2 and 3 running; 4 and 5 turned ready, then running, then done one
  after another (nodes 4/7 at 105 s, 5/7 at 120 s) while `#6` and `#7` stayed `○` until what they need was done. The
  bar went from 14 % to 71 % marked complete. Two stretches (97 to 104 s and 105 to 116 s) show no change; the
  playback shortens them.
- **The cap held and nothing was refused.** Three spawns were accepted and none rejected; no permission prompt
  appeared.
- **The question in words.** The lead called `ctk_team_status` and answered: 7 of 7 tasks done, none blocked, no live
  workers, 5-hour 13 % used (resets in about 4h04m), weekly 65 %, about $1.03, 79 tool calls, context 6 %. The band's
  `Tools 79` and `5h 13% (4h04m)` agree.

**Things to know.**

- **Take 6 is the one published** (takes 0 to 6, with 5 recorded twice). Take 0 failed because the tab labels were cut at 48 cells (a UI fix followed); takes 1
  and 5a stopped on the recording script (a too strict wait, a band click that missed); take 2 had no task graph on
  screen; take 4 showed a permission prompt and a grey suggestion; take 5b spent 36 s on the Overview and 3 s on Tasks;
  take 3 was clean but showed Tasks for only 6.5 s. Takes were never spliced. A full take costs about a dollar by the
  status line (this one: $1.03), so the experiment cost somewhere around seven to nine dollars in all (the early takes were not itemised). Only take 6's frames are in the
  repository.
- **The lead's idle notices repeat.** Several `Teammate @w-… finished` lines are workers answering a re-delivered
  assignment with "already done"; they did not redo work.
- **One run on a small fixture.** The pane's behaviour on a light terminal, with other fonts, or under a different
  host version was not recorded. For the full-screen layouts at other widths see the synthetic screenshots below.

Reproduce: `CTK_DEMO_RUN=f CTK_DEMO_CONFIG_DIR=<dedicated config dir> CTK_DEMO_MASKS_FILE=<masks.json> scripts/demo/team-demo.sh all`.
The recorder stops by itself if more than three agents are busy or the cost passes $10.

## The HUD at five widths

`docs/assets/hud-widths.svg` is not a recording: it draws the rows in `docs/assets/hud-widths.json`,
which were copied from tmux captures of two live sessions (Claude Code 2.1.295, the working-tree
plugin loaded with `--plugin-dir`, one `ls` and one `Read` as the only tool calls), the terminal
resized between captures. The second session also had CTK's status line configured through
`--settings`. Usage figures are the maintainer account's at that moment. Rebuild the image with
`node scripts/render-hud-widths.mjs`.

## Mission Control screenshots (synthetic data)

`scripts/showcase/` renders the real Mission Control pane in a real Claude Code terminal from fixed fixture data,
for ten scenes (empty state, active team, workers, task DAG, usage, guard at capacity, a task board too big to draw, config with a pending change, stats, doctor) at 60, 80, 100, 130 and
200 columns. No model is called and no agent runs, so these pictures show layout only: every one carries the line
`SYNTHETIC DATA - UI showcase, not a live agent run` and a metadata line with the ctk commit, Claude Code version and
date. They are not part of the recorded runs above and prove nothing about team behaviour. The sets are in
`docs/assets/mission-control-ui/<name>/`. The clip and `readme/*.svg` show the pane in context: a 130-column terminal
with the pane docked beside the transcript (about 58 cells wide), the whole screen, not the pane alone. The 100-column
stills and width sheets show the pane by itself. The account plan in the Claude Code header is masked as `plan hidden`. How the pictures are made and reproduced is in `scripts/showcase/README.md`.

## Reproduce

`scripts/demo/team-demo.sh` rebuilds everything: the fixture repository, the CTK install into a dedicated config
dir, the permission rules, the recording and all renderings. It needs `tmux`, `ffmpeg`, Chrome, a logged-in
dedicated config dir and a masks file, and it spends real money (a full take costs about a dollar). See
[`scripts/demo/README.md`](../scripts/demo/README.md) for the tools and the exact commands.

```sh
CTK_DEMO_RUN=f CTK_DEMO_CONFIG_DIR=<dedicated config dir> CTK_DEMO_MASKS_FILE=<masks.json> scripts/demo/team-demo.sh all
```

The model is not deterministic: another run will split the work differently, may spawn more or fewer workers,
and may hit the cap.

## What this does not prove

It is one run on one small project with one model family. It shows that the pane opens beside a live team, that its
task graph follows the work, and that the cap held at 3. It does not show that the cap refuses spawns (this run never
asked for a fourth), how CTK behaves when workers fail or run for a long time, or anything about cost or speed
compared with a single agent or with another tool: there is no baseline run. The prompt was written to avoid
permission prompts, so the session was smoother than a default configuration would be.
