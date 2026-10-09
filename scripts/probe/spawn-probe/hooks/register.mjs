// Throwaway probe, not part of CTK: logs what Claude Code sends to `agent.spawn` for each Agent call, and
// what the next hook answered, so the boundary "which calls are teammates" can be observed instead of assumed.
// It changes nothing: every spawn is passed on untouched. The log path is CTK_PROBE_LOG (default: spawn-probe-log.json
// in the session's working directory).
const rows = []
async function note($, e, result) {
  rows.push({
    name: e.name ?? null,
    subagentType: e.subagentType,
    isTeammate: e.isTeammate ?? null,
    fork: e.fork,
    background: e.background,
    provider: e.provider,
    keys: Object.keys(e).sort(),
    result,
  })
  const path = (await $.env.get('CTK_PROBE_LOG').catch(() => undefined)) ?? 'spawn-probe-log.json'
  try {
    await $.fs.write(path, JSON.stringify(rows, null, 1))
  } catch {}
}
export const register = on => {
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    await note($, e, r.deny !== undefined ? { deny: String(r.deny).slice(0, 80) } : { agentId: r.agentId ?? null, teammateId: r.teammateId ?? null })
    return r
  })
}
