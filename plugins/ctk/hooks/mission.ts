import { DASH, fmtCountdown, fmtPct, resetMs } from '../shared/hudline.ts'
import type { StatsRecord } from '../shared/stats.ts'
import { spanText } from './band.ts'
import { isLiveStatus } from './team.ts'
import type { Snapshot, Subagent } from './team.ts'

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
  /** Labels of its last RECENT_CALLS tool calls (see toolLabel), newest last. */
  recent: string[]
  /** Epoch ms of its last tool call, turn end or idle notice; null when none was seen. */
  lastActivityAt: number | null
  /** Epoch ms of the last TeammateIdle notice, cleared by the next activity. */
  idleSinceAt: number | null
  /** Epoch ms of the spawn CTK saw. */
  startedAt: number
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

const isTerminalTask = (t: TaskRec): boolean => t.status === 'completed' || t.status === 'deleted'

/**
 * Eviction for the task board past MEMORY_LIMIT, one task at a time. A Map keeps insertion order,
 * and noteTaskCall re-inserts on update, so the first key is the least-recently-touched. Losing a
 * finished task costs least, so terminal (completed/deleted) go before active ones; and within a
 * class, a task nothing depends on goes before one a retained task still references in
 * blockedBy/blocks — evicting a referenced blocker would drop its completed status and leave a
 * dangling, re-opened edge in the rendered DAG. Oldest wins inside each group.
 */
const trimTasks = (tasks: Map<string, TaskRec>): void => {
  while (tasks.size > MEMORY_LIMIT) {
    const recs = [...tasks.values()]
    const referenced = new Set<string>()
    for (const t of recs) {
      for (const id of t.blockedBy) referenced.add(id)
      for (const id of t.blocks) referenced.add(id)
    }
    const victim =
      recs.find(t => isTerminalTask(t) && !referenced.has(t.id)) ??
      recs.find(isTerminalTask) ??
      recs.find(t => !referenced.has(t.id)) ??
      recs[0]
    if (victim === undefined) break
    tasks.delete(victim.id)
  }
}

// --- Observations ------------------------------------------------------------------------

export const noteSpawn = (m: MissionState, agentId: string, name: string, model: string | null, now: number): void => {
  m.workers.set(agentId, { agentId, name, model, toolCalls: 0, recent: [], lastActivityAt: now, idleSinceAt: null, startedAt: now })
  m.teamStartedAt ??= now
  trim(m.workers)
}

/** Most call labels kept per worker. */
export const RECENT_CALLS = 6
const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** The tool name, plus a file's basename for file tools. Nothing else of the input is kept: a command or pattern can carry a secret. */
export const toolLabel = (tool: string, input: unknown): string => {
  const path = FILE_TOOLS.has(tool) && typeof input === 'object' && input !== null ? (input as Record<string, unknown>).file_path ?? (input as Record<string, unknown>).notebook_path : undefined
  const base = typeof path === 'string' ? path.split(/[\\/]/).filter(Boolean).pop() : undefined
  return base === undefined ? tool : `${tool} ${base}`.slice(0, 40)
}

/** A tool call made inside a subagent or teammate loop. The lead's own calls are not per-worker. */
export const noteWorkerToolCall = (m: MissionState, agentId: string | undefined, now: number, label?: string): void => {
  if (agentId === undefined) return
  const w = m.workers.get(agentId)
  if (w === undefined) return
  w.toolCalls += 1
  if (label !== undefined) w.recent = [...w.recent, label].slice(-RECENT_CALLS)
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
    // delete-then-set so a re-created id moves to the newest slot (recency drives trimTasks).
    m.tasks.delete(id)
    m.tasks.set(id, { id, subject, status: 'pending', owner: null, blockedBy: [], blocks: [] })
    m.taskCallsSeen = true
    trimTasks(m.tasks)
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
  // An update touches the task, so it moves to the newest slot: an actively-updated old task
  // outlives one left alone, and cannot be evicted-then-resurrected as seenByUpdateOnly.
  m.tasks.delete(id)
  m.tasks.set(id, rec)
  m.taskCallsSeen = true
  trimTasks(m.tasks)
}

// --- View model --------------------------------------------------------------------------

export type GuardState = 'active' | 'available' | 'unavailable' | 'error'

/** `why` is the full reason (Doctor, text, JSON); `short` is the one-sentence form the Overview wraps. */
export type Guard = { state: GuardState; label: string; why: string; short: string }

