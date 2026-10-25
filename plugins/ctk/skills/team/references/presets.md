# Team presets

Starting points for step 2 (Plan). Adapt the slices to the goal; every slice still needs a file scope, a
verify command and one owner, and the cap in `SKILL.md` still applies.

## Review
- Slices: one reviewer per axis, 3 at most (for example correctness, security, tests and docs). Each reads the
  same diff and reports `path:line` findings for its axis only.
- Roles: `ctk:reviewer` per axis; `ctk:high-risk-reviewer` for the axis that touches auth, data loss or money.
- Verify: you merge the findings, drop duplicates, and re-run the checks of anything a finding touches.

## Debug
- Slices: one competing hypothesis per worker. Each tries to disprove its own hypothesis with a reproduction
  or a log read and reports the evidence, not a fix.
- Roles: `ctk:explorer` per hypothesis; one `ctk:implementer` after you pick the surviving cause.
- Verify: a failing test that reproduces the bug first, the same test passing after the fix, then the suite.

## Feature
- Slices: vertical behaviors, each with its own files; shared files (types, config, index) go to one owner
  or are ordered with `addBlockedBy`.
- Roles: `ctk:implementer` per slice; `ctk:explorer` first when the code is unfamiliar.
- Verify: each slice's own test, then the full check once after integration, then `/ctk:review`.

## Research
- Slices: one question or source area per worker; read-only, no edits.
- Roles: `ctk:explorer`.
- Verify: every claim has a `path:line` or a link; you cross-check the claims that disagree before answering.

## Migration
- Slices: one module or directory per worker, no overlapping files; a first slice that moves the shared
  interface, the rest blocked by it.
- Roles: `ctk:implementer` per slice.
- Verify: build and tests per slice, a grep for the old name across the repo, then the full check.
