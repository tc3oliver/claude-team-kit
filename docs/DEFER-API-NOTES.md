# Deferring built-in tools from the Mods API: evidence and verdict

Status: engineering notes for trimming `/context` System tools by moving rarely used tools behind ToolSearch. Claude Code 2.1.310, probed 2026-10-24.

Legend: **[live]** observed against the real engine in an isolated config; **[types]** read from `.claude-plugin/types/claude-code/index.d.ts` only; **[unverified]** inferred, not exercised.

## Verdict

**No-go for built-in tools; works for MCP tools, which are mostly deferred already.** Not worth a CTK feature.

A second run used a logged-in `claude -p --plugin-dir <probe> "/context"` (2.1.310, default config, throwaway cwd), once with the hook passing through and once deferring `ReportFindings`, `ScheduleWakeup`, `Workflow`, `ListAgents` and three `mcp__claude_ai_Claude_Docs__*` tools [live]:

| `/context` row | pass-through | deferring 7 tools |
|---|---|---|
| System tools | 4.4k | 4.4k |
| System tools (deferred) | 17k | 17k |
| MCP tools (deferred) | 1.8k | 2.4k |

- The hook fires once per tool and the engine reads its answer: the log shows `isDeferred` going from absent to `true` for all seven [live].
- Built-ins: the engine ignores the answer; neither System tools row moved [live]. Most built-ins already arrive deferred (`e.isDeferred: true` for Cron*, Task*, Web*, Monitor, NotebookEdit and others) [live].
- MCP: honoured; the three Claude Docs tools (~0.6k) moved behind ToolSearch [live]. Every other MCP tool already arrived deferred, so the gain per project is a few hundred tokens.
- Only `-p` was measured. The interactive session lists more always-loaded tools (19.2k there against 4.4k here); whether the engine honours the hook for those is **[unverified]**, but nothing above suggests it treats them differently from the `-p` built-ins.

The first run, in an isolated config without a login, is kept below for the method.

## What blocked the live run

The isolated config (`CLAUDE_CONFIG_DIR` in a temporary directory, private tmux socket, `~/.local/bin/claude --plugin-dir`) has no login. `claude -p` answers `Not logged in`, and the interactive start stops at the theme and login onboarding, before any plugin loads, so `/context` is unreachable [live]. Credentials were deliberately not copied into the probe config.

Observed [live]: `claude plugin validate --strict` passes for a plugin whose module registers `on('tool.describe', {}, ...)` returning `isDeferred`. Validation shows the hook is accepted statically, not that the engine honours it.

## The probe (to re-run with a logged-in config)

Module, `hooks.json` = `{ "modules": ["./register.mjs"] }`, plugin name `deferprobe`:

```js
const rows = []
export const register = on => {
  on('tool.describe', {}, async ($, e, next) => {
    const on_ = ((await $.env.get('DEFER_MODE').catch(() => undefined)) ?? 'off') === 'on'
    const r = await next(e)
    const out = on_ && ['NotebookEdit', 'WebFetch'].includes(e.tool) ? { ...r, isDeferred: true }
              : on_ && e.tool === 'Monitor' ? { ...r, isDeferred: false } : r
    rows.push({ tool: e.tool, in: e.isDeferred ?? false, provider: e.provider, out: out.isDeferred ?? null })
    try { await $.fs.write(await $.env.get('DEFER_LOG'), JSON.stringify(rows, null, 1)) } catch {}
    return out
  })
}
```

Run twice (`DEFER_MODE=off`, then `on`), each: start the session, run `/context`, record System tools tokens, then ask the model to use NotebookEdit and WebFetch. Compare the two logs and the two `/context` outputs.

## Claims

### What the types say [types]

1. `tool.describe` fires "when the engine first renders the tool's schema in a session" and resolves `{ description, isDeferred? }`. `isDeferred: true` moves the tool behind ToolSearch, `false` into the prompt's list; omitted keeps the engine's placement (`ToolDescribeResult`, `ToolDeferral`).
2. The input carries `provider`; a built-in is `{ plugin: "engine", tier: "core" }`, and `provider` is pinned (a rewrite is refused). `isDeferred` is not pinned, so built-ins are not excluded by the type [types]. Whether the engine refuses it for a core tool at runtime is **[unverified]**.
3. Input `isDeferred?: true` is present when the engine already lists the tool behind ToolSearch: by rule an MCP server's tool, or one that asks to be (c: MCP is covered by the same event, "twice for an MCP tool behind ToolSearch: its short text, then the one loaded") [types].
4. A tool registered by `$.tool.register` takes `isDeferred` in its spec; "a `tool.describe` hook's answer is read first" [types].
5. (e) The answer is "cached for the session until `$.ui.invalidate("tool.describe")`: an unstable answer spends the model's prompt cache" [types]. So the placement is fixed at first render; a stable answer from session start should cost nothing extra, and an invalidate mid-session would rewrite the tool list and break the cache [types]. Measured effect **[unverified]**.
6. `/context` rows have `isDeferred` / `kind: deferred`, and "the grid leaves out" deferred tool schemas. This is why a drop in System tools is expected [types].

### Questions (a) to (e)

| | Question | Answer |
|---|---|---|
| a | `/context` System tools drops, by how much | expected yes by the schema size of each moved tool, **number [unverified]** |
| b | Model can still reach the deferred tool through ToolSearch | by design ("its schema loads when the model asks for it by name") [types]; **[unverified]** for a built-in |
| c | Works for MCP tools | MCP tools already default to deferred and the same hook sees them, so `isDeferred: false` pins one in front [types]; **[unverified]** |
| d | Applies to subagents | The types say nothing about per-agent scope; whether a subagent's tool list honours the hook, and whether it can reach ToolSearch, is **[unverified]** |
| e | Cache impact only at session start | per claim 5, yes if the answer is stable [types]; **[unverified]** |

### Risks to settle before building [unverified]

- A deferred built-in that the model needs every turn (Bash, Edit) would cost a ToolSearch round trip each session; only rarely used tools such as NotebookEdit and WebFetch are candidates.
- Permission rules or agent `tools:` allowlists may interact with a deferred tool; not exercised.
- Reload behaviour: a module reload (see `CONFIG-API-NOTES.md`) re-runs `tool.describe` only if the cache is invalidated; not exercised.

## Cleanup

Probe plugin, isolated config, scratch repo, and the private tmux socket directory were created under temporary directories and removed after the run. Nothing was written to the repo except this file, and nothing under `~/.claude`.
