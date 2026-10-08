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
  /** Highest number of simultaneously live teammates seen at a spawn decision. */
  peakLive: number
  /** Resolved model per accepted spawn, as reported by Claude Code: counts by model id/alias. */
  workerModels: Record<string, number>
  /** Counts from TaskCreated / TaskCompleted events; null when no such event ever fired. */
  tasks: { created: number; completed: number } | null
  /** Latest measured figures; null when Claude Code did not report them. */
  measured: {
    costUsd: number | null
    contextPct: number | null
    fiveHourPct: number | null
    sevenDayPct: number | null
  }
}

export const emptyStats = (sessionId: string, maxWorkers: number, now: number): StatsRecord => ({
  schemaVersion: STATS_SCHEMA_VERSION,
  sessionId,
  startedAt: now,
  updatedAt: now,
  maxWorkers,
  spawnsAccepted: 0,
  spawnsRejected: 0,
  spawnsFailedClosed: 0,
  peakLive: 0,
  workerModels: {},
  tasks: null,
  measured: { costUsd: null, contextPct: null, fiveHourPct: null, sevenDayPct: null },
})

/** Session ids become file names; keep them to a safe charset. */
export const safeSessionId = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'unknown'

/** Narrow unknown JSON to a StatsRecord, or null. Used by the CLI on files it did not just write. */
export const parseStats = (raw: unknown): StatsRecord | null => {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Partial<StatsRecord>
  if (r.schemaVersion !== STATS_SCHEMA_VERSION || typeof r.sessionId !== 'string') return null
  if (typeof r.spawnsAccepted !== 'number' || typeof r.spawnsRejected !== 'number') return null
  return r as StatsRecord
}
