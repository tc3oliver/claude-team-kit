---
name: review
description: "CTK risk-based review of current changes: picks reviewer depth by diff risk. For 'review my changes'."
argument-hint: "[spec path or ticket]"
---

Review the current change against $ARGUMENTS (spec or ticket; if empty, infer from the task).

## 1. Scope
Get the change with `git diff` (or `git diff <base>..HEAD`). Write it to a scratch file;
reviewers receive that path, never pasted diff text.

## 2. Classify risk from the diff
High if it touches any of: auth, money, data migration, concurrency, public API, security, secrets.
Medium if it changes behavior across modules or adds a dependency. Otherwise low.
Criteria and examples: `references/risk.md`.

## 3. Review by risk
- Low: run the self-review checklist in `references/checklist.md`. No subagent.
- Medium: spawn `ctk:reviewer`.
- High: spawn `ctk:high-risk-reviewer`.
Hand the reviewer: diff file path, spec path, base sha. Spawn is confirmed only with an agent id;
if refused (`TEAM_CAPACITY_REACHED`), run the checklist yourself and say so.

## 4. Two axes
1. Standards: project rules (CLAUDE.md), correctness, simplicity.
2. Spec: does the change do what the ticket says; anything missing or extra.

## 5. Findings
Each finding: `path:line`, the failing scenario, one-line fix. Drop anything a linter or formatter owns.
Verify each finding against the code before reporting it. Report: risk level, reviewer used, findings or
"none found" with what was checked. Do not fix in this skill unless asked.
