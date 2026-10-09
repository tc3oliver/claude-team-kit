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

Two workers touching one file: stop the second, narrow its scope, or hold it until the first is done
(`addBlockedBy`). Do not use `isolation: worktree` for team workers: Claude Code starts a named agent that
passes `isolation` as an ordinary subagent, not a teammate (seen live on 2.1.295), so it is outside the team
and outside the cap, and `ctk_team_status` may not list it. If the user asks for worktree isolation anyway,
say that those workers are not limited by CTK, and count them yourself.

## Shutting a teammate down

`SendMessage` with `message` as an **object**: `{"type":"shutdown_request","reason":"work verified"}`. The same JSON as a
string is refused ("message text must not be a teammate protocol frame", seen live: five wasted calls before the object
form). The result says `Shutdown request sent`; until it does, the teammate still counts against the cap. Do not tell the
user workers were shut down until it has.

## Failures and retries

| Situation | Action |
|---|---|
| Worker reports failure or an error | Read the report. One retry: same worker with the failure, or another idle worker |
| Second failure of the same task | Stop. Mark it blocked; do it yourself or ask the user |
| Worker silent for long | Message it once; if still silent, treat it as failed |
| Spawn refused | Keep the task pending. Retry only after a teammate finishes or goes idle, never in a loop |
| Task already has an owner | Do not assign it to another worker unless that owner failed or exited |
