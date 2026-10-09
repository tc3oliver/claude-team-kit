import { DASH, fmtCountdown, fmtPct, resetMs } from '../shared/hudline.ts'
import type { StatsRecord } from '../shared/stats.ts'
import type { Snapshot } from './team.ts'

// The data behind Mission Control: what CTK observed this session, and the view model built
// from it. Pure: no host calls (those are in register.tsx). Everything here is held in memory
// only and is never written to the stats file. A figure that was not observed is null and is
// shown as "unavailable"; nothing is estimated.

export const UNAVAILABLE = 'unavailable'

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted' | 'unknown'

export type TaskRec = {
  id: string
  subject: string
  status: TaskStatus
  owner: string | null
  /** Ids this task waits for, as the model declared them (`addBlockedBy`). */
  blockedBy: string[]
  /** Ids waiting for this task (`addBlocks`). */
  blocks: string[]
  /** True when the task was only ever seen in an update: it was created before CTK loaded, so its subject and status are not known. */
  seenByUpdateOnly?: boolean
}

export type WorkerRec = {
  agentId: string
  name: string
  model: string | null
  /** Tool calls the worker's own loop made (tool.call events carrying its agentId). */
  toolCalls: number
  /** Epoch ms of its last tool call, turn end or idle notice; null when none was seen. */
  lastActivityAt: number | null
  /** Epoch ms of the last TeammateIdle notice, cleared by the next activity. */
  idleSinceAt: number | null
}

export type MissionState = {
  workers: Map<string, WorkerRec>
  tasks: Map<string, TaskRec>
  /** Epoch ms of the first teammate this session started; null until one has. */
  teamStartedAt: number | null
  /** True once a TaskCreate or TaskUpdate call has been seen: the board is then a record of those calls. */
  taskCallsSeen: boolean
}

export const newMissionState = (): MissionState => ({ workers: new Map(), tasks: new Map(), teamStartedAt: null, taskCallsSeen: false })

/** Most workers and tasks remembered; the oldest are forgotten past this. */
export const MEMORY_LIMIT = 500

const trim = <V>(map: Map<string, V>): void => {
  while (map.size > MEMORY_LIMIT) {
    const first = map.keys().next()
    if (first.done === true) break
    map.delete(first.value)
  }
}

// --- Observations ------------------------------------------------------------------------

export const noteSpawn = (m: MissionState, agentId: string, name: string, model: string | null, now: number): void => {
  m.workers.set(agentId, { agentId, name, model, toolCalls: 0, lastActivityAt: now, idleSinceAt: null })
  m.teamStartedAt ??= now
  trim(m.workers)
}

/** A tool call made inside a subagent or teammate loop. The lead's own calls are not per-worker. */
export const noteWorkerToolCall = (m: MissionState, agentId: string | undefined, now: number): void => {
  if (agentId === undefined) return
  const w = m.workers.get(agentId)
  if (w === undefined) return
  w.toolCalls += 1
  w.lastActivityAt = now
  w.idleSinceAt = null
}

export const noteWorkerTurnEnd = (m: MissionState, agentId: string | undefined, now: number): void => {
  if (agentId === undefined) return
  const w = m.workers.get(agentId)
  if (w !== undefined) w.lastActivityAt = now
}

/** TeammateIdle carries the teammate's name, not its agent id. */
export const noteTeammateIdle = (m: MissionState, name: string, now: number): void => {
  for (const w of m.workers.values()) {
    if (w.name === name) {
      w.idleSinceAt = now
      w.lastActivityAt = now
    }
  }
}

const record = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

const idList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [])

const STATUSES: readonly string[] = ['pending', 'in_progress', 'completed', 'deleted']

/**
 * Applies one TaskCreate or TaskUpdate call to the board. `input` is what the model passed
 * (subject, taskId, status, owner, addBlockedBy, addBlocks) and `output` the tool's own record
 * (`{ task: { id } }` for a create, `{ success }` for an update). Only those named fields are
 * read; descriptions, metadata and everything else are ignored. A call whose result says it
 * failed, or that carries no id, changes nothing.
 */
