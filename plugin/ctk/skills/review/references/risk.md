# Risk classification

Take the highest level any touched file reaches.

## High
- Authentication, authorization, sessions, permission checks.
- Money: pricing, billing, balances, refunds.
- Data migration, schema change, deletion or rewrite of stored data.
- Concurrency: locks, queues, async ordering, shared mutable state.
- Public API or file format other code or users depend on.
- Security: input parsing, shell/SQL construction, crypto, secrets, network exposure.

## Medium
- Behavior change spanning two or more modules.
- New or upgraded dependency.
- Error handling, retries, configuration defaults.
- Tests deleted or weakened.

## Low
- Docs, comments, renames within one module, test-only additions, formatting-adjacent edits.

## Escalate when
- The diff is larger than you can hold in one read (> ~400 changed lines): move up one level.
- You are unsure between two levels: take the higher.
