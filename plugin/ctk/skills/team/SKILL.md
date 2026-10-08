---
name: team
description: Run a goal with a capped native agent team when work splits into independent slices.
disable-model-invocation: true
argument-hint: "<goal>"
---

Goal: $ARGUMENTS. You are the lead.

## 1. Decide
Default to one agent (yourself) doing the work. Use a team only if the user asked for one
or the goal splits into 2+ slices that can be built and verified independently.
If neither holds, say so in one line and do the work directly.

## 2. Plan
- Cut vertical slices: each delivers a working, independently verifiable behavior.
- If `TaskCreate` is in your tool list, create one task per slice and add real dependencies with
  `addBlockedBy` only. If it is not (current default on Claude 5.x), say so in one line, keep a numbered
  plan in your reply with explicit "blocked by" notes, and coordinate with `SendMessage`.
  The user can get the shared task list with `ctk config set claude.enableTaskTools true`
  or by starting Claude Code with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`.
- Each slice states: spec/context pointers, file scope, verify command. Pointers, never pasted contents.
- Ready frontier = pending slices with no open blockers.

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
