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
Call `ctk_team_status` if it exists, then branch (never imply a cap you have not confirmed):
- Tool absent: the CTK mod is not active. Say the cap, band and stats are OFF and teams run unlimited; offer to go on.
- `guard.state` is `error` or `unavailable` (`guard.why` says why): the cap is not confirmed. Say so in one
  line and ask before starting anyone; if they go on, say workers run without a confirmed limit.
- `teamsEnabled` is false: spawn nothing. Tell the user the one-time setup: add
  `{"env":{"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS":"1"}}` to settings.json, restart Claude Code. Edit it only if
  they say yes (Edit tool, so they approve). `/ctk-doctor` shows readiness.
- `teamsEnabled` null: say you cannot tell, then proceed. `guard.state` `available` or `active`: proceed.

## 2. Plan
- Cut vertical slices: each delivers a working, independently verifiable behavior, and states spec/context
  pointers (never pasted contents), file scope and verify command. Ready frontier = pending slices with no open
  blockers.
- If `TaskCreate` is in your tool list, you MUST create the tasks before spawning anyone, even when every
  slice is independent: one per slice plus a final verification task blocked by all of them, with `addBlockedBy`
  for real dependencies only. Workers claim a task with `TaskUpdate` (owner + `in_progress`) and complete it;
  you close the final task only after running its verify command.
- No `TaskCreate` (default on Claude 5.x): say so in one line, keep a numbered plan with "blocked by" notes,
  and coordinate with `SendMessage`. `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` gives the shared task list.

## 3. Spawn
- Idle teammate first (`ctk_team_status`): give it the next ready task with `SendMessage`. Spawn only when none
  is idle and live teammates are below the cap (`maxWorkers`, default 3).
- `Agent` with a `name` on every worker (a named call is the teammate the cap counts); `subagent_type`:
  `ctk:implementer` to build, `ctk:explorer` to scout. Never set `isolation` on a worker: it then starts as an
  ordinary subagent, outside the team and the cap.
- One file scope and one owner per task (unless the owner failed or exited); slices that could touch the same
  file do not run at once: order them with `addBlockedBy` or narrow scopes. Hand over: task id, spec path,
  file list, commit sha; nothing pasted.

## 4. Confirm every spawn
A spawn exists only if the `Agent` result carries a `teammate_id` or agent id and `ctk_team_status` (if
available) lists the worker. `TEAM_CAPACITY_REACHED`, `TEAM_GUARD_FAILED` or a row that only shows "Done" means
not started: no owner, slice stays pending, re-offer it when a slot frees. Details: `references/protocol.md`.

## 5. Run
- Wait for teammate messages; reassign idle teammates with `SendMessage` to the next ready task. Do not do a
  worker's slice yourself while it is assigned.
- A worker that reports done is unverified until you run its verify command and read the result. Failure, an
  error or silence: read the report, retry that task once; a second failure: stop, mark it blocked, do it
  yourself or ask the user. Never loop on a refused spawn or a failing task.

## 6. Close
Integrate, run the full verification once, then shut each teammate down: `SendMessage` with `message` an
object `{"type":"shutdown_request"}`, never a JSON string (refused). Report tasks, files changed, check results.
Any task failed, blocked or unverified: say the goal is NOT complete and name it. Then `/ctk:review`.
