# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

### Added

- Plugin skills `/ctk:team`, `/ctk:review` and `/ctk:debug`.
- Four role agents: `explorer`, `implementer`, `reviewer` and `high-risk-reviewer`.
- Team cap: spawns beyond the limit are refused with `TEAM_CAPACITY_REACHED`.
- Team band above the prompt, with a status line fallback. Both show model, 5-hour and weekly
  usage with reset countdowns, context, cost, and (band only) tool calls, agents and tasks, laid out
  for the terminal width: full, abbreviated and essentials-only forms, whole figures dropped by rank,
  CJK and ANSI aware. When CTK's status line is configured the band drops what it shows.
- `ctk` CLI commands: `install`, `doctor`, `update`, `rollback`, `uninstall`,
  `stats` and `config`.
- `ctk sync` for git-based profile sync, with a secrets scan before publish.

See RELEASE_NOTES.md for details and docs/LIMITATIONS.md for known limitations.
