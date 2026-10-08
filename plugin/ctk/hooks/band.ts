import type { StatsRecord } from '../shared/stats.ts'
import type { Snapshot } from './team.ts'

// Pure text for the AbovePrompt band and the /ctk-stats summary. A figure Claude Code
// did not report renders as a dash, never as a guess.

const DASH = '–'

const num = (v: number | null): string => (v === null ? DASH : String(v))
const usd = (v: number | null): string => (v === null ? DASH : `$${v.toFixed(2)}`)
const pct = (v: number | null): string => (v === null ? DASH : `${Math.round(v)}%`)

export const fmtElapsed = (ms: number | null): string => {
  if (ms === null) return DASH
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

export const fmtModels = (models: Record<string, number>): string =>
  Object.keys(models)
    .sort()
    .map(m => `${m}×${models[m]}`)
    .join(' ')

export const truncate = (line: string, columns: number): string => {
  if (columns < 1) return ''
  return line.length <= columns ? line : `${line.slice(0, columns - 1)}…`
}

export const formatBand = (s: StatsRecord, snap: Snapshot, columns: number): string => {
  const parts = [
    `team ${num(snap.busy)} busy · ${num(snap.idle)} idle · ${num(snap.done)} done / cap ${s.maxWorkers}`,
    s.tasks === null ? null : `tasks ${s.tasks.completed}/${s.tasks.created}`,
    s.spawnsRejected > 0 ? `rejected ${s.spawnsRejected}` : null,
    Object.keys(s.workerModels).length > 0 ? `models ${fmtModels(s.workerModels)}` : null,
    usd(s.measured.costUsd),
    fmtElapsed(snap.elapsedMs),
  ]
  return truncate(parts.filter(p => p !== null).join(' · '), columns)
}

export const formatSummary = (s: StatsRecord, snap: Snapshot): string =>
  [
    `CTK session ${s.sessionId}`,
    'counted by CTK:',
    `  teammate spawns: ${s.spawnsAccepted} accepted, ${s.spawnsRejected} refused at capacity, ${s.spawnsFailedClosed} failed closed`,
    `  peak live teammates: ${s.peakLive} (cap ${s.maxWorkers}); now ${num(snap.live)}`,
    `  worker models: ${fmtModels(s.workerModels) || DASH}`,
    `  tasks created/completed: ${s.tasks === null ? `${DASH} (no task event seen)` : `${s.tasks.created}/${s.tasks.completed}`}`,
    'measured (reported by Claude Code):',
    `  cost: ${usd(s.measured.costUsd)}  context: ${pct(s.measured.contextPct)}  5h limit: ${pct(s.measured.fiveHourPct)}  7d limit: ${pct(s.measured.sevenDayPct)}`,
    `  elapsed: ${fmtElapsed(snap.elapsedMs)}`,
    '  per-worker cost: not available from Claude Code',
  ].join('\n')