const ordinal = (n: number): string => {
  const t = n % 100
  return `${n}${t >= 11 && t <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}

/** The word shown for a guard state: `ON` for active, otherwise the state itself. */
export const guardWord = (g: Guard): string => (g.state === 'active' ? 'ON' : g.state)

/**
 * Whether the worker cap is doing its job, from evidence and in this order.
 * `error`: a spawn was refused because the cap could not be checked, the roster could not be read at
 * the last refresh, or more teammates are live than the cap allows (they started before the cap was
 * lowered, or outside the guard). `unavailable`: nothing has been read yet, or Agent Teams are off, so
 * no teammate can start. `active`: Agent Teams are confirmed on, the roster is readable, and the guard
 * has been reached by at least one `agent.spawn` event this session. `available`: the mod is loaded and
 * armed, but the guard has not been exercised yet, or the Agent Teams flag could not be read; nothing
 * claims more than that. A Claude Code version that supports Mods is never evidence by itself.
 */
export const guardOf = (stats: StatsRecord, snap: Snapshot, teamsEnabled: boolean | null, ready: boolean): Guard => {
  if (stats.spawnsFailedClosed > 0) {
    const why = `${stats.spawnsFailedClosed} spawn(s) were refused because the cap could not be checked (TEAM_GUARD_FAILED)`
    return { state: 'error', label: 'ERR', why, short: why }
  }
  if (!ready) return { state: 'unavailable', label: DASH, why: 'nothing has been read yet', short: 'nothing has been read yet' }
  if (snap.live === null) return { state: 'error', label: 'ERR', why: 'the roster could not be read at the last refresh', short: 'the roster could not be read at the last refresh' }
  if (teamsEnabled === false) return { state: 'unavailable', label: DASH, why: 'Agent Teams are not enabled, so no teammate can start', short: 'Agent Teams are not enabled, so no teammate can start' }
  if (snap.live > stats.maxWorkers) {
    return {
      state: 'error',
      label: 'ERR',
      why: `${snap.live} teammates are live, above the cap of ${stats.maxWorkers}: they started before the cap was lowered, or outside the guard`,
      short: `${snap.live} teammates are live, above the cap of ${stats.maxWorkers}`,
    }
  }
  if (teamsEnabled === true && stats.spawnsSeen > 0) {
    return {
      state: 'active',
      label: 'ON',
      why: `reached by ${stats.spawnsSeen} spawn(s) this session, ${stats.spawnsAccepted} of them teammate(s); a teammate spawn above ${stats.maxWorkers} live teammates is refused with TEAM_CAPACITY_REACHED`,
      short: `${stats.spawnsSeen} spawn(s) reached the guard · refuses a ${ordinal(stats.maxWorkers + 1)} live teammate (TEAM_CAPACITY_REACHED)`,
    }
  }
  return {
    state: 'available',
    label: 'ready',
    why:
      teamsEnabled === null
        ? 'loaded, but the Agent Teams flag could not be read and no spawn has reached the guard yet'
        : `loaded; no spawn has reached the guard yet. From the first teammate spawn it refuses one above ${stats.maxWorkers} live`,
    short: teamsEnabled === null ? 'loaded; the Agent Teams flag could not be read and no spawn has reached the guard yet' : `no spawn has reached the guard yet; it refuses the ${ordinal(stats.maxWorkers + 1)} live teammate`,
  }
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
  /** Labels of its last tool calls, newest first; empty when none was seen. */
  recent: string[]
  lastActivityMs: number | null
  idleMs: number | null
  /** Time since the spawn CTK saw; null for a worker it did not see start. */
  elapsedMs: number | null
}

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
      recent: rec === undefined ? [] : [...rec.recent].reverse(),
      lastActivityMs: last === null || nowMs < last ? null : nowMs - last,
      idleMs: w.status === 'idle' && idleFrom !== null && nowMs >= idleFrom ? nowMs - idleFrom : null,
      elapsedMs: rec === undefined || nowMs < rec.startedAt ? null : nowMs - rec.startedAt,
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
  /** Named agents Claude Code started as ordinary subagents (a call with `isolation` is one): outside the cap, counted only. */
  outsideCap: number
  /** Since the first teammate started; null before that. */
  teamElapsedMs: number | null
  /** Ordinary subagents the roster lists. They are not teammates: the cap does not count them and no worker detail is kept for them. */
  subagents: { total: number; live: number; rows: Subagent[] }
  /** Why the Workers and Tasks views are empty, and what to do; null when there is something to show. From observed facts only. */
  empty: { workers: string | null; tasks: string | null }
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
    /** The same windows as numbers for a bar; null when not observed. */
    fiveHourPct: number | null
    sevenDayPct: number | null
    contextUsed: number | null
    /** Time until each window resets; null when unknown or already reset. */
    fiveHourReset: string | null
    sevenDayReset: string | null
    cost: string
    toolCalls: number
    model: string | null
  }
}

// A window whose reset time has passed is no longer observed: its percent is stale.
const windowPct = (pct: number | null, resetsAt: string | null, nowMs: number): number | null => {
  const at = resetMs(resetsAt)
  return at !== null && fmtCountdown(at, nowMs) === null ? null : pct
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

const EMPTY_TASKS =
  'No task list yet. The lead creates one with TaskCreate (the /ctk:team skill does); tasks appear here once it has. On a Claude 5.x model the Task tools also need CLAUDE_CODE_ENABLE_TODO_TOOLS=1.'

/** The reason the Workers view has no teammate to list, from what was observed; null when it has some. */
const emptyWorkers = (snap: Snapshot, teamsEnabled: boolean | null): string | null => {
  if (snap.workers.length > 0) return null
  if (teamsEnabled === false) return 'Agent Teams are off, so no teammate can start. Turn them on (see /ctk-doctor), restart, then ask for a team.'
  const sub = snap.subagents.length
  const ran = sub > 0 ? ` ${sub} ordinary subagent${sub === 1 ? '' : 's'} ran or are running (listed below): they are not teammates, so the cap does not count them.` : ''
  return `No teammate has started this session.${ran} A teammate is a named agent the lead starts for a team: run /ctk:team <goal> or ask for "a team".`
}

/**
 * How often buildMission has run since this module loaded. Instrumentation for the tests only
 * (the plugin runs in its own realm, so this is read by tests that drive register.tsx directly);
 * nothing in the product reads it.
 */
export let missionBuilds = 0

export const buildMission = ({ stats, snap, state, nowMs, teamsEnabled, ready }: MissionInput): Mission => {
  missionBuilds += 1
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
    outsideCap: stats.spawnsOutsideCap,
    teamElapsedMs: state.teamStartedAt === null || nowMs < state.teamStartedAt ? null : nowMs - state.teamStartedAt,
    subagents: { total: snap.subagents.length, live: snap.subagents.filter(a => isLiveStatus(a.status)).length, rows: snap.subagents },
    empty: {
      workers: emptyWorkers(snap, teamsEnabled),
      tasks: detailed ? null : EMPTY_TASKS,
    },
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
      fiveHourPct: windowPct(stats.measured.fiveHourPct, stats.measured.fiveHourResetsAt, nowMs),
      sevenDayPct: windowPct(stats.measured.sevenDayPct, stats.measured.sevenDayResetsAt, nowMs),
      contextUsed: stats.measured.contextPct,
      fiveHourReset: fmtCountdown(resetMs(stats.measured.fiveHourResetsAt), nowMs),
      sevenDayReset: fmtCountdown(resetMs(stats.measured.sevenDayResetsAt), nowMs),
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

/** The same span text the band shows, with Mission Control's `unavailable` for a null figure. */
export const fmtSpan = (ms: number | null): string => spanText(ms, UNAVAILABLE)

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
    `  guard:    ${guardWord(m.guard)} - ${m.guard.why}`,
    ...(m.outsideCap > 0 ? [`  outside the cap: ${m.outsideCap} named agent(s) started as ordinary subagents (with isolation); the cap does not count them`] : []),
    `  workers:  ${n(m.active)}/${m.cap} active, ${n(m.running)} running, ${n(m.idle)} idle, ${n(m.completed)} completed, ${n(m.failed)} failed; ${m.rejected} refused`,
    ...(m.subagents.total > 0 ? [`  subagents: ${m.subagents.total} ordinary (${m.subagents.live} live); not teammates, so the cap does not count them`] : []),
    `  tasks:    ${tasks}`,
    `  team time: ${m.teamElapsedMs === null ? UNAVAILABLE : fmtSpan(m.teamElapsedMs)}`,
    `  usage:    5h ${m.usage.fiveHour}; week ${m.usage.sevenDay}; context ${m.usage.contextPct}; cost ${m.usage.cost}; ${m.usage.toolCalls} tool calls`,
  ]
  if (m.empty.workers !== null) lines.push(`  note: ${m.empty.workers}`)
  if (m.empty.tasks !== null) lines.push(`  note: ${m.empty.tasks}`)
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
  outsideCap: m.outsideCap,
  subagents: { total: m.subagents.total, live: m.subagents.live },
  explain: { workers: m.empty.workers, tasks: m.empty.tasks },
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
