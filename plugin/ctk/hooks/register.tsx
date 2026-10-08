import type { EngineInterface, Register } from 'claude-code'

import { readOptions } from '../shared/policy.ts'
import type { PolicyOptions } from '../shared/policy.ts'
import { emptyStats, safeSessionId } from '../shared/stats.ts'
import type { StatsRecord } from '../shared/stats.ts'
import { formatBand, formatSummary } from './band.ts'
import { capacityDeny, emptySnapshot, guardDeny, isLiveTeammate, measuredOf, routed, snapshotOf } from './team.ts'
import type { Snapshot } from './team.ts'

// Every host call is here because `$` may only be handed to top-level functions of this
// file. Anything pure (cap text, routing, snapshot math, band text) is in team.ts / band.ts.
// Each host call degrades on failure: a stats or HUD problem never touches a spawn, and
// the cap itself fails closed.

const STATUS_TOOL = 'ctk_team_status'
const STATS_WRITE_GAP_MS = 2000

type Ctx = {
  opts: PolicyOptions
  stats: StatsRecord
  snap: Snapshot
  /** Spawns that passed the cap and have not returned yet; bumped before the first await. */
  inflight: number
  /** False until the first refresh: the band draws nothing before it has figures. */
  ready: boolean
  dirty: boolean
  lastWrite: number
}

async function configDir($: EngineInterface): Promise<string | null> {
  const explicit = await $.env.get('CLAUDE_CONFIG_DIR')
  if (explicit) return explicit
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
  return home ? `${home}/.claude` : null
}

// Throttled to one write per STATS_WRITE_GAP_MS; a change inside the gap is written by the
// next state change, turn end or (forced) session end.
async function persist($: EngineInterface, c: Ctx, force = false) {
  if (!c.opts.recordStats || !c.dirty) return
  try {
    const now = await $.clock.now()
    if (!force && now - c.lastWrite < STATS_WRITE_GAP_MS) return
    const dir = await configDir($)
    if (dir === null) return
    c.lastWrite = now
    c.dirty = false
    c.stats.updatedAt = now
    await $.fs.write(`${dir.replace(/[\\/]+$/, '')}/ctk/stats/${safeSessionId(c.stats.sessionId)}.json`, `${JSON.stringify(c.stats)}\n`)
  } catch {
    // A stats failure must never affect a spawn or the HUD.
  }
}

// Re-reads the roster and usage, then redraws the band and writes stats. Never throws.
async function refresh($: EngineInterface, c: Ctx) {
  try {
    const [agents, usage, now] = await Promise.all([
      $.agent.list().catch(() => null),
      $.session.usage().catch(() => null),
      $.clock.now().catch(() => 0),
    ])
    c.snap = snapshotOf(agents, usage, now)
    if (usage !== null) c.stats.measured = measuredOf(usage)
    if (c.snap.live !== null) c.stats.peakLive = Math.max(c.stats.peakLive, c.snap.live)
    c.ready = true
    c.dirty = true
    if (c.opts.hudBand) $.ui.invalidate('ui.render')
  } catch {
    // Band and stats are best effort.
  }
  await persist($, c)
}

async function liveTeammates($: EngineInterface): Promise<number> {
  return (await $.agent.list()).filter(isLiveTeammate).length
}

async function boot($: EngineInterface, c: Ctx) {
  try {
    const now = await $.clock.now()
    c.stats = { ...emptyStats(await $.session.id(), c.opts.maxWorkers, now) }
    c.lastWrite = 0
  } catch {
    // Keep the placeholder session id; counters still work.
  }
  await refresh($, c)
}

export const register: Register = (on, options) => {
  const opts = readOptions(options)
  const c: Ctx = {
    opts,
    stats: emptyStats('unknown', opts.maxWorkers, 0),
    snap: emptySnapshot(),
    inflight: 0,
    ready: false,
    dirty: false,
    lastWrite: 0,
  }

  // Hard cap on live teammates. `inflight` is bumped synchronously before the first await,
  // so concurrent spawns from one assistant message each see the others' reservations. A
  // spawn that has started but not yet released its reservation may be counted twice: the
  // cap errs toward refusing, never over. Only teammate spawns are gated.
  on('agent.spawn', async ($, e, next) => {
    if (e.isTeammate !== true) return next(routed(e, c.opts))

    c.inflight += 1
    let held = true
    const release = () => {
      if (held) {
        held = false
        c.inflight -= 1
      }
    }

    try {
      const live = await liveTeammates($)
      if (live + c.inflight > c.opts.maxWorkers) {
        const starting = c.inflight - 1
        release()
        c.stats.spawnsRejected += 1
        await refresh($, c)
        return { deny: capacityDeny(live, starting, c.opts.maxWorkers) }
      }
      const started = await next(routed(e, c.opts))
      release()
      // Accepted is verified, not assumed: a result without both ids did not start a teammate.
      if (started.deny === undefined && started.agentId !== undefined && started.teammateId !== undefined) {
        c.stats.spawnsAccepted += 1
        c.stats.workerModels[started.model] = (c.stats.workerModels[started.model] ?? 0) + 1
      }
      await refresh($, c)
      return started
    } finally {
      release()
    }
  }).catch(($, e, next) => {
    if (next.called) return next(e)
    if (e.isTeammate !== true) return next(e)
    c.stats.spawnsFailedClosed += 1
    return { deny: guardDeny() }
  })

  on('session.start', async ($, e, next) => {
    try {
      await $.tool.register({
        name: STATUS_TOOL,
        description: 'Live CTK team state: workers, cap, accepted and refused spawns.',
      })
    } catch {
      // Without the tool the Agent result's teammate_id still confirms a spawn.
    }
    try {
      await $.command.register({ name: 'ctk-stats', description: 'Show CTK team stats for this session.' })
    } catch {
      // Without the command `ctk stats` still reads the stats file.
    }
    const r = await next(e)
    await boot($, c)
    return r
  })

  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    await refresh($, c)
    return r
  })

  // Teammate status changes raise no session.measure; turn ends do.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    await refresh($, c)
    return r
  })

  on('session.end', async ($, e, next) => {
    await persist($, c, true)
    return next(e)
  })

  // Read-only counters: these never block a task.
  on('classic.TaskCreated', async ($, e, next) => {
    c.stats.tasks = { created: (c.stats.tasks?.created ?? 0) + 1, completed: c.stats.tasks?.completed ?? 0 }
    await refresh($, c)
    return next(e)
  })

  on('classic.TaskCompleted', async ($, e, next) => {
    c.stats.tasks = { created: c.stats.tasks?.created ?? 0, completed: (c.stats.tasks?.completed ?? 0) + 1 }
    await refresh($, c)
    return next(e)
  })

  on('tool.call', { tool: 'mcp__ctk__ctk_team_status' }, async ($, e, next) => {
    await refresh($, c)
    const status = {
      live: c.snap.live,
      max: c.opts.maxWorkers,
      workers: c.snap.workers,
      rejected: c.stats.spawnsRejected,
      accepted: c.stats.spawnsAccepted,
    }
    return { result: { content: [{ type: 'text', text: JSON.stringify(status) }], isError: false } }
  })

  on('command.run', { command: 'ctk-stats' }, async ($, e, next) => {
    await refresh($, c)
    return { text: formatSummary(c.stats, c.snap) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!c.opts.hudBand || !c.ready || e.props.hasSurvey) return next(e)
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{formatBand(c.stats, c.snap, e.props.bodyColumns)}</Text>
  })
}
