// Per-session counters written by the mod and read by `ctk stats`.
// Only figures Claude Code reports through its public mod API. Nothing here is a
// per-worker cost: Claude Code exposes none, so none is invented.

export const STATS_SCHEMA_VERSION = 1

export type StatsRecord = {
  schemaVersion: typeof STATS_SCHEMA_VERSION
  sessionId: string
  /** Epoch ms of the first write for this session. */
  startedAt: number
  /** Epoch ms of the latest write. */
  updatedAt: number
  /** Configured cap. */
  maxWorkers: number
  /** Teammate spawns that Claude Code accepted. */
  spawnsAccepted: number
  /** Teammate spawns CTK refused with TEAM_CAPACITY_REACHED. */
  spawnsRejected: number
  /** Teammate spawns refused for any other CTK reason (guard failure). */
  spawnsFailedClosed: number
  /** Every `agent.spawn` event the guard saw, teammate or not: proof that Claude Code reaches it. */
  spawnsSeen: number
  /** Named agents Claude Code started as ordinary subagents while Agent Teams were on (a call with `isolation` is one): outside the cap. */
  spawnsOutsideCap: number
  /** Highest number of simultaneously live teammates seen at a spawn decision. */
  peakLive: number
  /** Resolved model per accepted spawn, as reported by Claude Code: counts by model id/alias. */
  workerModels: Record<string, number>
  /** Counts from TaskCreated / TaskCompleted events; null when no such event ever fired. */
  tasks: { created: number; completed: number } | null
  /**
   * Tool calls the model made this session, counted from `tool.call` events: the lead, its
   * subagents and its teammates together, each tool_use_id once, including calls a hook then denied.
   */
  toolCalls: number
  /** Latest measured figures; null when Claude Code did not report them. */
  measured: {
    costUsd: number | null
    contextPct: number | null
    fiveHourPct: number | null
    sevenDayPct: number | null
    /** ISO 8601 reset time of each window, as Claude Code reported it; null when it did not. */
    fiveHourResetsAt: string | null
    sevenDayResetsAt: string | null
    /** The session's model id, as `$.session.model()` returns it. */
    model: string | null
  }
}

const EMPTY_MEASURED = (): StatsRecord['measured'] => ({
  costUsd: null,
  contextPct: null,
  fiveHourPct: null,
  sevenDayPct: null,
  fiveHourResetsAt: null,
  sevenDayResetsAt: null,
  model: null,
})

export const emptyStats = (sessionId: string, maxWorkers: number, now: number): StatsRecord => ({
  schemaVersion: STATS_SCHEMA_VERSION,
  sessionId,
  startedAt: now,
  updatedAt: now,
  maxWorkers,
  spawnsAccepted: 0,
  spawnsRejected: 0,
  spawnsFailedClosed: 0,
  spawnsSeen: 0,
  spawnsOutsideCap: 0,
  peakLive: 0,
  workerModels: {},
  tasks: null,
  toolCalls: 0,
  measured: EMPTY_MEASURED(),
})

/** Session ids become file names; keep them to a safe charset. */
export const safeSessionId = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'unknown'

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)

/** Narrow unknown JSON to a StatsRecord, or null. Used by the CLI on files it did not just write. */
export const parseStats = (raw: unknown): StatsRecord | null => {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Partial<StatsRecord>
  if (r.schemaVersion !== STATS_SCHEMA_VERSION || typeof r.sessionId !== 'string') return null
  if (typeof r.spawnsAccepted !== 'number' || typeof r.spawnsRejected !== 'number') return null
  // Files written by an earlier version lack the newer fields: fill them, never guess them.
  return {
    ...(r as StatsRecord),
    toolCalls: typeof r.toolCalls === 'number' && r.toolCalls >= 0 ? r.toolCalls : 0,
    spawnsSeen: count(r.spawnsSeen),
    spawnsOutsideCap: count(r.spawnsOutsideCap),
    measured: { ...EMPTY_MEASURED(), ...(typeof r.measured === 'object' && r.measured !== null ? r.measured : {}) },
  }
}
