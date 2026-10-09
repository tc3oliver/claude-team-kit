# Spawn probe

A throwaway plugin that logs, for every Agent call, what Claude Code hands to the `agent.spawn` hook: whether
`isTeammate` is set, the name, the agent type, the provider, and whether the call was started or denied. CTK's worker
limit gates only spawns with `isTeammate`, so this is how to check, on a given Claude Code version, which calls that is.

It is not part of the plugin or the npm package (`scripts/` is not packaged) and it never changes a spawn.

## Run it (about 5 minutes, a few cents)

Use a dedicated, logged-in config directory and a scratch git repository, never `~/.claude`:

```sh
git init -q /tmp/probe-work && cd /tmp/probe-work && echo hi > a.txt && git add -A && git commit -qm init
CLAUDE_CONFIG_DIR=<dedicated config dir> CTK_PROBE_LOG=/tmp/probe-log.json \
  claude --plugin-dir <this repo>/scripts/probe/spawn-probe --model haiku
```

With Agent Teams on (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in that config's settings) and CTK installed with
`maxWorkers` 1, ask the session to make these Agent calls one at a time, each with the prompt "Reply ok":

1. `name: probe-a`, `subagent_type: ctk:explorer`
2. `name: probe-b`, `subagent_type: ctk:explorer`, `isolation: worktree`
3. `name: probe-c`, `subagent_type: ctk:explorer`
4. no name, `subagent_type: ctk:explorer`
5. `name: probe-d`, `subagent_type: general-purpose`

Then print the table:

```sh
node -e 'for (const x of JSON.parse(require("fs").readFileSync("/tmp/probe-log.json","utf8"))) console.log(String(x.name).padEnd(9), x.subagentType.padEnd(16), "isTeammate=" + x.isTeammate, JSON.stringify(x.result).slice(0, 100))'
```

Result on Claude Code 2.1.295 (see [docs/REVIEW.md](../../docs/REVIEW.md#hard-limit-coverage-probe)): calls 1, 3 and 5 carry
`isTeammate: true` (3 and 5 are refused with `TEAM_CAPACITY_REACHED` while probe-a is alive, idle or not); calls 2 and 4
carry no `isTeammate` and start above the cap. If a later version prints something else, the limit's coverage changed:
update `docs/ARCHITECTURE.md` (What the cap covers) before releasing.
