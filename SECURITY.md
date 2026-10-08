# Security policy

## Supported versions

Claude Team Kit is pre-release. Only the latest commit on `main` is supported. Fixes are not
backported.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: open the repository's **Security** tab
and choose **Report a vulnerability** (a private security advisory). Do not open a public issue
or pull request for a vulnerability.

Include:

- the CTK version (`ctk --version`), your OS, and the Claude Code version (`claude --version`);
- what you did, what you expected and what happened;
- whether the issue needs a hostile repository, a hostile profile repository or a second tool
  editing `settings.json`.

Redact credentials, tokens and the contents of your `settings.json` before attaching anything.

Reports are handled on a best-effort basis by volunteers. There is no response-time guarantee.
Once a fix is merged, the advisory can be published with credit if you want it.

## Scope

In scope: the `ctk` CLI, the `ctk` Claude Code plugin (mod, skills, agents, status line), the
installer's ownership and rollback logic, and git profile sync (secrets scanning, path handling,
git invocation).

Out of scope: vulnerabilities in Claude Code itself, in Node.js, git or other dependencies (report
those upstream), and issues that need an attacker who already controls your user account or your
Claude Code config directory.

## What CTK does and does not touch

The [threat model](docs/THREAT-MODEL.md) lists what CTK reads and writes, what it never touches
(credentials, `~/.claude.json` contents, transcripts), how secrets are handled in sync, and the
known limitations.
