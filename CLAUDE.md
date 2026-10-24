# CLAUDE.md

Rules for agents working in this repo. The full contributor notes are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#contributor-notes) and [CONTRIBUTING.md](CONTRIBUTING.md);
this file lists only what goes wrong most often.

## Verify commands

| What changed | Command |
|---|---|
| Anything, before calling it done | `npm run check` |
| `src/`, `test/` | `npm run typecheck && npm test` |
| `plugins/ctk/hooks`, `plugins/ctk/shared`, `plugins/ctk/tests` | `claude plugin test plugins/ctk` |
| `plugins/ctk/skills`, `plugins/ctk/agents`, manifests | `node --test test/contract.test.ts test/team-skill.test.ts` and `claude plugin validate plugins/ctk --strict` |

- Plugin tests import `claude-code/testing` and load only under `claude plugin test`; `node --test`
  cannot run them. The root typecheck does not cover the plugin either. `tsc -p plugins/ctk`
  (needs the generated types) reports errors already on `main` from type drift: compare its
  error list before and after your change instead of expecting it clean.
- Call the real `claude` binary by absolute path, not a shell alias or wrapper.

## Pitfalls

- A hooks module imports only its own relative files and `claude-code`: no `node:` built-ins, no
  packages. Hash, path and time helpers are written inline.
- A `SKILL.md` is at most 60 lines (`test/contract.test.ts`).
- Docs must not contain machine-local paths (`test/docs.test.ts`).
- A new plugin option touches `shared/policy.ts`, `hooks/config.ts`, `plugin.json`, the profile in
  `src/core/schema.ts`, `OPTION_PROFILE_PATHS` in `src/install/apply.ts`, and the option lists in
  docs and `skills/ctk/SKILL.md`.
- In a `tool.call` hook, code after `await next(e)` handles its own errors: a `.catch` that calls
  `next(e)` again runs the tool twice.