export const noteTaskCall = (m: MissionState, tool: string, input: Record<string, unknown>, output: unknown): void => {
  const out = record(output)
  if (tool === 'TaskCreate') {
    const task = record(out?.task)
    const id = text(task?.id)
    const subject = text(task?.subject) ?? text(input.subject)
    if (id === null || subject === null) return
    m.tasks.set(id, { id, subject, status: 'pending', owner: null, blockedBy: [], blocks: [] })
    m.taskCallsSeen = true
    trim(m.tasks)
    return
  }
  if (tool !== 'TaskUpdate') return
  const id = text(input.taskId)
  if (id === null || out?.success === false) return
  const rec: TaskRec = m.tasks.get(id) ?? { id, subject: text(input.subject) ?? `(task ${id})`, status: 'unknown', owner: null, blockedBy: [], blocks: [], seenByUpdateOnly: true }
  const subject = text(input.subject)
  if (subject !== null) rec.subject = subject
  if (typeof input.status === 'string' && STATUSES.includes(input.status)) rec.status = input.status as TaskStatus
  const owner = text(input.owner)
  if (owner !== null) rec.owner = owner
  for (const b of idList(input.addBlockedBy)) if (!rec.blockedBy.includes(b)) rec.blockedBy.push(b)
  for (const b of idList(input.addBlocks)) if (!rec.blocks.includes(b)) rec.blocks.push(b)
  m.tasks.set(id, rec)
  m.taskCallsSeen = true
  trim(m.tasks)
}

// --- View model --------------------------------------------------------------------------

export type GuardState = 'active' | 'unavailable' | 'error'

export type Guard = { state: GuardState; label: string; why: string }

/**
 * Whether the worker cap is doing its job. `error`: the roster could not be read at the last
 * refresh, or a spawn was refused because the cap could not be checked. `unavailable`: Agent Teams
 * are off, or nothing has been read yet, so there is nothing to guard or to say. Otherwise `active`.
 */
export const guardOf = (stats: StatsRecord, snap: Snapshot, teamsEnabled: boolean | null, ready: boolean): Guard => {
  if (stats.spawnsFailedClosed > 0) {
    return { state: 'error', label: 'ERR', why: `${stats.spawnsFailedClosed} spawn(s) were refused because the cap could not be checked (TEAM_GUARD_FAILED)` }
  }
  if (!ready) return { state: 'unavailable', label: DASH, why: 'nothing has been read yet' }
  if (snap.live === null) return { state: 'error', label: 'ERR', why: 'the roster could not be read at the last refresh' }
  if (teamsEnabled === false) return { state: 'unavailable', label: DASH, why: 'Agent Teams are not enabled, so no teammate can start' }
  return { state: 'active', label: 'ON', why: `a spawn above ${stats.maxWorkers} live teammates is refused with TEAM_CAPACITY_REACHED` }
}

export type TaskRow = {
  id: string
  subject: string
  status: TaskStatus
  owner: string | null
  blockedBy: string[]
  blocks: string[]
  /** Ids in blockedBy that are not completed (an id the board has not seen counts as open). */
  openBlockers: string[]
  ready: boolean
  blocked: boolean
  seenByUpdateOnly: boolean
}

const byId = (a: { id: string }, b: { id: string }): number => {
  const x = Number(a.id)
  const y = Number(b.id)
  return Number.isFinite(x) && Number.isFinite(y) ? x - y : a.id.localeCompare(b.id)
}

export const taskRows = (m: MissionState): TaskRow[] => {
  const live = [...m.tasks.values()].filter(t => t.status !== 'deleted')
  return live.sort(byId).map(t => {
    const blockers = new Set([...t.blockedBy, ...live.filter(o => o.blocks.includes(t.id)).map(o => o.id)])
    const open = [...blockers].filter(id => m.tasks.get(id)?.status !== 'completed' && m.tasks.get(id)?.status !== 'deleted')
    return {
      id: t.id,
      subject: t.subject,
      status: t.status,
      owner: t.owner,
      blockedBy: [...blockers].sort((a, b) => byId({ id: a }, { id: b })),
      blocks: [...new Set([...t.blocks, ...live.filter(o => o.blockedBy.includes(t.id)).map(o => o.id)])].sort((a, b) => byId({ id: a }, { id: b })),
      openBlockers: open.sort((a, b) => byId({ id: a }, { id: b })),
      ready: t.status === 'pending' && open.length === 0,
      blocked: (t.status === 'pending' || t.status === 'in_progress') && open.length > 0,
      seenByUpdateOnly: t.seenByUpdateOnly === true,
    }
  })
}

