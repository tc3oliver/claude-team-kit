import { fmtModels, usd } from '../shared/format.ts'
import type { StatsRecord } from '../shared/stats.ts'
import { fmtElapsed } from './band.ts'
import type { TaskRec } from './mission.ts'

// The /ctk-report text, written to be pasted into a PR body. Pure: register.tsx hands in what was observed.

export type ReportInput = {
  stats: StatsRecord
  tasks: Iterable<TaskRec>
  /** Paths the write tools changed, in first-change order. */
  files: Iterable<string>
  /** Older paths dropped to keep the record bounded. */
  filesDropped?: number
  /** The session's working directory: paths inside it are shown relative, the rest only counted. */
  cwd?: string | null
  /** Milliseconds since the first teammate started; null when none did. */
  teamMs: number | null
}

/** Most files listed; the rest is a count. */
export const REPORT_FILES_MAX = 50

const models = (m: Record<string, number>): string => fmtModels(m) || '–'

// A path under cwd, relative to it; null for one outside (a memory file, a temp dir), which a PR body should not carry.
const inside = (path: string, cwd: string | null | undefined): string | null => {
  if (!cwd) return path
  const root = cwd.replace(/[\\/]+$/, '') + '/'
  const p = path.replace(/\\/g, '/')
  return p.startsWith(root.replace(/\\/g, '/')) ? p.slice(root.length) : null
}

export const formatReport = ({ stats: s, tasks, files, teamMs, filesDropped = 0, cwd }: ReportInput): string => {
  const live = [...tasks].filter(t => t.status !== 'deleted')
  const all = [...files].map(f => inside(f, cwd))
  const changed = all.filter((f): f is string => f !== null)
  const outside = all.length - changed.length
  return [
    '## Team report',
    '',
    `Team duration: ${fmtElapsed(teamMs)}. Spawns: ${s.spawnsAccepted} accepted, ${s.spawnsRejected} refused at capacity.`,
    `Session: cost ${usd(s.measured.costUsd)}, ${s.toolCalls} tool calls.`,
    `Models: lead ${s.measured.model ?? '–'}; teammates ${models(s.workerModels)}; subagents ${models(s.subagentModels)}.`,
    '',
    '### Tasks',
    ...(live.length === 0 ? ['No task list was recorded.'] : live.map(t => `- #${t.id} [${t.status}] ${t.subject}${t.owner === null ? '' : ` (${t.owner})`}`)),
    '',
    `### Files changed (${changed.length})`,
    ...(changed.length === 0 ? ['None recorded.'] : changed.slice(0, REPORT_FILES_MAX).map(f => `- ${f}`)),
    ...(changed.length > REPORT_FILES_MAX ? [`- and ${changed.length - REPORT_FILES_MAX} more`] : []),
    ...(outside > 0 ? [`- ${outside} outside the working directory, not listed`] : []),
    ...(filesDropped > 0 ? [`- ${filesDropped} earlier changes not kept`] : []),
  ].join('\n')
}
