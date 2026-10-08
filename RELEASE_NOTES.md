# Claude Team Kit 0.1.0

A lightweight, token-efficient team companion for Claude Code: a plugin for
in-session workflow, a `ctk` CLI for installing and syncing your setup, and
git-based profile sync.

## Included

**Plugin (`plugins/ctk`)**

- Skills: `/ctk:team` (run a goal with a capped native agent team), `/ctk:review`
  (risk-based review of the current change), `/ctk:debug` (reproduce, minimize,
  hypothesise, fix, add a regression test).
- Agents: `explorer` (read-only scout), `implementer` (one scoped task),
  `reviewer` (medium-risk review), `high-risk-reviewer` (auth, money, migration,
  concurrency, public API, security).
- Team cap: spawns beyond the limit are refused with `TEAM_CAPACITY_REACHED`.
- Team band above the prompt, with a status line fallback.

**CLI (`ctk`)**

- `install`, `doctor`, `update`, `rollback`, `uninstall`, `stats`, `config`.
- `sync` (`init | status | pull | publish | resolve`): git-based profile sync,
  with a secrets scan before publish.

## Known limitations

See [docs/LIMITATIONS.md](docs/LIMITATIONS.md).

## Not published

The tarball is built locally; no git tag has been created. Nothing has been published to npm, GitHub
Releases or a plugin marketplace. The release workflow builds and attaches a
tarball only when a `v*` tag is pushed; `npm publish` is a manual step after
review.
