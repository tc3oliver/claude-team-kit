import type { Stalled, TaskRec } from './mission.ts'
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

/**
 * One notice per stall episode. `noticed` holds the workers already announced as stalled; a worker that
 * is no longer stalled is dropped from it, so its next stall is news again.
 */
export const stallNotices = (stalled: Stalled[], noticed: Set<string>): string[] => {
  for (const n of noticed) if (!stalled.some(s => s.name === n)) noticed.delete(n)
  const fresh = stalled.filter(s => !noticed.has(s.name))
  for (const s of fresh) noticed.add(s.name)
  return fresh.map(s => `Teammate ${s.name} looks stalled: ${s.reason}.`)
}

export const budgetNotice = (why: string): string => `Teammate spawn stopped: ${why}.`

/** The name Agent Teams gives the main conversation in teammate messages (`assignedBy`, `to`). */
export const LEAD_NAME = 'team-lead'

const WRAPPER = /<\/?teammate-message\b[^>]*>/g

/**
 * True only for a delivery that is nothing but a `task_assignment` JSON (inside the optional
 * `<teammate-message>` wrapper) whose `assignedBy` is the recipient itself: the echo of its own claim.
 * Any other text, sender or parse doubt is false, so the lead's assignments always arrive.
 */
export const isOwnAssignmentEcho = (text: string, name: string): boolean => {
  try {
    const body = text.replace(WRAPPER, '').trim()
    if (!body.startsWith('{') || !body.endsWith('}')) return false
    const m: unknown = JSON.parse(body)
    return typeof m === 'object' && m !== null && (m as { type?: unknown }).type === 'task_assignment' && (m as { assignedBy?: unknown }).assignedBy === name
  } catch {
    return false
  }
}

const BLOCK = /<teammate-message\b[^>]*>([\s\S]*?)<\/teammate-message>/g

/**
 * True only for a delivery to the lead that is nothing but shutdown bookkeeping: `shutdown_approved`, and
 * `teammate_terminated` that released no task ("<name> has shut down." and nothing more). The band and
 * Mission Control already show the exit; a block of any other kind, or text outside the blocks, is false.
 */
export const isLifecycleOnly = (text: string): boolean => {
  try {
    const bodies = [...text.matchAll(BLOCK)].map(m => m[1]!.trim())
    if (bodies.length === 0 || text.replace(BLOCK, '').trim() !== '') return false
    return bodies.every(b => {
      const m = JSON.parse(b) as { type?: unknown; message?: unknown }
      return m.type === 'shutdown_approved' || (m.type === 'teammate_terminated' && typeof m.message === 'string' && /^\S+ has shut down\.$/.test(m.message))
    })
  } catch {
    return false
  }
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
