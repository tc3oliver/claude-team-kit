---
name: ctk
description: "CTK: team progress, 5h/weekly usage, worker cap and settings, profile sync across machines."
argument-hint: "[status | config | sync | what you want]"
---

Request: $ARGUMENTS (if empty, use the user's last message). Pick ONE section. Answer in the user's language.

## Status, progress, usage
The CTK tools are deferred: if `mcp__ctk__ctk_team_status` (or `mcp__ctk__ctk_config`) has no schema loaded, load it
first with ToolSearch (`select:mcp__ctk__ctk_team_status`). Then call it and answer from its JSON only. Fields:
`live`, `max`, `workers`, `rejected`, `accepted`, `cap`, `teamsEnabled`, `taskTools`, `guard`, `running`, `idle`,
`completed`, `failed`, `teamElapsedMs`, `subagents`, `explain`, `tasks`, and `usage` (`contextPct`, `fiveHour`, `sevenDay`, `cost`,
`toolCalls`, `model`).
- A field that is missing, null or "unavailable": say "unavailable". Never estimate or guess a number.
- No workers or tasks: say `explain.workers` / `explain.tasks` in your own words. Agents counted in `subagents` are ordinary subagents, not teammates; never call them workers.
- Usage questions (5h limit, weekly limit): report only what `usage` contains.
- Mention once that the clickable CTK band is the live view and `/ctk-mission` opens Mission Control.
- Tool not registered: the CTK mod is not active here. Say so; do not invent values.

## Is CTK working
Tell the user to run `/ctk-doctor`, or call `mcp__ctk__ctk_team_status` and report what it returns.
Never state a result you did not see.

## Change a setting
Load the tool with ToolSearch (`select:mcp__ctk__ctk_config`) if its schema is not loaded.
Option names: `maxWorkers`, `explorerModel`, `implementerModel`, `reviewerModel`, `highRiskModel`, `hudBand`,
`hudIdle` (what the band shows before a team starts: full, minimal or hidden), `recordStats`. Never guess another name; if the request maps to none, say so and list these.
- List current values: `mcp__ctk__ctk_config` with `{"action":"show"}`.
- Change: `{"action":"propose","option":"maxWorkers","value":2}` (value is a number, boolean or model name).
- The tool applies NOTHING. It opens a confirmation in the Mission Control pane and the user confirms there.
  Say that plainly, in the user's language: "I opened CTK Mission Control; press Confirm there to apply it (or Cancel).
  Nothing changes until you do." The band shows "Confirm setting" until it is answered.
  Never claim the change happened. Never edit `settings.json`.
- Tool not registered: say so and point to `/plugin configure ctk@ctk-kit`.

## Sync a profile between computers
This needs the optional `ctk` CLI (git-based; 3-way merge, secrets scan, conflict detection). It syncs the CTK
profile only, never credentials, env, hooks or permissions. Never touch `settings.json` or `~/.claude` yourself.
1. `ctk --version` with Bash. If missing: say sync needs the CLI, link `docs/INSTALLATION.md#the-optional-ctk-cli`
   (in the CTK repository), and stop.
2. `ctk sync status`. If it says sync is not set up, ask the user for the profile git remote (URL or path), then
   `ctk sync init --remote <remote>` only after they give it.
3. Preview first and show the output: `ctk sync pull --dry-run` (get the other computer's settings) or
   `ctk sync publish --dry-run` (send this computer's, `-m "<message>"` is optional).
4. Ask in plain words: "This will <pull/publish> as shown. Go ahead?" Run the same command without `--dry-run`
   only after an explicit yes.
5. Exit code 2 means conflicts: stop, show them, let the user choose `ctk sync resolve <pointer> ours|theirs`
   per conflict. Exit 1 with a secrets finding means refused: show it and stop. Never bypass the scan, never force.