export type WorkerRow = {
  agentId: string
  name: string
  status: string
  model: string | null
  /** `#3 write tests` for the in-progress task the worker owns; null when the board does not show one. */
  currentTask: string | null
  toolCalls: number | null
  lastActivityMs: number | null
  idleMs: number | null
}

const busyStatuses = new Set(['pending', 'running', 'waiting'])

export const workerRows = (m: MissionState, snap: Snapshot, nowMs: number, rows: TaskRow[] = taskRows(m)): WorkerRow[] =>
  snap.workers.map(w => {
    const rec = m.workers.get(w.agentId)
    const mine = rows.find(t => t.owner !== null && (t.owner === w.name || t.owner === w.teammateId) && t.status === 'in_progress')
    const last = rec?.lastActivityAt ?? null
    const idleFrom = rec?.idleSinceAt ?? last
    return {
      agentId: w.agentId,
      name: w.name,
      status: w.status,
      model: rec?.model ?? null,
      currentTask: m.taskCallsSeen && mine !== undefined ? `#${mine.id} ${mine.subject}` : null,
      toolCalls: rec === undefined ? null : rec.toolCalls,
      lastActivityMs: last === null || nowMs < last ? null : nowMs - last,
      idleMs: w.status === 'idle' && idleFrom !== null && nowMs >= idleFrom ? nowMs - idleFrom : null,
    }
  })

export type Mission = {
  guard: Guard
  cap: number
  active: number | null
  running: number | null
  idle: number | null
  completed: number | null
  failed: number | null
  rejected: number
  /** Since the first teammate started; null before that. */
  teamElapsedMs: number | null
  tasks: {
    /** Task rows were built from observed TaskCreate/TaskUpdate calls. */
    detailed: boolean
    /** Some tasks were seen only in an update (created before CTK loaded): the totals cannot be stated. */
    partial: boolean
    total: number | null
    completed: number | null
    pending: number | null
    inProgress: number | null
    blocked: number | null
    ready: number | null
    rows: TaskRow[]
  }
  workers: WorkerRow[]
  usage: {
    contextPct: string
    fiveHour: string
    sevenDay: string
    cost: string
    toolCalls: number
    model: string | null
  }
}

const usageText = (pct: number | null, resetsAt: string | null, nowMs: number): string => {
  const at = resetMs(resetsAt)
  const left = fmtCountdown(at, nowMs)
  if (at !== null && left === null) return `${UNAVAILABLE} (window reset)`
  const p = fmtPct(pct)
  if (p === DASH) return UNAVAILABLE
  return left === null ? p : `${p} (resets in ${left})`
}

export type MissionInput = {
  stats: StatsRecord
  snap: Snapshot
  state: MissionState
  nowMs: number
  teamsEnabled: boolean | null
  ready: boolean
}

export const buildMission = ({ stats, snap, state, nowMs, teamsEnabled, ready }: MissionInput): Mission => {
  const rows = taskRows(state)
  const detailed = state.taskCallsSeen
  const partial = rows.some(t => t.seenByUpdateOnly)
  const count = (pred: (t: TaskRow) => boolean): number | null => (detailed && !partial ? rows.filter(pred).length : null)
  const counted = stats.tasks
  return {
    guard: guardOf(stats, snap, teamsEnabled, ready),
    cap: stats.maxWorkers,
    active: snap.live,
    running: snap.busy,
    idle: snap.idle,
    completed: snap.done === null ? null : snap.workers.filter(w => w.status === 'completed').length,
    failed: snap.failed,
    rejected: stats.spawnsRejected,
    teamElapsedMs: state.teamStartedAt === null || nowMs < state.teamStartedAt ? null : nowMs - state.teamStartedAt,
    tasks: {
      detailed,
      partial,
      // Counts from the TaskCreated/TaskCompleted events are the fallback when no complete board was seen.
      total: detailed && !partial ? rows.length : counted === null ? null : counted.created,
      completed: detailed && !partial ? rows.filter(t => t.status === 'completed').length : counted === null ? null : counted.completed,
      pending: count(t => t.status === 'pending'),
      inProgress: count(t => t.status === 'in_progress'),
      blocked: count(t => t.blocked),
      ready: count(t => t.ready),
      rows,
    },
    workers: workerRows(state, snap, nowMs, rows),
    usage: {
      contextPct: fmtPct(stats.measured.contextPct) === DASH ? UNAVAILABLE : fmtPct(stats.measured.contextPct),
      fiveHour: usageText(stats.measured.fiveHourPct, stats.measured.fiveHourResetsAt, nowMs),
      sevenDay: usageText(stats.measured.sevenDayPct, stats.measured.sevenDayResetsAt, nowMs),
      cost: stats.measured.costUsd === null ? UNAVAILABLE : `$${stats.measured.costUsd.toFixed(2)}`,
      toolCalls: stats.toolCalls,
      model: stats.measured.model,
    },
  }
}

