import { DASH, fmtCountdown, fmtPct, resetMs } from '../shared/hudline.ts'
import type { StatsRecord } from '../shared/stats.ts'
import { fmtModels } from '../shared/format.ts'
import { cacheHealth, cacheText, modelLabel, spanText } from './band.ts'
import type { CacheHealth, CacheUsage } from './band.ts'
import { forecastFull, isLiveStatus } from './team.ts'
import type { PctSample, Snapshot, Subagent, Worker } from './team.ts'

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
  /** Tool calls in a row that failed or were denied, and when the first of them was made; 0 / null after a success. */
  failStreak: number
  failSince: number | null
  /** Tokens its turns used, summed from turn.complete (each event carries one turn's own counts); null before any. */
  usage: TokenUse | null
}

export type TokenUse = { input: number; output: number; cacheRead: number }

export type MissionState = {
  workers: Map<string, WorkerRec>
  tasks: Map<string, TaskRec>
  /** Epoch ms of the first teammate this session started; null until one has. */
  teamStartedAt: number | null
  /** True once a TaskCreate or TaskUpdate call has been seen: the board is then a record of those calls. */
  taskCallsSeen: boolean
  /** Paths Edit, Write, MultiEdit and NotebookEdit changed this session, in first-change order (paths only; the report lists them). */
  files: Set<string>
  /** How many older paths were dropped to keep `files` bounded. */
  filesDropped: number
  /** Ids a teammate marked completed that the lead has not checked since: the lead's main loop has run no Bash command after the completion. */
  unverified: Set<string>
  /** Who wrote each path in `files`: `LEAD` or an agent id. Bounded with `files`. */
  writers: Map<string, Set<string>>
  /** Paths whose collision was already told to the model, once each. */
  collided: Set<string>
}

/** The writer key of the lead's own loop (its tool calls carry no agent id). */
export const LEAD = 'main'

export const newMissionState = (): MissionState => ({
  workers: new Map(),
  tasks: new Map(),
  teamStartedAt: null,
  taskCallsSeen: false,
  files: new Set(),
  filesDropped: 0,
  unverified: new Set(),
  writers: new Map(),
  collided: new Set(),
})

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
  m.workers.set(agentId, { agentId, name, model, toolCalls: 0, recent: [], lastActivityAt: now, idleSinceAt: null, startedAt: now, failStreak: 0, failSince: null, usage: null })
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

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** Remembers the path a write tool was given, bounded to MEMORY_LIMIT (the oldest is forgotten). Nothing else of the input is read. */
export const noteFileChange = (m: MissionState, tool: string, input: unknown, agentId?: string): string | null => {
  if (!WRITE_TOOLS.has(tool) || typeof input !== 'object' || input === null) return null
  const i = input as Record<string, unknown>
  const path = i.file_path ?? i.notebook_path
  if (typeof path !== 'string' || path === '') return null
  m.files.add(path)
  m.writers.set(path, (m.writers.get(path) ?? new Set()).add(agentId ?? LEAD))
  for (const old of m.files) {
    if (m.files.size <= MEMORY_LIMIT) break
    m.files.delete(old)
    m.writers.delete(old)
    m.collided.delete(old)
    m.filesDropped++
  }
  return path
}

export type Collision = { path: string; writers: string[] }

/** Paths written by two or more agents that are all still live (the lead always is). Names, not ids. */
export const collisionsOf = (m: MissionState, snap: Snapshot, only?: string): Collision[] => {
  const names = new Map<string, string>([[LEAD, 'lead']])
  for (const w of snap.workers) if (isLiveStatus(w.status)) names.set(w.agentId, w.name)
  for (const a of snap.subagents) if (isLiveStatus(a.status)) names.set(a.agentId, a.type.replace(/^ctk:/, ''))
  const out: Collision[] = []
  for (const [path, who] of only === undefined ? m.writers : [[only, m.writers.get(only) ?? new Set<string>()] as const]) {
    const live = [...who].filter(k => names.has(k)).map(k => names.get(k)!)
    if (live.length >= 2) out.push({ path, writers: live })
  }
  return out
}

/** The collisions on `path` that were not told yet, marked told; the line for the model, or null. */
export const newCollisionNote = (m: MissionState, snap: Snapshot, path: string): string | null => {
  if (m.collided.has(path)) return null
  const hit = collisionsOf(m, snap, path)[0]
  if (hit === undefined) return null
  m.collided.add(path)
  return `CTK: ${path} has now been written by ${hit.writers.join(' and ')}, who are all live. For information only: check its current content before editing it.`
}

