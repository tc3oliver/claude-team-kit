# Comparison with related projects

This page compares CTK with five related things, using facts that can be checked against a
public source. It does not rank them. Each project is best at something different, and the
last section says when another one is the better choice than CTK.

Compared: CTK (this repository), Claude Code's native **Agent Teams**,
**oh-my-claudecode** (OMC), **obra/superpowers**, **mattpocock/skills** and
**jarrodwatts/claude-hud**.

## Scope and method

- Facts were collected on 2026-10-08 from each project's README and files (fetched with
  `gh api`), the Claude Code Agent Teams documentation page, and the locally installed OMC
  plugin cache. Nothing from the plugin cache was executed and no credential file was opened.
- **OMC version.** The OMC statements about the plugin (skills, hooks, HUD source) describe
  **OMC 5.3.0**, the version in the local plugin cache. Upstream is newer: the repository's
  `package.json` is 5.6.2 and the latest release tag is v5.6.2 (published 2026-10-06). Versions
  newer than 5.3.0 were **not** examined, so any statement below may have changed.
- Versions seen for the others: superpowers 6.4.2 (`plugin.json`), mattpocock/skills 1.3.1
  (`plugin.json`). The claude-hud version was not checked. All four repositories are MIT licensed
  (GitHub API); CTK is MIT (`LICENSE`).
