import type { MissionState } from './mission.ts'
import { isLiveStatus } from './team.ts'
import type { Snapshot } from './team.ts'

// An advisory, session-local ledger. Never schedules, sends messages or terminates workers.
export const GOAL_TOOL_NAME = 'ctk_goal'

export type GoalPhase = 'active' | 'closing' | 'closed'
export type GoalWorker = {
  agentId: string
  teammateId: string
  name: string
  confirmed: boolean
  everSeen: boolean
  missingReads: number
}
export type GoalRecord = {
  id: string
  phase: GoalPhase
  workers: Map<string, GoalWorker>
  taskIds: Set<string>
  unknownTasks: boolean
  verification: 'unknown' | 'acknowledged'
  review: 'unknown' | 'passed' | 'failed'
}
export type GoalLedger = { next: number; current: GoalRecord | null }
export type GoalAction = 'start' | 'verify' | 'review' | 'close' | 'status'
export type GoalRequest = { action?: unknown; goalId?: unknown; result?: unknown }

export const newGoalLedger = (): GoalLedger => ({ next: 0, current: null })

/** Only workers spawned while this goal is active acquire ownership. */
export const noteGoalSpawn = (ledger: GoalLedger, agentId: string, teammateId: string, name: string): void => {
  const goal = ledger.current
  if (goal?.phase !== 'active') return
  goal.workers.set(agentId, { agentId, teammateId, name, confirmed: false, everSeen: false, missingReads: 0 })
}

/** An observed TaskCreate belongs to the current goal only when the caller is the lead or an owned worker. */
export const noteGoalTask = (ledger: GoalLedger, taskId: string, agentId?: string): void => {
  const goal = ledger.current
  if (goal?.phase !== 'active') return
  if (agentId !== undefined && !goal.workers.has(agentId)) {
    goal.unknownTasks = true
    return
  }
  goal.taskIds.add(taskId)
}

/** An unowned TaskUpdate is not silently adopted into an active goal. */
export const noteGoalTaskUpdate = (ledger: GoalLedger, taskId: string, agentId?: string): void => {
  const goal = ledger.current
  if (goal?.phase !== 'active') return
  if (!goal.taskIds.has(taskId) || (agentId !== undefined && !goal.workers.has(agentId))) {
    goal.unknownTasks = true
  }
  // A task changed after attestation: the lead must repeat verification and review.
  goal.verification = 'unknown'
  goal.review = 'unknown'
}

const openTasks = (goal: GoalRecord, mission: MissionState): string[] =>
  [...goal.taskIds].filter(id => {
    const s = mission.tasks.get(id)?.status
    return (s !== 'completed' && s !== 'deleted') || mission.unverified.has(id)
  })

/**
 * Readable roster observations only. A known terminal status confirms exit immediately; disappearance
 * requires two consecutive readable observations. An unreadable roster never advances confirmation.
 */
export const reconcileGoal = (ledger: GoalLedger, snap: Snapshot): void => {
  const goal = ledger.current
  if (goal === null || snap.live === null) return
  for (const w of goal.workers.values()) {
    if (w.confirmed) continue
    const found = snap.workers.find(a => a.agentId === w.agentId && a.teammateId === w.teammateId)
    if (found === undefined) {
      if (w.everSeen && ++w.missingReads >= 2) w.confirmed = true
    } else {
      w.everSeen = true
      if (!isLiveStatus(found.status)) w.confirmed = true
      else w.missingReads = 0
    }
  }
  if (goal.phase === 'closing' && [...goal.workers.values()].every(w => w.confirmed) &&
      !snap.workers.some(w => isLiveStatus(w.status) && goal.workers.get(w.agentId)?.teammateId !== w.teammateId)) {
    goal.phase = 'closed'
  }
}

