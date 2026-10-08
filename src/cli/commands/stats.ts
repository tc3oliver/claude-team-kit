import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { readJsonIfExists } from '../../core/fsx.ts'
import { parseStats, type StatsRecord } from '../../../plugin/ctk/shared/stats.ts'
import { EXIT, type Ctx } from '../context.ts'
import type { Report } from '../report.ts'

const dash = (v: number | null | undefined, f: (n: number) => string): string => (v === null || v === undefined ? '–' : f(v))
const models = (m: Record<string, number>): string =>
  Object.entries(m).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, n]) => `${k}×${n}`).join(' ') || '–'

const countedLine = (r: Pick<StatsRecord, 'spawnsAccepted' | 'spawnsRejected' | 'spawnsFailedClosed' | 'peakLive' | 'workerModels' | 'tasks'>): string =>
  `spawns accepted ${r.spawnsAccepted}, rejected ${r.spawnsRejected}, guard-failed ${r.spawnsFailedClosed ?? 0}, peak live ${r.peakLive}; ` +
  `tasks ${r.tasks ? `${r.tasks.created} created, ${r.tasks.completed} completed` : '–'}; models ${models(r.workerModels ?? {})}`

const measuredLine = (m: StatsRecord['measured'] | undefined): string =>
  `cost ${dash(m?.costUsd, n => `$${n.toFixed(2)}`)}, context ${dash(m?.contextPct, n => `${Math.round(n)}%`)}, ` +
  `5h limit ${dash(m?.fiveHourPct, n => `${Math.round(n)}%`)}, 7d limit ${dash(m?.sevenDayPct, n => `${Math.round(n)}%`)}`

/** Per-session and total figures from <config>/ctk/stats. Never shows a per-worker cost: Claude Code reports none. */
export const runStats = (ctx: Ctx): Report => {
  const dir = ctx.paths.statsDir
  const sessions: StatsRecord[] = []
  let unreadable = 0
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter(n => n.endsWith('.json')).sort()) {
      try {
        const r = parseStats(readJsonIfExists(join(dir, f)))
        r ? sessions.push(r) : unreadable++
      } catch {
        unreadable++
      }
    }
  }
  if (sessions.length === 0) {
    const note = unreadable > 0 ? ` (${unreadable} unreadable file(s) ignored)` : ''
    return { code: EXIT.ok, data: { sessions: [], total: null, unreadable }, lines: [`no session stats recorded in ${dir}${note}`, 'stats are written by the mod when stats.record is on and Claude Code supports mods'] }
  }
  sessions.sort((a, b) => a.updatedAt - b.updatedAt)
  const total = {
    sessions: sessions.length,
    spawnsAccepted: 0,
    spawnsRejected: 0,
    spawnsFailedClosed: 0,
    peakLive: 0,
    workerModels: {} as Record<string, number>,
    tasks: null as { created: number; completed: number } | null,
  }
  for (const s of sessions) {
    total.spawnsAccepted += s.spawnsAccepted
    total.spawnsRejected += s.spawnsRejected
    total.spawnsFailedClosed += s.spawnsFailedClosed ?? 0
    total.peakLive = Math.max(total.peakLive, s.peakLive)
    for (const [k, n] of Object.entries(s.workerModels ?? {})) total.workerModels[k] = (total.workerModels[k] ?? 0) + n
    if (s.tasks) total.tasks = { created: (total.tasks?.created ?? 0) + s.tasks.created, completed: (total.tasks?.completed ?? 0) + s.tasks.completed }
  }
  const last = sessions[sessions.length - 1] as StatsRecord
  const lines = ['counted = events CTK counted; measured = figures Claude Code reported', '']
  for (const s of sessions) {
    lines.push(`session ${s.sessionId} (cap ${s.maxWorkers}, updated ${new Date(s.updatedAt).toISOString()})`)
    lines.push(`  counted:  ${countedLine(s)}`)
    lines.push(`  measured: ${measuredLine(s.measured)}`)
  }
  lines.push('', `total over ${sessions.length} session(s)`, `  counted:  ${countedLine(total)}`)
  lines.push(`  measured (latest session ${last.sessionId}): ${measuredLine(last.measured)}`, 'per-worker cost: not available from Claude Code')
  if (unreadable > 0) lines.push(`${unreadable} unreadable stats file(s) ignored`)
  return { code: EXIT.ok, data: { sessions, total, unreadable }, lines }
}