- No performance, cost or total-token comparison is made. Fixed context for CTK and OMC is
  discussed, with its limits, in the [README](../README.md#differences-from-oh-my-claude-code).
- "Not stated" means the sources listed here do not say. It is not a claim that the feature is
  absent.

## What each project is

| Project | Self-description (source) | Delivery |
|---|---|---|
| CTK 0.1.0 | "A lightweight, token-efficient, portable team companion for Claude Code." (`README.md`) | Claude Code plugin, Node CLI, status line script |
| Agent Teams | "Coordinate multiple Claude Code instances working together as a team, with shared tasks, inter-agent messaging, and centralized management." (code.claude.com/docs/en/agent-teams) | Built into Claude Code; experimental, off by default, enabled with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` |
| OMC | "Teams-first Multi-agent orchestration for Claude Code" (GitHub description); "Multi-agent orchestration for Claude Code. Zero learning curve." (`README.md`) | Claude Code plugin, optional npm CLI, MCP server, HUD |
| superpowers | "An agentic skills framework & software development methodology that works." (GitHub description) | Plugin of skills plus one `SessionStart` hook |
| mattpocock/skills | "Skills for Real Engineers. Straight from my .agents directory." (README) | Skills only |
| claude-hud | "A Claude Code plugin that shows what's happening: context usage, rate limits, active tools, running agents, and todo progress, always visible below your input." (README) | Plugin whose setup points `statusLine` at the HUD command |

## Components

Counts are from the sources named in the last column.

| Project | Skills | Agents | Hooks | MCP server | Source |
|---|---|---|---|---|---|
| CTK | 3 | 4 | `Hooks (0)` in `claude plugin details`; one in-process mod | none | `plugin/ctk/`, `claude plugin details ctk@ctk-kit` |
| Agent Teams | n/a | uses subagent definitions as teammate roles | events `TeammateIdle`, `TaskCreated`, `TaskCompleted` | n/a | agent-teams page |
| OMC 5.3.0 | 37 listed in `plugin.json` | 19 (`agents/*.md`) | 25 hook commands over 11 events in `hooks/hooks.json` | 1 (`t`, `node bridge/mcp-server.cjs`, `.mcp.json`) | local cache, `5.3.0/` |
| superpowers 6.4.2 | 15 `skills/*/SKILL.md` | none in the repository tree | 1 command hook (`SessionStart`, matcher `startup\|clear\|compact`) | none seen in the tree | repository tree, `hooks/hooks.json` |
| mattpocock/skills 1.3.1 | 27 listed in `plugin.json` | none seen | none seen | none seen | `.claude-plugin/plugin.json`, repository tree |
| claude-hud | 2 commands (`/claude-hud:setup`, `/claude-hud:configure`) | none | none | none | README |

OMC's own `docs/HOOKS.md` (line 3) says "OMC's 21 hooks", a different count from the 25 commands
in `hooks.json`. The difference was not resolved.

## What each adds to Claude Code

- **CTK** (per its README and `docs/ARCHITECTURE.md`): a hard cap on live teammates, enforced by
  denying spawns in a mod; model routing by role; three skills (`team`, `review`, `debug`); four
  agent definitions; a one-line team band; and a CLI that installs reversibly (ledger, backups,
  rollback) and syncs a profile through a plain git repository with a secret scan. It has no
  orchestrator of its own.
- **Agent Teams**: a lead session, teammates in separate context windows, a shared task list with
  dependencies, mailboxes, in-process or tmux/iTerm2 display modes, and per-teammate permissions
  (agent-teams page).
- **OMC** (as its README states it): a staged team pipeline `team-plan -> team-prd -> team-exec ->
  team-verify -> team-fix`; autopilot, ralph, ralplan, deep-interview and ultragoal workflows;
  keyword triggers; `omc team N:codex|gemini|antigravity|grok|cursor|claude`, which starts real
  CLI workers in tmux panes; model routing; learned skills; project memory, notepad and wiki
  tools through the MCP server; a HUD; and Telegram, Discord and Slack notifications.
- **superpowers** (README): a prescribed workflow (brainstorm, git worktree, written plan,
  subagent-driven or inline execution, test-driven development, code review, finish branch),
  loaded at session start so its skills trigger automatically ("Mandatory workflows, not
  suggestions."). It uses subagents, not Agent Teams, as far as the README states.
- **mattpocock/skills** (README): small, editable skills such as `grill-me`, `grill-with-docs`,
  `to-spec`, `to-tickets`, `implement`, `implement-spec`, `wayfinder`, `tdd`, `diagnosing-bugs`,
  `code-review`, `triage` and `handoff`. It contrasts itself with approaches that "own the
  process". It needs a one-time `/setup-matt-pocock-skills` per repository.
- **claude-hud**: display only: context bar, usage windows, git/jj state, and optional tools,
  agents, todos, skills and MCP lines, a cost ledger, prompt-cache expiry and effort level
  (README).

## Worker limits and model routing

| Project | Concurrent-worker limit | Model selection |
|---|---|---|
| CTK | `maxWorkers`, default 3, maximum 12; a spawn above it is denied with `TEAM_CAPACITY_REACHED` (`docs/ARCHITECTURE.md`) | By role through the mod; an explicit model is never overridden |
| Agent Teams | "There's no hard limit on the number of teammates, but practical constraints apply"; "Start with 3-5 teammates for most workflows." | Spawn prompt, then definition `model`, then `CLAUDE_CODE_SUBAGENT_MODEL`, then the lead's model; "If an installed mod sets a model in its `agent.spawn` hook, Claude Code uses that model in place of the first source." |
| OMC 5.3.0 | For `omc team`: 20 (`MAX_WORKER_COUNT`); `ops.maxAgents` exists in the schema but "the current launcher does not consult it" (`skills/team/SKILL.md`, line 894). A cap on native Agent Teams spawns: not stated | Yes, "smart model routing" (README; its "saves 30-50% on tokens" claim was not verified here) |
| superpowers | Not stated | Not stated |
| mattpocock/skills | Not stated (`implement-spec` mentions "maximum concurrency" without a cap; the skill body was not read) | Not stated |
| claude-hud | Not applicable; it shows running agents and does not limit them | Not applicable |

## HUD and status data sources

This row matters for anyone who runs a status line, because a status line command runs on every
refresh. Each entry below is what the project's own documentation or source shows.

| Project | Data read | Network, credentials | Source |
|---|---|---|---|
| CTK | The JSON that Claude Code passes to a `statusLine` command on stdin; `.git/HEAD` and the repository's git config files; one `git status`. The team band uses the public Mods API (roster, session usage). | No network calls. No credential reads. No OAuth or usage API. | `docs/ARCHITECTURE.md`, `docs/THREAT-MODEL.md`; `claude plugin validate plugin/ctk --strict` lists the mod's host calls |
| OMC 5.3.0 | Claude Code's stdin JSON, the session transcript, `.omc/state/**` files, and rate limits fetched by `getUsage()` | **Reads Claude Code's stored OAuth credential** (macOS Keychain item "Claude Code-credentials", otherwise `~/.claude/.credentials.json`), **calls `GET api.anthropic.com/api/oauth/usage`** with the bearer token, and when the credential is expired **refreshes it and writes the refreshed tokens back** to the Keychain or the credentials file. On by default (`rateLimits: true`). For third-party base URLs it can also read `ANTHROPIC_AUTH_TOKEN` and other provider keys and call z.ai, MiniMax and Kimi usage endpoints. | `dist/hud/usage-api.js` (header comment lines 3-12; request at lines 610-618; token refresh at line 34 and lines 1665-1675; write-back at lines 721-840; third-party endpoints from line 1598); `dist/hud/index.js` lines 277-283; `dist/hud/types.js` line 96 |
| claude-hud | Claude Code's stdin; optionally the session transcript, Claude settings files, git/jj metadata; with `display.showAuth`, the `oauthAccount` block of `~/.claude.json`; with `display.externalUsagePath`, a local file you supply | Its README says: "Claude HUD is local-only. It makes no network requests, never reads credentials, and calls no undocumented APIs." A text search of its `src/**/*.ts` found no network calls and no Keychain or `.credentials` access; the only `http` strings are for provider-label detection (`src/stdin.ts`) and a displayed github.com link (`src/git.ts`). `src/auth.ts` reads account metadata (plan, name) from `~/.claude.json` only when `display.showAuth` is on. | README "How It Works" and "Security"; `src/**/*.ts` |

Notes on the OMC entry:

- The OMC 5.3.0 `README.md`, `SECURITY.md` and `docs/*.md` contain no mention of the credential
  read or the endpoint (a search for `oauth/usage` and `Claude Code-credentials` in the Markdown
  files found nothing). It is visible in the source.
- Whether `api.anthropic.com/api/oauth/usage` is a documented Anthropic API was not confirmed
  either way. The file describes it as "Anthropic's OAuth API" and sends the header
  `anthropic-beta: oauth-2025-04-20`.
- The same file's header says it is "Based on claude-hud implementation by jarrodwatts". The
  claude-hud source checked for this page contains no such code.
- The code was read in 5.3.0 only. Whether 5.6.2 still contains it was not checked.

Notes on the claude-hud entry: the source check was a text search. Dependencies, built output,
tags and non-default branches were not inspected, and the `--extra-cmd` option (which runs a shell
command on each refresh only when `CLAUDE_HUD_ALLOW_EXTRA_CMD=1`) was not audited.

## Cross-machine configuration and install

| Project | Cross-machine config sync | Reversible installer | Install (Claude Code) |
|---|---|---|---|
| CTK | `ctk sync` through a plain git repository; three-way merge; secret scan before publish | Yes: ledger, backups, `ctk rollback`, `ctk uninstall` | `ctk install` from a checkout (`npm install`, `npm run build` first) |
| Agent Teams | None on the page; "There is no project-level equivalent of the team config." | n/a | Set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` |
| OMC | Not stated (config files `.claude/omc.jsonc` and `~/.config/claude-omc/config.jsonc`; project skills in `.omc/skills/` can be committed) | Not stated | `/plugin marketplace add https://github.com/Yeachan-Heo/oh-my-claudecode`, `/plugin install oh-my-claudecode`, `/omc-setup` |
| superpowers | Not stated | Not stated | `/plugin install superpowers@claude-plugins-official` |
| mattpocock/skills | Not stated (plugin self-update, or `npx skills@latest add/update`) | Not stated | `claude plugin install mattpocock-skills@claude-plugins-official`, then `/setup-matt-pocock-skills` |
| claude-hud | Not stated (per-directory override file only) | Not stated | `/plugin marketplace add jarrodwatts/claude-hud`, `/plugin install claude-hud`, `/claude-hud:setup` |

Other facts that affect the choice:

- **Agent Teams limitations** (agent-teams page): experimental; no session resumption with
  in-process teammates; one team per session; no nested teams; split panes are not supported in
  VS Code's integrated terminal, Windows Terminal or Ghostty; spawning teammates needs an
  interactive session. The page also states that "Agent teams use significantly more tokens than
  a single session."
- **OMC runtime**: Node 20 to 26 (`package.json` engines); `omc team N:codex` and similar need
  tmux and the relevant CLI; named autopilot workflow profiles need Linux with `flock` (README).
- **superpowers telemetry** (README, "Visual companion telemetry"): by default the logo on the
  optional visual companion loads from the project's website and includes the version; disable it
  with `SUPERPOWERS_DISABLE_TELEMETRY` (it also honours `DISABLE_TELEMETRY` and
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`). superpowers lists many other harnesses as supported.
- **claude-hud runtime**: Node.js 18+ or Bun on macOS and Linux, Node 18+ on Windows; Claude Code
  v2.1.260 or later (README "Requirements").
- **CTK** needs Claude Code >= 2.1.287 for the cap and band, and depends on experimental Agent
  Teams and early-access mods (see the [README](../README.md#experimental-or-early-access-dependencies)).
  It adds nothing for non-Claude workers.

## When another project is the better choice

- **Native Agent Teams alone.** If a team of Claude sessions with a shared task list is all that
  is needed and no spawn cap, role-based model routing or status band is wanted, Agent Teams
  needs nothing beyond the experimental flag. CTK depends on it and does not replace it.
- **superpowers or mattpocock/skills.** These are methodology libraries: sets of skills that
  prescribe or support how to plan, test and review. CTK has no opinion on methodology beyond
  three short skills, and it does not conflict with them in principle. They can be installed
  next to CTK (this combination was not tested). Choose them for the method, in the form each
  describes: a prescribed automatic workflow (superpowers) or small editable skills that leave
  process control with the user (mattpocock/skills). mattpocock/skills ships no hooks or HUD.
- **OMC.** Choose it for a large set of ready-made workflows (autopilot, ralph, ralplan, a staged
  team pipeline, deep interview), its MCP-backed memory and state tools, notifications, and the
  ability to start Codex, Gemini, Cursor and other vendors' CLIs as tmux workers. CTK provides
  none of these.
- **claude-hud.** Choose it for a stand-alone status line with many display options. It does not
  orchestrate or limit anything, and it can be used with or without CTK; CTK's own status line
  is only a fallback and its team band needs mods.
- **CTK.** Choose it when the wanted pieces are a hard cap on concurrent teammates, role-based
  model routing, a small fixed context, a reversible installer, and git-backed settings sync, and
  when depending on experimental and early-access Claude Code features is acceptable.

## Not verified

- OMC: behaviour of 5.6.2 (the repository HEAD) versus 5.3.0, including whether the HUD credential
  and usage-endpoint code is still present; the 21-versus-25 hook count; OMC's token-saving claim.
- superpowers: skill bodies, and whether it has MCP, agents or other hooks beyond the tree and
  `hooks/hooks.json`.
- mattpocock/skills: skill bodies, `implement-spec` concurrency, hooks beyond the tree and
  `plugin.json`.
- claude-hud: dependencies, built output, other branches, the version number.
- Agent Teams: one documentation page, summarised by a fetch tool before quoting; not
  cross-checked against the raw Markdown. The `statusline` documentation page was not read.
- CTK's own claims (the cap observed live on Claude Code 2.1.294, the ~187-token fixed context)
  come from this repository's documentation and `claude plugin details`.
- Repository metadata (descriptions, licences, versions) can change at any time; the date above
  is the date it was read.

## How to verify these claims yourself

Requires the GitHub CLI (`gh`), authenticated. These commands only read public data.

```bash
# OMC: description, licence, last push, current version, latest release
gh api repos/Yeachan-Heo/oh-my-claudecode --jq '[.description,.license.spdx_id,.pushed_at]|@tsv'
gh api repos/Yeachan-Heo/oh-my-claudecode/contents/package.json --jq .content | base64 -d | grep -m1 '"version"'
gh api repos/Yeachan-Heo/oh-my-claudecode/releases/latest --jq '[.tag_name,.published_at]|@tsv'

# superpowers: version, hook registration, skills
gh api repos/obra/superpowers/contents/.claude-plugin/plugin.json --jq .content | base64 -d | grep -m1 '"version"'
gh api repos/obra/superpowers/contents/hooks/hooks.json --jq .content | base64 -d
gh api 'repos/obra/superpowers/git/trees/HEAD?recursive=1' --jq '.tree[].path' | grep -c 'skills/.*/SKILL.md'

# mattpocock/skills: version and listed skills
gh api repos/mattpocock/skills/contents/.claude-plugin/plugin.json --jq .content | base64 -d

# claude-hud: licence, README claim, source search (shallow clone into a new directory)
gh api repos/jarrodwatts/claude-hud --jq '[.license.spdx_id,.default_branch]|@tsv'
gh api repos/jarrodwatts/claude-hud/readme --jq .content | base64 -d | grep -n 'local-only'
git clone --depth 1 https://github.com/jarrodwatts/claude-hud.git /tmp/claude-hud-src
grep -rnE 'https?://|fetch\(|https\.request|Keychain|find-generic-password|\.credentials|api/oauth' /tmp/claude-hud-src/src
```

OMC 5.3.0 HUD source (read-only; the file is plugin source, not a credential). Install 5.3.0 from
the OMC marketplace or use an existing cache, then:

```bash
OMC=~/.claude/plugins/cache/omc/oh-my-claudecode/5.3.0
ls "$OMC"                                              # confirm the version directory
grep -n 'api/oauth/usage\|Claude Code-credentials\|\.credentials\.json' "$OMC/dist/hud/usage-api.js"
grep -n 'refreshAccessToken\|writeBackCredentials' "$OMC/dist/hud/usage-api.js"
grep -n 'getUsage\|rateLimits' "$OMC/dist/hud/index.js" "$OMC/dist/hud/types.js"
grep -rn 'oauth/usage\|Claude Code-credentials' "$OMC"/*.md "$OMC"/docs/*.md   # expect no output
jq '.skills | length' "$OMC/.claude-plugin/plugin.json"
ls "$OMC/agents" | wc -l
jq '[.hooks[][] | .hooks[]] | length' "$OMC/hooks/hooks.json"
sed -n '894p' "$OMC/skills/team/SKILL.md"              # worker cap statement
```

For a newer OMC version, repeat the same greps against the downloaded source of that version and
compare. The line numbers above apply to 5.3.0 only.

Agent Teams statements: read https://code.claude.com/docs/en/agent-teams (sections on display
modes, model selection, best practices and limitations). CTK statements: `claude plugin validate
plugin/ctk --strict` for the mod's host calls and `claude plugin details ctk@ctk-kit` for the
fixed-context estimate.
