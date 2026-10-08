# Contributing

## Setup

Node 20 or later is required to run the built CLI. Tests run `.ts` files
directly, so use Node 22.18 or later for development. CI uses Node 24.

```sh
npm ci
npm run check
```

`npm run check` runs the typecheck, the unit tests, `claude plugin test` and
`claude plugin validate --strict`.

`claude plugin test` must run against the real `claude` binary. Do not use the
interactive `claude` alias, which adds `--dangerously-skip-permissions`. Call the
binary by absolute path if `claude` on your PATH is an alias or a wrapper.

## Conventions

The full rules are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#contributor-notes). The
short version:

- TypeScript with `erasableSyntaxOnly`: no enums, parameter properties or
  namespaces. Relative imports use the `.ts` extension.
- `zod` is the only runtime dependency. Prefer `node:` built-ins.
- Tests use `node:test` and `node:assert/strict`, live in `test/**/*.test.ts`,
  and must be deterministic.
- Tests make no network calls and never touch a real `~/.claude`. Each test
  uses a temporary `configDir` and cleans it up.
- Never read, print or copy credentials. Do not read the content of
  `~/.claude.json`.
- No `TODO` stubs and no `test.skip` or `.only`.

## Commit messages

Describe what changed and why the previous behaviour was wrong. Do not add
tool attribution trailers such as `Co-Authored-By:` or "Generated with".

## Scope

Keep changes small. Do not add an abstraction without a second caller.