/** `5s`, `4m`, `1h05m`; used for "last activity" and "idle for". */
export const fmtAge = (ms: number | null): string => {
  if (ms === null) return UNAVAILABLE
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m ago`
}

export const fmtSpan = (ms: number | null): string => {
  if (ms === null) return UNAVAILABLE
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

// --- Pane state and presses --------------------------------------------------------------

export type McView = 'overview' | 'workers' | 'tasks' | 'usage' | 'config' | 'stats' | 'doctor'

export const MC_VIEWS: readonly { view: McView; label: string; hotkey: string }[] = [
  { view: 'overview', label: 'Overview', hotkey: '1' },
  { view: 'workers', label: 'Workers', hotkey: '2' },
  { view: 'tasks', label: 'Tasks', hotkey: '3' },
  { view: 'usage', label: 'Usage', hotkey: '4' },
  { view: 'config', label: 'Config', hotkey: '5' },
  { view: 'stats', label: 'Stats', hotkey: '6' },
  { view: 'doctor', label: 'Doctor', hotkey: '7' },
]

/** How the HUD line is laid out: `auto` follows the terminal width, the rest force a form. */
export type HudMode = 'auto' | 'compact' | 'standard' | 'full'

export const HUD_MODES: readonly HudMode[] = ['auto', 'compact', 'standard', 'full']

export type Selection = { kind: 'worker' | 'task'; id: string }

export type McState = {
  view: McView
  /** A worker or task being inspected, shown in place of the list; null shows the list. */
  selected: Selection | null
  hudMode: HudMode
  /** `/ctk-doctor` text, read when the Doctor view is opened or refreshed; null until then. */
  doctorText: string | null
}

export const newMcState = (): McState => ({ view: 'overview', selected: null, hudMode: 'auto', doctorText: null })

export const MC_PANE_ID = 'ctk-mission'
export const OPEN_KEY = 'ctk-open'

/** What a press asks the host to do besides changing the state. */
export type McEffect = 'close' | 'refresh' | 'doctor' | 'confirm' | 'cancel'

/** The id of the proposal a Confirm or Cancel press was drawn for. */

const KEY = {
  view: 'mc:view:',
  worker: 'mc:worker:',
  task: 'mc:task:',
  hud: 'mc:hud:',
}

export const viewKey = (v: McView): string => `${KEY.view}${v}`
export const workerKey = (agentId: string): string => `${KEY.worker}${agentId}`
export const taskKey = (id: string): string => `${KEY.task}${id}`
export const hudKey = (m: HudMode): string => `${KEY.hud}${m}`
export const BACK_KEY = 'mc:back'
export const CLOSE_KEY = 'mc:close'
export const REFRESH_KEY = 'mc:refresh'
const CONFIRM_PREFIX = 'mc:cfg:confirm:'
const CANCEL_PREFIX = 'mc:cfg:cancel:'
/** Confirm and Cancel are keyed with the proposal they were drawn for, so a press made for an earlier proposal cannot answer a later one. */
export const confirmKey = (id: string): string => `${CONFIRM_PREFIX}${id}`
export const cancelKey = (id: string): string => `${CANCEL_PREFIX}${id}`

/**
 * Applies a press on one of the pane's buttons. Pure and read-only: it changes what the pane shows
 * (view, selection, HUD form) and never the team, the settings or the session. Unknown keys change
 * nothing.
 */
export const pressMc = (mc: McState, key: string): { mc: McState; effect?: McEffect; id?: string } => {
  if (key === CLOSE_KEY) return { mc, effect: 'close' }
  if (key === REFRESH_KEY) return { mc, effect: mc.view === 'doctor' ? 'doctor' : 'refresh' }
  if (key === BACK_KEY) return { mc: { ...mc, selected: null } }
  if (key.startsWith(CONFIRM_PREFIX)) return { mc, effect: 'confirm', id: key.slice(CONFIRM_PREFIX.length) }
  if (key.startsWith(CANCEL_PREFIX)) return { mc, effect: 'cancel', id: key.slice(CANCEL_PREFIX.length) }
  if (key.startsWith(KEY.view)) {
    const view = MC_VIEWS.find(v => v.view === key.slice(KEY.view.length))?.view
    if (view === undefined) return { mc }
    return { mc: { ...mc, view, selected: null }, ...(view === 'doctor' ? { effect: 'doctor' as const } : {}) }
  }
  if (key.startsWith(KEY.worker)) return { mc: { ...mc, view: 'workers', selected: { kind: 'worker', id: key.slice(KEY.worker.length) } } }
  if (key.startsWith(KEY.task)) return { mc: { ...mc, view: 'tasks', selected: { kind: 'task', id: key.slice(KEY.task.length) } } }
  if (key.startsWith(KEY.hud)) {
    const hudMode = HUD_MODES.find(m => m === key.slice(KEY.hud.length))
    return hudMode === undefined ? { mc } : { mc: { ...mc, hudMode } }
  }
  return { mc }
}

/** The terminal width the layout should assume for a forced form; auto leaves it to the real width. */
export const forcedTierColumns = (mode: HudMode): number | undefined =>
  mode === 'compact' ? 60 : mode === 'standard' ? 100 : mode === 'full' ? 200 : undefined

/** The overview as plain text: the `/ctk-mission` answer where no pane can be drawn, and the status tool's summary. */
export const missionText = (m: Mission): string => {
  const n = (v: number | null): string => (v === null ? UNAVAILABLE : String(v))
  const tasks =
    m.tasks.total === null
      ? UNAVAILABLE
      : m.tasks.detailed && !m.tasks.partial
        ? `${n(m.tasks.completed)}/${m.tasks.total} done, ${n(m.tasks.pending)} pending, ${n(m.tasks.inProgress)} in progress, ${n(m.tasks.blocked)} blocked, ${n(m.tasks.ready)} ready`
        : `${n(m.tasks.completed)}/${m.tasks.total} done (from task events; ${m.tasks.partial ? 'some tasks were created before CTK loaded' : 'no task detail observed'})`
  const lines = [
    'CTK Mission Control (read-only):',
    `  guard:    ${m.guard.state === 'active' ? 'ON' : m.guard.state} - ${m.guard.why}`,
    `  workers:  ${n(m.active)}/${m.cap} active, ${n(m.running)} running, ${n(m.idle)} idle, ${n(m.completed)} completed, ${n(m.failed)} failed; ${m.rejected} refused`,
    `  tasks:    ${tasks}`,
    `  team time: ${m.teamElapsedMs === null ? UNAVAILABLE : fmtSpan(m.teamElapsedMs)}`,
    `  usage:    5h ${m.usage.fiveHour}; week ${m.usage.sevenDay}; context ${m.usage.contextPct}; cost ${m.usage.cost}; ${m.usage.toolCalls} tool calls`,
  ]
  for (const w of m.workers) {
    lines.push(
      `  worker ${w.name}: ${w.status}, model ${w.model ?? UNAVAILABLE}, tool calls ${w.toolCalls === null ? UNAVAILABLE : w.toolCalls}, last activity ${fmtAge(w.lastActivityMs)}${w.idleMs === null ? '' : `, idle ${fmtSpan(w.idleMs)}`}${w.currentTask === null ? '' : `, on ${w.currentTask}`}`,
    )
  }
  return lines.join('\n')
}

/** A small, serialisable summary for the status tool, so the model can answer "how is the team doing" from facts. */
export const missionJson = (m: Mission) => ({
  guard: { state: m.guard.state, why: m.guard.why },
  teamElapsedMs: m.teamElapsedMs,
  running: m.running,
  idle: m.idle,
  completed: m.completed,
  failed: m.failed,
  tasks: {
    detailed: m.tasks.detailed,
    total: m.tasks.total,
    completed: m.tasks.completed,
    pending: m.tasks.pending,
    inProgress: m.tasks.inProgress,
    blocked: m.tasks.blocked,
    ready: m.tasks.ready,
  },
  usage: m.usage,
})