export const goalStatus = (ledger: GoalLedger, snap: Snapshot, mission: MissionState) => {
  const g = ledger.current
  if (g === null) return null
  const pending = [...g.workers.values()].filter(w => !w.confirmed)
  const liveOwned = pending.flatMap(w => {
    const seen = snap.workers.find(a => a.agentId === w.agentId && a.teammateId === w.teammateId)
    return seen === undefined ? [] : isLiveStatus(seen.status) ? [{ agentId: w.agentId, teammateId: w.teammateId, name: w.name, status: seen.status }] : []
  })
  const foreignLive = snap.workers.filter(w => isLiveStatus(w.status) && g.workers.get(w.agentId)?.teammateId !== w.teammateId)
  return {
    id: g.id,
    phase: g.phase,
    verification: g.verification,
    review: g.review,
    taskIds: [...g.taskIds],
    unverifiedOrOpen: openTasks(g, mission),
    unknownTasks: g.unknownTasks,
    workerIds: [...g.workers.keys()],
    confirmedWorkerIds: [...g.workers.values()].filter(w => w.confirmed).map(w => w.agentId),
    shutdownCandidates: g.phase === 'closing' ? liveOwned.filter(w => w.status === 'idle') : [],
    unconfirmedWorkerIds: pending.map(w => w.agentId),
    foreignLive: foreignLive.map(w => ({ agentId: w.agentId, name: w.name })),
    rosterAvailable: snap.live !== null,
  }
}

const denied = (error: string, ledger: GoalLedger, snap: Snapshot, mission: MissionState) =>
  ({ ok: false, error, goal: goalStatus(ledger, snap, mission) })

/** Explicit lead attestations only; no tool call here can close or terminate an Agent Team worker. */
export const applyGoalAction = (ledger: GoalLedger, mission: MissionState, snap: Snapshot, input: GoalRequest) => {
  const action = input.action
  if (!['start', 'verify', 'review', 'close', 'status'].includes(String(action))) return denied('invalid action', ledger, snap, mission)
  if (action === 'status') return { ok: true, goal: goalStatus(ledger, snap, mission) }
  if (snap.live === null) return denied('roster unavailable; ownership and cleanup cannot be confirmed', ledger, snap, mission)

  if (action === 'start') {
    if (ledger.current !== null && ledger.current.phase !== 'closed')
      return denied('previous goal is not closed; finish or recover it first', ledger, snap, mission)
    if (snap.workers.some(w => isLiveStatus(w.status)))
      return denied('live workers without an owned goal; do not adopt or terminate them', ledger, snap, mission)
    if ([...mission.tasks.values()].some(t => t.status !== 'completed' && t.status !== 'deleted') || mission.unverified.size > 0)
      return denied('unresolved session tasks; do not assume they belong to the new goal', ledger, snap, mission)
    const goal: GoalRecord = {
      id: `goal-${++ledger.next}`, phase: 'active', workers: new Map(), taskIds: new Set(),
      unknownTasks: false, verification: 'unknown', review: 'unknown',
    }
    ledger.current = goal
    return { ok: true, goal: goalStatus(ledger, snap, mission) }
  }

  const g = ledger.current
  if (g === null || typeof input.goalId !== 'string' || input.goalId !== g.id)
    return denied('goalId required and must match the current goal', ledger, snap, mission)
  if (g.phase !== 'active') return denied('goal is no longer active', ledger, snap, mission)
  if (g.unknownTasks || openTasks(g, mission).length > 0)
    return denied('unowned, incomplete or unacknowledged tasks; keep the goal open', ledger, snap, mission)
  if (snap.workers.some(w => isLiveStatus(w.status) && g.workers.get(w.agentId)?.teammateId !== w.teammateId))
    return denied('unknown live workers; ownership must be resolved first', ledger, snap, mission)

  if (action === 'verify') {
    g.verification = 'acknowledged'
    g.review = 'unknown'
    return { ok: true, note: 'lead acknowledgement, not test evidence', goal: goalStatus(ledger, snap, mission) }
  }
  if (action === 'review') {
    if (input.result !== 'passed' && input.result !== 'failed') return denied('review result must be passed or failed', ledger, snap, mission)
    if (g.verification !== 'acknowledged') return denied('lead verification acknowledgement required', ledger, snap, mission)
    g.review = input.result
    if (input.result === 'failed') g.verification = 'unknown'
    return { ok: true, note: 'lead review declaration, not independent evidence', goal: goalStatus(ledger, snap, mission) }
  }
  if (g.verification !== 'acknowledged' || g.review !== 'passed')
    return denied('lead verification and passed review required', ledger, snap, mission)
  if ([...g.workers.values()].some(w => {
    const a = snap.workers.find(x => x.agentId === w.agentId && x.teammateId === w.teammateId)
    return a !== undefined && isLiveStatus(a.status) && a.status !== 'idle'
  })) return denied('a goal worker is still busy; do not request shutdown yet', ledger, snap, mission)
  g.phase = 'closing'
  reconcileGoal(ledger, snap)
  return { ok: true, note: 'send native shutdown requests to the listed idle workers, then recheck the roster', goal: goalStatus(ledger, snap, mission) }
}