/** A tool call made inside a subagent or teammate loop. The lead's own calls are not per-worker. */
export const noteWorkerToolCall = (m: MissionState, agentId: string | undefined, now: number, label?: string, failed = false): void => {
  if (agentId === undefined) return
  const w = m.workers.get(agentId)
  if (w === undefined) return
  w.toolCalls += 1
  if (label !== undefined) w.recent = [...w.recent, label].slice(-RECENT_CALLS)
  w.lastActivityAt = now
  w.idleSinceAt = null
  w.failStreak = failed ? w.failStreak + 1 : 0
  w.failSince = failed ? (w.failSince ?? now) : null
}

/** A tool call has started in the worker's loop: it is active now, though the call is not counted until it returns. */
export const noteWorkerActive = (m: MissionState, agentId: string, now: number): void => {
  const w = m.workers.get(agentId)
  if (w === undefined) return
  w.lastActivityAt = now
  w.idleSinceAt = null
}

/** The lead's main loop ran a command: whatever teammates completed before it has now been looked at. */
export const noteLeadBash = (m: MissionState): void => m.unverified.clear()

export const noteWorkerTurnEnd = (m: MissionState, agentId: string | undefined, now: number, usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number }): void => {
  if (agentId === undefined) return
  const w = m.workers.get(agentId)
  if (w === undefined) return
  w.lastActivityAt = now
  if (usage === undefined) return
  const u = w.usage ?? { input: 0, output: 0, cacheRead: 0 }
  w.usage = { input: u.input + usage.input_tokens, output: u.output + usage.output_tokens, cacheRead: u.cacheRead + usage.cache_read_input_tokens }
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
export const noteTaskCall = (m: MissionState, tool: string, input: Record<string, unknown>, output: unknown, agentId?: string): void => {
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
  if (typeof input.status === 'string' && STATUSES.includes(input.status)) {
    rec.status = input.status as TaskStatus
    if (rec.status === 'completed' && agentId !== undefined) m.unverified.add(id)
    else if (rec.status !== 'completed') m.unverified.delete(id)
  }
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
  /** Completed by a teammate and not yet followed by a command from the lead. */
  unverified: boolean
}

const byId = (a: { id: string }, b: { id: string }): number => {
  const x = Number(a.id)
  const y = Number(b.id)
  return Number.isFinite(x) && Number.isFinite(y) ? x - y : a.id.localeCompare(b.id)
}

export const taskRows = (m: MissionState): TaskRow[] => {
  const live = [...m.tasks.values()].filter(t => t.status !== 'deleted')
  // Reverse edges, built once: `blocks` on another task is a blocker of this one, and its `blockedBy` a task this one blocks.
  const blockersOf = new Map<string, string[]>()
  const blockedOf = new Map<string, string[]>()
  const push = (map: Map<string, string[]>, key: string, id: string) => map.set(key, [...(map.get(key) ?? []), id])
  for (const o of live) {
    for (const b of o.blocks) push(blockersOf, b, o.id)
    for (const b of o.blockedBy) push(blockedOf, b, o.id)
  }
  return live.sort(byId).map(t => {
    const blockers = new Set([...t.blockedBy, ...(blockersOf.get(t.id) ?? [])])
    const open = [...blockers].filter(id => m.tasks.get(id)?.status !== 'completed' && m.tasks.get(id)?.status !== 'deleted')
    return {
      id: t.id,
      subject: t.subject,
      status: t.status,
      owner: t.owner,
      blockedBy: [...blockers].sort((a, b) => byId({ id: a }, { id: b })),
      blocks: [...new Set([...t.blocks, ...(blockedOf.get(t.id) ?? [])])].sort((a, b) => byId({ id: a }, { id: b })),
      openBlockers: open.sort((a, b) => byId({ id: a }, { id: b })),
      ready: t.status === 'pending' && open.length === 0,
      blocked: (t.status === 'pending' || t.status === 'in_progress') && open.length > 0,
      seenByUpdateOnly: t.seenByUpdateOnly === true,
      unverified: t.status === 'completed' && m.unverified.has(t.id),
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
  /** Why the worker is stalled (see stalledOf), with how long; null when it is not. */
  stalled: Stalled | null
  /** Tokens its turns used so far; null when none was reported. Tokens only: Claude Code reports no cost per worker. */
  usage: TokenUse | null
}

/** A live worker owning an in-progress task with no activity for this long is stalled. */
export const STALL_MS = 10 * 60_000
/** Or one whose last this-many tool calls all failed. */
export const STALL_FAILS = 3

export type Stalled = { name: string; reason: string; forMs: number }

const ownedBy = (rows: TaskRow[], w: Worker): TaskRow | undefined =>
  rows.find(t => t.owner !== null && (t.owner === w.name || t.owner === w.teammateId) && t.status === 'in_progress')

/** Stalled workers, from observed activity only. A worker CTK saw no spawn of, or that owns no in-progress task, is never reported. */
export const stalledOf = (m: MissionState, snap: Snapshot, nowMs: number, rows: TaskRow[] = taskRows(m)): Stalled[] => {
  const out: Stalled[] = []
  for (const w of snap.workers) {
    const rec = m.workers.get(w.agentId)
    if (rec === undefined || !isLiveStatus(w.status) || ownedBy(rows, w) === undefined) continue
    if (rec.failStreak >= STALL_FAILS && rec.failSince !== null) out.push({ name: w.name, reason: `its last ${rec.failStreak} tool calls failed`, forMs: Math.max(0, nowMs - rec.failSince) })
    else if (rec.lastActivityAt !== null && nowMs - rec.lastActivityAt >= STALL_MS) out.push({ name: w.name, reason: 'no activity', forMs: nowMs - rec.lastActivityAt })
  }
  return out
}

export const workerRows = (m: MissionState, snap: Snapshot, nowMs: number, rows: TaskRow[] = taskRows(m), stalled: Stalled[] = stalledOf(m, snap, nowMs, rows)): WorkerRow[] =>
  snap.workers.map(w => {
    const rec = m.workers.get(w.agentId)
    const mine = ownedBy(rows, w)
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
      stalled: stalled.find(s => s.name === w.name) ?? null,
      usage: rec?.usage ?? null,
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
  /** Teammate spawns refused by a usage limit (TEAM_BUDGET_REACHED). */
  budgetStopped: number
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
  /** Display only: workers that look stuck, tasks that could start, teammates with nothing to do, and completions the lead has not checked. Nothing here assigns work. */
  signals: { stalled: Stalled[]; ready: string[]; idleWorkers: string[]; unverified: string[]; collisions: Collision[] }
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
    /** `Sonnet 5.5×3 Haiku 5.5×1`: what the subagents and teammates started this session ran on; null before any. */
    agentModels: string | null
    /** Prompt-cache line for the last response (`92% read`); UNAVAILABLE before one. */
    cache: string
    cacheState: CacheHealth['state'] | null
    /** Local time the 5-hour limit is projected to be reached (`14:05`); null unless it lands before the reset. */
    fiveHourFull: string | null
    /** Agents now listed per CTK role (`explorer`...), a count of the current roster, not of calls. Cost per role is not reported by Claude Code. */
    roles: string | null
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

const fullAt = (samples: PctSample[], nowMs: number, resetsAt: string | null): string | null => {
  const at = forecastFull(samples, nowMs, resetMs(resetsAt))
  return at === null ? null : new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

export type MissionInput = {
  stats: StatsRecord
  snap: Snapshot
  state: MissionState
  nowMs: number
  teamsEnabled: boolean | null
  ready: boolean
  /** The last response's cache counts from local session usage; absent when not read. */
  cache?: CacheUsage | null
  /** Recent 5-hour percent readings, for the forecast. */
  samples?: PctSample[]
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

const signalsFrom = (m: MissionState, snap: Snapshot, rows: TaskRow[], stalled: Stalled[]): Mission['signals'] => ({
  stalled,
  ready: rows.filter(r => r.ready).map(r => r.id),
  idleWorkers: snap.workers.filter(w => w.status === 'idle').map(w => w.name),
  unverified: rows.filter(r => r.unverified).map(r => r.id),
  collisions: collisionsOf(m, snap),
})

/** The signals alone, for the band, which must not rebuild the whole mission on every draw. */
export const signalsOf = (m: MissionState, snap: Snapshot, nowMs: number): Mission['signals'] => {
  const rows = taskRows(m)
  return signalsFrom(m, snap, rows, stalledOf(m, snap, nowMs, rows))
}

export const buildMission = ({ stats, snap, state, nowMs, teamsEnabled, ready, cache, samples = [] }: MissionInput): Mission => {
  missionBuilds += 1
  const rows = taskRows(state)
  const detailed = state.taskCallsSeen
  const partial = rows.some(t => t.seenByUpdateOnly)
  const count = (pred: (t: TaskRow) => boolean): number | null => (detailed && !partial ? rows.filter(pred).length : null)
  const counted = stats.tasks
  const stalled = stalledOf(state, snap, nowMs, rows)
  return {
    guard: guardOf(stats, snap, teamsEnabled, ready),
    cap: stats.maxWorkers,
    active: snap.live,
    running: snap.busy,
    idle: snap.idle,
    completed: snap.done === null ? null : snap.workers.filter(w => w.status === 'completed').length,
    failed: snap.failed,
    rejected: stats.spawnsRejected,
    budgetStopped: stats.spawnsBudgetStopped,
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
    workers: workerRows(state, snap, nowMs, rows, stalled),
    signals: signalsFrom(state, snap, rows, stalled),
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
      agentModels: agentModelsText(stats),
      cache: cacheText(cacheHealth(cache)),
      cacheState: cacheHealth(cache)?.state ?? null,
      fiveHourFull: fullAt(samples, nowMs, stats.measured.fiveHourResetsAt),
      roles: rolesText(snap),
    },
  }
}

// Subagents now on the roster per CTK role (`ctk:explorer` -> `explorer`); other types keep their own name.
// Teammates carry no type in the roster, so they count together as `teammate`.
const rolesText = (snap: Snapshot): string | null => {
  const counts: Record<string, number> = {}
  if (snap.workers.length > 0) counts.teammate = snap.workers.length
  for (const a of snap.subagents) {
    const role = a.type.replace(/^ctk:/, '')
    counts[role] = (counts[role] ?? 0) + 1
  }
  const parts = Object.entries(counts).map(([r, n]) => `${r}×${n}`)
  return parts.length === 0 ? null : parts.join(' ')
}

// Teammates and subagents together, merged by display name so `sonnet` and `claude-sonnet-5-5` do not split.
const agentModelsText = (s: StatsRecord): string | null => {
  const counts: Record<string, number> = {}
  for (const src of [s.workerModels, s.subagentModels]) {
    for (const [id, n] of Object.entries(src)) {
      const label = modelLabel(id) ?? id
      counts[label] = (counts[label] ?? 0) + n
    }
  }
  return fmtModels(counts) || null
}

/** `950`, `3.4k`, `120k`, `1.2M`. */
export const fmtCount = (v: number): string => (v < 1000 ? String(v) : v < 100_000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k` : v < 1_000_000 ? `${Math.round(v / 1000)}k` : `${(v / 1_000_000).toFixed(1)}M`)

/** `12k in / 3.4k out`: a worker's tokens. */
export const fmtTokens = (u: TokenUse): string => `${fmtCount(u.input)} in / ${fmtCount(u.output)} out`

/** The collision line for Workers and Overview: the first path by its file name, then a count of the rest. */
export const collisionLine = (cs: Collision[]): string | null => {
  const c = cs[0]
  if (c === undefined) return null
  return `⚠ ${c.path.split(/[\\/]/).filter(Boolean).pop() ?? c.path} written by ${c.writers.join(' + ')}${cs.length > 1 ? ` (+${cs.length - 1} more)` : ''}`
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
    `  workers:  ${n(m.active)}/${m.cap} active, ${n(m.running)} running, ${n(m.idle)} idle, ${n(m.completed)} completed, ${n(m.failed)} failed; ${m.rejected} refused at capacity${m.budgetStopped > 0 ? `, ${m.budgetStopped} stopped by a usage limit` : ''}`,
    ...(m.subagents.total > 0 ? [`  subagents: ${m.subagents.total} ordinary (${m.subagents.live} live); not teammates, so the cap does not count them`] : []),
    `  tasks:    ${tasks}`,
    `  team time: ${m.teamElapsedMs === null ? UNAVAILABLE : fmtSpan(m.teamElapsedMs)}`,
    `  usage:    5h ${m.usage.fiveHour}; week ${m.usage.sevenDay}; context ${m.usage.contextPct}; cost ${m.usage.cost}; ${m.usage.toolCalls} tool calls; agent models ${m.usage.agentModels ?? 'none'}`,
  ]
  if (m.empty.workers !== null) lines.push(`  note: ${m.empty.workers}`)
  if (m.empty.tasks !== null) lines.push(`  note: ${m.empty.tasks}`)
  for (const s of m.signals.stalled) lines.push(`  stalled:  ${s.name} - ${s.reason} for ${fmtSpan(s.forMs)}`)
  if (m.signals.unverified.length > 0) lines.push(`  unverified: ${m.signals.unverified.map(i => `#${i}`).join(' ')} completed by a teammate, no command run by the lead since`)
  for (const w of m.workers) {
    lines.push(
      `  worker ${w.name}: ${w.status}, model ${w.model ?? UNAVAILABLE}, tool calls ${w.toolCalls === null ? UNAVAILABLE : w.toolCalls}, last activity ${fmtAge(w.lastActivityMs)}${w.idleMs === null ? '' : `, idle ${fmtSpan(w.idleMs)}`}${w.currentTask === null ? '' : `, on ${w.currentTask}`}${w.usage === null ? '' : `, tokens ${fmtTokens(w.usage)}`}`,
    )
  }
  return lines.join('\n')
}

/** A small, serialisable summary for the status tool, so the model can answer "how is the team doing" from facts. */
/** `usage` (quota, cost, context) is left out unless asked for: a model that reads it unprompted may throttle its own work. */
export const missionJson = (m: Mission, includeUsage = false) => ({
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
  stalled: m.signals.stalled,
  ready: m.signals.ready,
  idleWorkers: m.signals.idleWorkers,
  unverified: m.signals.unverified,
  collisions: m.signals.collisions,
  ...(includeUsage ? { usage: m.usage } : {}),
})
