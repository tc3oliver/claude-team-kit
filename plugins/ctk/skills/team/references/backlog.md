# Optional Backlog task handoff (only for explicitly combined work)

This is a conditional team guide, not a Backlog dependency. Without an explicitly named BL-ID, normal CTK Team behavior is unchanged.

## Before slicing

1. A request for a team referencing one or more `BL-<16-hex>` tasks must resolve **each real** persisted task before making a plan. Use the installed Backlog Skill/CLI if accessible; do not guess its install path, fabricate task contents or initialize a backlog. A request to run the ready queue resolves the tasks the CLI's `next` returns, never a wider set.
2. Read only Goal, Acceptance Criteria, References, Handoff, dependencies and current status. Use the CLI's readiness checks (not just an ID or a guess).
3. `inbox`, `blocked`, `done`, `cancelled` or unmet dependencies: **stop** for that task; do not spawn workers for it or advance its persistent state. With several tasks, the ready ones may proceed; report the others. `doing`: reconcile current repo with Handoff; do not call `start` again.
4. `todo` and ready: **defer `start` until CTK preflight succeeds and that task's work actually begins**; Team unavailable/disabled means the BL task stays unchanged. If the goal has fewer than two independently verifiable slices, do it directly under the same BL rules.
5. No Backlog Skill/CLI and no complete Goal/AC supplied: ask for the missing information and spawn nothing. With a complete independently supplied goal, CTK may run normally, but must not claim BL state was changed.

## Several BL tasks (explicit request only)

- Each BL task is its own group of slices with its own file scope. Two BL tasks whose edited files overlap do not run at once: order them with `addBlockedBy`. Check the files before spawning, not after.
- Keep each BL task's changes separable (one commit per BL task when the repository commits), so one can be verified, closed or reverted alone.
- Close each BL task on its own verified AC and evidence. One passing never closes another; a failing one stays open with an accurate Handoff while verified ones close.
- Stop after the requested set. Do not pull more tasks from `next` unless the user asked to drain the queue.

## Execution and completion

- CTK splits work into **temporary** native tasks. Only the lead updates a persisted BL Task; no 1:1 sync with worker task IDs. Workers receive spec pointers/file scope/checks, not full archive dumps.
- A Worker Task reporting done does **not** prove acceptance. BetFirst probes, if used, return a bounded observation, not a completion signal.
- The lead integrates and verifies recorded AC and required checks. Only then use the installed Backlog CLI to check AC and close with observed evidence. If verification fails or work is interrupted, preserve accurate Handoff/Blocker and leave BL open.
- If the Backlog CLI is unavailable, report the work and validation results without claiming any persistent update. CTK continues to work without Backlog on ordinary team goals.
