# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

### Added

- Plugin skills `/ctk:team`, `/ctk:review` and `/ctk:debug`.
- Four role agents: `explorer`, `implementer`, `reviewer` and `high-risk-reviewer`.
- Team cap: spawns beyond the limit are refused with `TEAM_CAPACITY_REACHED`.
- Team band above the prompt, with a status line fallback.
- `ctk` CLI commands: `install`, `doctor`, `update`, `rollback`, `uninstall`,
  `stats` and `config`.
- `ctk sync` for git-based profile sync, with a secrets scan before publish.

See RELEASE_NOTES.md for details and docs/LIMITATIONS.md for known limitations.
