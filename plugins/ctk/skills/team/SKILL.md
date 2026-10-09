---
name: team
description: "Invoke before spawning several agents, or when asked for a team, multiple agents, split or parallel work (多個 Agent, 平行). Keeps the worker cap."
argument-hint: "<goal>"
---

Goal: $ARGUMENTS. You are the lead.

## 0. Intent gate
No clear ask for a team, multiple agents or parallel work (running `/ctk:team` counts as one)? Reply with one
sentence suggesting a team, or offering to do it yourself, and WAIT. Spawn nothing.
Asked, but the goal has no 2+ independently verifiable slices? Say so in one line and do the work directly.

## 1. Preflight
Call `ctk_team_status` if it exists, then branch:
- Tool absent: the CTK mod is not active here (unsupported build or mods disabled). Say in two lines that
  the worker cap, HUD band and stats are OFF and teams run without a limit; offer to continue. Never imply a cap.
- `teamsEnabled` is false: spawn nothing. Tell the user the one-time setup: add
  `{"env":{"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS":"1"}}` to settings.json (`~/.claude/settings.json`
  or the project's) and restart Claude Code. Edit it only if they say yes, with the Edit tool so they approve.
  `/ctk-doctor` shows readiness.
- `teamsEnabled` is null: say you cannot tell, then proceed. Otherwise proceed.

## 2. Plan
- Cut vertical slices: each delivers a working, independently verifiable behavior.
- If `TaskCreate` is in your tool list, you MUST create the tasks before spawning anyone, even when every
  slice is independent: one task per slice, plus a final integration/verification task blocked by all of them.
  Use `addBlockedBy` for real dependencies only, so independent slices stay unblocked. The shared task list is
  what the user watches and what the HUD `tasks` count reads. Workers claim a task with `TaskUpdate`
  (owner + `in_progress`) and complete it. You close the final task only after running its verify command.
- If `TaskCreate` is not in your tool list (current default on Claude 5.x), say so in one line, keep a numbered
  plan in your reply with explicit "blocked by" notes, and coordinate with `SendMessage`.
  The user can get the shared task list with `ctk config set claude.enableTaskTools true`
  or by starting Claude Code with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`.
- Each slice states: spec/context pointers, file scope, verify command. Pointers, never pasted contents.
  Ready frontier = pending slices with no open blockers.

## 3. Spawn
- Spawn at most the cap (`maxWorkers`, default 3) with `Agent`, giving each a `name`.
  `subagent_type`: `ctk:implementer` to build, `ctk:explorer` to scout.
- One file scope per worker. If scopes can overlap, set `isolation: worktree`.
- Hand over: task id, spec path, file list, commit sha. Nothing pasted.

## 4. Confirm every spawn
A spawn counts only when the `Agent` result carries a `teammate_id` or agent id, and
`ctk_team_status` (if available) lists the worker. Otherwise it did NOT start.
`TEAM_CAPACITY_REACHED`, `TEAM_GUARD_FAILED`, or a row that only shows "Done" means not started:
set no owner, keep the slice pending, re-offer it when a slot frees. Idle teammates count as live:
reuse them with `SendMessage`. Details: `references/protocol.md`.

## 5. Run
- Wait for teammate messages; reassign idle teammates with `SendMessage` to the next ready task.
- Do not do a worker's slice yourself while it is assigned.
- A worker that reports done is unverified until you run its verify command.

## 6. Close
Integrate, run the full verification once, then send each teammate a shutdown request
(`SendMessage`) so capacity frees. Report: tasks, files changed, checks run and their results.
Review the result with `/ctk:review`.
