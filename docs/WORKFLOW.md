# How CTK works

One goal, a graph of small tasks, a few workers, and a check at the end. This page explains each step of that
workflow and, for every step, **who does it**: Claude Code itself, a CTK skill that instructs the model, or CTK's
code. Those are three different things with three different strengths, and mixing them up is the easiest way to
overstate what a plugin can do.

<p align="center">
  <img src="assets/how-it-works.svg" alt="Illustration: one goal becomes eight vertical-slice tasks with real dependencies; only ready tasks start; three native teammates work at once and a fourth ready task waits; the lead hands the next ready task to an idle teammate with a short handoff; the final task is the lead running the verification command" width="900">
</p>

<p align="center"><sub><b>An illustration, not a recording.</b> The scenario ("implement authentication improvements and add
regression tests"), the eight tasks and the timings are invented to show the mechanics. Real recordings are in
<a href="DEMO.md">DEMO.md</a>. Also as <a href="assets/how-it-works.mp4">MP4</a> (24 s loop) and a
<a href="assets/how-it-works-poster.png">poster image</a>; the source is in
<a href="../scripts/media/how-it-works/README.md"><code>scripts/media/how-it-works</code></a>.</sub></p>

## Who does what

| Layer | What it is | What it can be trusted for | What it cannot promise |
|---|---|---|---|
| **Native** (Claude Code) | Agent Teams: a lead and teammates that are separate Claude Code sessions, a shared task list with dependencies, messages between them. Experimental, off until you enable it. | Dependencies hold: a task with open blockers is not claimed, and finishing a task unblocks the tasks that wait for it. | Nothing here checks that finished work is correct. |
| **Skill-guided** (CTK skills) | Short Markdown procedures (`/ctk:team`, `/ctk:review`, `/ctk:debug`, `ctk`) that the model reads and follows. | A clear default way of working, loaded only when used. | The model may follow them imperfectly. No code checks that it did. |
| **Mod-enforced** (CTK's plugin code) | A Mods hook that sees every spawn Claude Code is about to make (it refuses teammate spawns above the cap and fills in a model for `ctk:*` agents that name none), a display-only HUD, Mission Control (one settings change, only after you confirm it) and two small tools. | A hard limit on teammate spawns, and figures counted from real events. | It does not start, assign, queue or retry anything. |

Everything below carries one of those three labels. A sentence that says "the lead should" is skill-guided; a
sentence that says "is refused" is the mod. Statements about what Claude Code does by itself (dependencies, who
may claim a task, what a teammate starts with) come from Claude Code's Agent Teams documentation; CTK relies on
them and does not test them.

## The flow

### 1. Plan: vertical slices *(skill-guided; the list itself is native)*

`/ctk:team` tells the lead to cut the goal into **vertical slices**: each slice delivers one working behaviour,
so it can be checked on its own. "Add the lockout, with its tests" is a slice; "write all the tests" or "touch the
database layer" is not, because neither can be verified alone. If the goal has no two slices that can be verified
independently, the skill tells the lead to say so and do the work directly. Its first step is an intent gate: a
request that does not ask for a team, several agents or parallel work should get one sentence of suggestion and no
spawn.

When the task tools exist (on Claude 5.x they are off unless `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`), the lead creates one
task per slice plus a final verification task, before starting anyone. Without them the lead keeps a numbered plan
with "blocked by" notes and coordinates by messages. In the recorded runs with the tools on (C, D and E) the lead
created the tasks before starting anyone; in an earlier run with the tools on (B) it did not, which is why the
skill's wording became unconditional.

### 2. Dependencies and the ready frontier *(native rules, skill vocabulary)*

Each task lists the tasks that must finish first, and the skill asks for **real** dependencies only: an edge means
"this needs that result", never "this is nicer in this order". Slices that do not depend on each other stay
unblocked. In the illustration `T4` needs `T1` because it records the lockout events `T1` introduces; `T3` needs
nothing.

The **ready frontier** is the set of pending tasks with no open blockers. The word is skill vocabulary; Claude Code
has no "ready" state. What is native is the rule behind it: a task with unresolved dependencies cannot be claimed,
and when a teammate marks a task complete, the tasks that waited for it unblock. Mission Control's Tasks view
labels tasks ready or blocked, but that label is CTK's own reading of the task calls it saw, not Claude Code's
state and not a control.

### 3. Bounded parallelism *(mod-enforced, on teammate spawns only)*

CTK's mod answers every spawn Claude Code is about to make as a **teammate**. If the team already has as many live
teammates as the cap (default 3, settable from 1 to 12), the spawn is refused with `TEAM_CAPACITY_REACHED`. A
teammate that is idle still counts as live; a slot frees only when a teammate has exited. If the mod cannot read
the roster it refuses (`TEAM_GUARD_FAILED`) instead of guessing.

What this is **not**:

- **Not a scheduler.** The hook can allow or deny one spawn. It does not queue the refused work, retry it, pick the
  next task or move anything to a worker. The lead (a model following the skill) keeps a refused task pending and
  offers it again later; the skill says so, and a model can still misread a refusal.
- **Not a limit on ordinary subagents.** The hook gates only spawns that Claude Code marks as teammates. Per
  Claude Code's documentation a named `Agent` call becomes a teammate while Agent Teams are on, and an unnamed one
  or one that passes `isolation` does not; CTK did not check that boundary live. The team skill advises
  `isolation: worktree` when file scopes may overlap, so such a worker may sit outside the cap.
- **Not a limit on cost.** It limits how many teammates are alive, not what they spend.
- **Not present without the mod.** On a Claude Code build without Mods (older than 2.1.287, mods disabled,
  reportedly WSL) there is no cap, and the team skill tells the lead to say so before starting.

In the illustration the three teammates are alive at 3/3 while `T4` and `T5` are both ready. The lead gives `T4`
to the one that is idle, and `T5` waits.

### 4. Lean handoff *(skill-guided)*

A teammate starts with its spawn prompt and the project context it loads itself; the lead's conversation does not
carry over. So what the lead hands over matters, and the skill says to send **pointers, not contents**:

| Field | Example (invented) |
|---|---|
| Task ID | `T4` |
| Spec path | `specs/auth/T4.md` |
| File scope | `src/auth/audit/**` |
| Verification command | `npm test -- audit` |

The skill also names a base commit and the shape of the report the worker sends back; the illustration leaves them
out to stay readable.

The intent is that a worker reads the spec from disk instead of the lead pasting it into a message, that each worker
owns one file scope, and that its own check says when it is done. This is a design intent: nothing measures or
limits what the lead actually sends, and **no token saving is claimed**. The recordings do not show the content of
the lead's handoff messages.

Reassignment is the same kind of step. When a teammate finishes and goes idle, the **lead** hands it the next ready
task by messaging it, and the task's owner then shows the new worker. Claude Code also lets an idle teammate claim an unassigned,
unblocked task by itself; CTK's skill prefers the lead's explicit choice. Either way the choice is made by the
lead or the teammate, never by CTK. In the recordings the lead gave the last two tasks to whichever worker finished
first.

### 5. Verification: done means verified *(skill-guided)*

A worker marking a task complete is native and is **not** verification: it unblocks dependents right away. The
skill tells the lead to treat a "done" as unverified until it has run the task's verification command and read the
result, to run the full suite once at the end, to close the final task only after that, and then to shut the
workers down. In the illustration the last task belongs to the lead for exactly that reason.

Nothing in code enforces this: no hook stops a task from being completed, and CTK does not use Claude Code's
`TaskCompleted` hook to block. In the Run D frames the task count rose before the lead had run its own check, and
at one point a worker edited a file after the lead had verified it, so the lead ran the check again. A passing check
shows that the check passed; it is not a guarantee that the work is right.

### 6. Review, scaled to risk *(skill-guided)*

`/ctk:review` classifies the change first, taking the highest level any touched file reaches. A change touching
authentication or sessions, money, a migration, concurrency, a public API or file format, or security is **high**
risk; behaviour spanning modules, a new dependency, error handling or configuration defaults, or weakened tests is
**medium**; docs, renames and test-only additions are low. A very large diff moves up a level, and so does doubt. Low gets the model's own checklist and no extra agent, medium a read-only `ctk:reviewer`, high the read-only
`ctk:high-risk-reviewer` (Opus by default). Reviewers get a path to the diff rather than its text, and report only
defects, each with a `path:line`, the failing scenario and a one-line fix. The classification is the model's
reading of a rubric, not code. `/ctk:review` has not been run on a real change yet.

### 7. Debugging, with evidence *(skill-guided)*

`/ctk:debug` asks for a failing command first, then a minimised reproduction, then two to four hypotheses each
with an observation that would refute it, one probe per hypothesis, a fix of the root cause with the smallest
diff, probes removed, and the reproduction kept as a regression test that was seen to fail before and pass after.
After three refuted hypotheses it stops and asks. It has not been run on a real bug yet.

## What this does not claim

- CTK does not orchestrate: the lead and Claude Code's own task list do. There is no queue, scheduler or
  resident process in CTK.
- The cap is not "always on": it holds while the mod is loaded, for teammate spawns, on a build that supports Mods.
  Its live evidence is one refusal in a recorded attempt and a maintainer's proof of concept; the later full
  recordings never needed it.
- Model routing (explorers on Haiku, implementers and reviewers on Sonnet, the high-risk reviewer on Opus) is
  configuration, applied only when a spawn names no model. The recordings used a Sonnet lead and Sonnet
  implementers, so they cannot show it.
- No speed, cost or token comparison is made. Native docs say teams use significantly more tokens than one session,
  and no baseline run exists.
- The illustration is invented. The real numbers (43 tests, six tasks, three workers, about a dollar) belong to
  Run D and Run E on a small fixture, with one model family.

## Where each claim was seen

| Claim | Seen in |
|---|---|
| Tasks created with dependencies before any worker starts; three workers; the lead keeps the rest pending and hands them to idle workers | Runs C, D and E in [DEMO.md](DEMO.md) |
| A spawn above the cap refused with `TEAM_CAPACITY_REACHED` | The one recorded attempt in [DEMO.md](DEMO.md#attempt-1-the-cap-refusing-live-not-the-published-run) |
| A plain sentence started the team skill; the band opened Mission Control by a click | Run E |
| Reassignment by the lead, and a task done before the lead verified it | Run D |
| Risk-scaled review, the debugging procedure, models per role | Not exercised live ([LIMITATIONS.md](LIMITATIONS.md)) |

## Ideas this workflow borrows

CTK's skills are short procedures written for this project; no text or code was copied. These ideas were studied in
two MIT-licensed projects and are reimplemented here in CTK's own words:

- **Vertical slices, tasks with explicit blockers, and working from the frontier** come from reading
  [mattpocock/skills](https://github.com/mattpocock/skills) (MIT, Copyright (c) Matt Pocock): thin end-to-end
  slices that can be checked alone, a ticket's list of what blocks it, and starting only what is unblocked. The
  two-axis review (standards and spec, kept apart) and the habit of building a fast failing check before diagnosing
  a bug are also from there.
- **Evidence before completion, plans handed to workers as files, context-lean handoffs and root cause before fix**
  come from reading [obra/superpowers](https://github.com/obra/superpowers) (MIT, Copyright (c) Jesse Vincent): no
  claim of success without fresh output from the command that proves it, a worker brief as a file rather than
  pasted history, and no fix before the cause is understood.

Claude Team Kit is an independent project. It is not affiliated with, sponsored by or endorsed by either author or
by Anthropic, and it does not reproduce their skills. If you want those methodologies, use the originals. Where
CTK differs from them (the hard teammate cap, the HUD and Mission Control, native Agent Teams as the runtime, review
depth scaled to risk), the difference is CTK's own.

## Reproducing the illustration

The animation is generated from a small, validated storyboard; see
[`scripts/media/how-it-works/README.md`](../scripts/media/how-it-works/README.md) for the build, the checks it runs,
and how to change it.
