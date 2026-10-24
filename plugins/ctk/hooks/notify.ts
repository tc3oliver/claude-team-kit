import type { TaskRec } from './mission.ts'
import { isLiveStatus } from './team.ts'
import type { Snapshot } from './team.ts'

// Pure decisions for desktop notifications and for the team summary kept across a compaction.
// No host calls here (those are in register.tsx).

export const NOTIFY_TITLE = 'CTK'

const FAILED = new Set(['failed', 'killed'])

/**
 * What to tell the person about the change from `prev` to `cur`. `seen` holds the teammates already
 * reported as failed; it is updated here so a failure is announced once. A snapshot without a roster
 * (live null) says nothing, and the first readable one only seeds `seen`: teammates that were already
 * dead when CTK loaded are not news.
 */
export const teamNotices = (prev: Snapshot, cur: Snapshot, seen: Set<string>): string[] => {
  if (cur.live === null) return []
  const failed = cur.workers.filter(w => FAILED.has(w.status) && !seen.has(w.teammateId))
  for (const w of failed) seen.add(w.teammateId)
  if (prev.live === null) return []
  const out = failed.map(w => `Teammate ${w.name} ${w.status}.`)
  if (prev.live > 0 && cur.live === 0 && failed.length === 0) out.push('All teammates finished.')
  return out
}

export const capNotice = (live: number, max: number): string => `Teammate spawn refused: ${live} live, cap ${max}.`

const OPEN = new Set(['pending', 'in_progress', 'unknown'])
/** Most entries of each list in the summary; the rest is a count. */
const LIST_MAX = 8
export const SUMMARY_MAX = 600

const list = (items: string[]): string => (items.length <= LIST_MAX ? items.join(', ') : `${items.slice(0, LIST_MAX).join(', ')} +${items.length - LIST_MAX} more`)

/** A short account of the live team and open tasks, or null when there is neither. */
export const teamSummary = (snap: Snapshot, tasks: Iterable<TaskRec>, cap: number): string | null => {
  const workers = snap.workers.filter(w => isLiveStatus(w.status)).map(w => `${w.name} ${w.status}`)
  const open = [...tasks].filter(t => OPEN.has(t.status)).map(t => `#${t.id} ${t.status}${t.owner === null ? '' : ` (${t.owner})`}`)
  if (workers.length === 0 && open.length === 0) return null
  const text = `CTK team state, keep it in the summary: cap ${cap} live teammates. Workers: ${workers.length === 0 ? 'none' : list(workers)}. Open tasks: ${open.length === 0 ? 'none' : list(open)}.`
  return text.length <= SUMMARY_MAX ? text : `${text.slice(0, SUMMARY_MAX - 1)}…`
}
