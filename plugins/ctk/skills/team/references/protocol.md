# Team protocol

Read this when a spawn is refused, unclear, or a worker misbehaves.

## Spawn confirmation

| Signal | Meaning | Action |
|---|---|---|
| Result has `teammate_id` / agent id | Started | Record name and id; set task owner |
| `ctk_team_status` lists the worker | Confirmed live | Count it against the cap |
| Text contains `TEAM_CAPACITY_REACHED` | Refused, at cap | Not started. Keep task/slice pending. `SendMessage` an idle teammate, else wait |
| Text contains `TEAM_GUARD_FAILED` | Refused, guard error | Not started. Retry once after a live-worker check; else work the task yourself |
| Row shows only "Done", no id | Never started | Treat as refused |

The refusal text reads `Subagent spawn denied by a plugin: TEAM_CAPACITY_REACHED: live=N starting=M max=K ...`.
That text is the authority. Claude Code's own panel can show a refused spawn as "finished ... Done";
do not read that as a started worker. Trust the refusal text over the panel and over your own count.
Idle teammates count as live; reuse them with `SendMessage` rather than spawning.

## Reusing capacity

1. List workers with `ctk_team_status`.
2. An idle worker takes the next ready task via `SendMessage` (task id + pointers).
3. A worker with no further tasks gets a shutdown request. Capacity frees only after it exits.

## Handoff message (copy the shape)

```
Task <id>: <one-line title>
Spec: <path>   Scope: <files/dirs you may edit>   Base: <commit sha>
Verify: <command>   Report: files changed, command result, risks
```

## Model routing

Roles map to agents: build -> `ctk:implementer`, scout -> `ctk:explorer`, review -> `ctk:reviewer`
or `ctk:high-risk-reviewer`. Models come from plugin options; do not pass `model` unless the user asked.

## Conflicts

Two workers touching one file: stop the second, narrow its scope, or rerun it with
`isolation: worktree`. Merge worktree results yourself and rerun verification.
