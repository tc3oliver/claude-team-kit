import { describe, expect, test } from 'claude-code/testing'
import type { AgentInfo } from 'claude-code'
import { applyGoalAction, goalStatus, newGoalLedger, noteGoalSpawn, noteGoalTask, noteGoalTaskUpdate, reconcileGoal } from '../hooks/goal.ts'
import { newMissionState, noteTaskCall } from '../hooks/mission.ts'
import { snapshotOf } from '../hooks/team.ts'

const NOW = 100_000
const worker = (id: string, name: string, status: AgentInfo['status']): AgentInfo =>
  ({ id, teammateId: `${name}@team`, description: '', type: 'teammate', status })
const snap = (...workers: AgentInfo[]) => snapshotOf(workers, null, NOW)
const empty = () => ({ ledger: newGoalLedger(), mission: newMissionState() })
const start = (ledger: ReturnType<typeof newGoalLedger>, mission: ReturnType<typeof newMissionState>, roster = snap()) =>
  applyGoalAction(ledger, mission, roster, { action: 'start' })

describe('goal ownership', () => {
  test('starts only with a readable roster and no unowned live worker', () => {
    const { ledger, mission } = empty()
    expect(start(ledger, mission, snapshotOf(null, null, NOW))).toMatchObject({ ok: false, error: expect.stringContaining('roster unavailable') })
    expect(start(ledger, mission, snap(worker('old', 'w1', 'idle')))).toMatchObject({ ok: false, error: expect.stringContaining('live workers') })
    expect(start(ledger, mission)).toMatchObject({ ok: true, goal: { id: 'goal-1', phase: 'active' } })
    expect(start(ledger, mission)).toMatchObject({ ok: false, error: expect.stringContaining('not closed') })
  })

  test('only observed spawns acquire ownership; no implicit adoption after reload', () => {
    const { ledger, mission } = empty()
    expect(start(ledger, mission).ok).toBe(true)
    noteGoalSpawn(ledger, 'a1', 'w1@team', 'w1')
    expect(goalStatus(ledger, snap(worker('a1', 'w1', 'idle')), mission)?.workerIds).toEqual(['a1'])
    const reloaded = newGoalLedger()
    expect(start(reloaded, mission, snap(worker('a1', 'w1', 'idle'))).ok).toBe(false)
    expect(goalStatus(reloaded, snap(worker('a1', 'w1', 'idle')), mission)).toBeNull()
  })

  test('lead attestation and review permit close without native Task tools; no automatic shutdown', () => {
    const { ledger, mission } = empty()
    start(ledger, mission)
    noteGoalSpawn(ledger, 'a1', 'w1@team', 'w1')
    const idle = snap(worker('a1', 'w1', 'idle'))
    expect(applyGoalAction(ledger, mission, idle, { action: 'close', goalId: 'goal-1' }).ok).toBe(false)
    expect(applyGoalAction(ledger, mission, idle, { action: 'verify', goalId: 'goal-1' }).ok).toBe(true)
    expect(applyGoalAction(ledger, mission, idle, { action: 'review', goalId: 'goal-1', result: 'passed' }).ok).toBe(true)
    const closing = applyGoalAction(ledger, mission, idle, { action: 'close', goalId: 'goal-1' })
    expect(closing).toMatchObject({ ok: true, goal: { phase: 'closing', shutdownCandidates: [{ agentId: 'a1', teammateId: 'w1@team', status: 'idle' }] } })
    expect(ledger.current?.workers.get('a1')?.confirmed).toBe(false)
    reconcileGoal(ledger, snap(worker('a1', 'w1', 'completed')))
    expect(goalStatus(ledger, snap(), mission)?.phase).toBe('closed')
    expect(start(ledger, mission)).toMatchObject({ ok: true, goal: { id: 'goal-2' } })
  })

  test('TaskUpdate must finish and be acknowledged before Goal verification', () => {
    const { ledger, mission } = empty()
    start(ledger, mission)
    noteGoalSpawn(ledger, 'a1', 'w1@team', 'w1')
    noteTaskCall(mission, 'TaskCreate', { subject: 'build' }, { task: { id: '1', subject: 'build' } })
    noteGoalTask(ledger, '1')
    const roster = snap(worker('a1', 'w1', 'idle'))
    expect(applyGoalAction(ledger, mission, roster, { action: 'verify', goalId: 'goal-1' }).ok).toBe(false)
    noteTaskCall(mission, 'TaskUpdate', { taskId: '1', status: 'completed' }, { success: true }, 'a1')
    noteGoalTaskUpdate(ledger, '1', 'a1')
    expect(applyGoalAction(ledger, mission, roster, { action: 'verify', goalId: 'goal-1' }).ok).toBe(false)
    noteTaskCall(mission, 'TaskUpdate', { taskId: '1', status: 'completed' }, { success: true })
    noteGoalTaskUpdate(ledger, '1')
    expect(applyGoalAction(ledger, mission, roster, { action: 'verify', goalId: 'goal-1' }).ok).toBe(true)
    expect(applyGoalAction(ledger, mission, roster, { action: 'review', goalId: 'goal-1', result: 'passed' }).ok).toBe(true)
    noteTaskCall(mission, 'TaskUpdate', { taskId: '1', status: 'in_progress' }, { success: true })
    noteGoalTaskUpdate(ledger, '1')
    expect(goalStatus(ledger, roster, mission)).toMatchObject({ verification: 'unknown', review: 'unknown', unverifiedOrOpen: ['1'] })
  })

  test('a deleted goal task no longer blocks verification', () => {
    const { ledger, mission } = empty()
    start(ledger, mission)
    noteTaskCall(mission, 'TaskCreate', { subject: 'build' }, { task: { id: '1', subject: 'build' } })
    noteGoalTask(ledger, '1')
    noteTaskCall(mission, 'TaskUpdate', { taskId: '1', status: 'deleted' }, { success: true })
    noteGoalTaskUpdate(ledger, '1')
    expect(goalStatus(ledger, snap(), mission)?.unverifiedOrOpen).toEqual([])
    expect(applyGoalAction(ledger, mission, snap(), { action: 'verify', goalId: 'goal-1' }).ok).toBe(true)
  })

  test('a worker from another goal or an unseen Task blocks attestation', () => {
    const { ledger, mission } = empty()
    start(ledger, mission)
    noteGoalSpawn(ledger, 'a1', 'w1@team', 'w1')
    const own = snap(worker('a1', 'w1', 'idle'))
    const foreign = snap(worker('a1', 'other', 'running'))
    expect(applyGoalAction(ledger, mission, foreign, { action: 'verify', goalId: 'goal-1' }).ok).toBe(false)
    noteGoalTaskUpdate(ledger, 'old-task')
    expect(goalStatus(ledger, own, mission)?.unknownTasks).toBe(true)
    expect(applyGoalAction(ledger, mission, own, { action: 'verify', goalId: 'goal-1' }).ok).toBe(false)
  })

  test('failed review requires a new verification attestation; wrong goal id never mutates', () => {
    const { ledger, mission } = empty()
    start(ledger, mission)
    expect(applyGoalAction(ledger, mission, snap(), { action: 'verify', goalId: 'other' }).ok).toBe(false)
    applyGoalAction(ledger, mission, snap(), { action: 'verify', goalId: 'goal-1' })
    expect(applyGoalAction(ledger, mission, snap(), { action: 'review', goalId: 'goal-1', result: 'failed' })).toMatchObject({ ok: true, goal: { verification: 'unknown', review: 'failed' } })
    expect(applyGoalAction(ledger, mission, snap(), { action: 'review', goalId: 'goal-1', result: 'passed' }).ok).toBe(false)
  })

  test('a busy goal worker cannot be closed; unreadable roster never confirms exit', () => {
    const { ledger, mission } = empty()
    start(ledger, mission)
    noteGoalSpawn(ledger, 'a1', 'w1@team', 'w1')
    const busy = snap(worker('a1', 'w1', 'running'))
    applyGoalAction(ledger, mission, busy, { action: 'verify', goalId: 'goal-1' })
    applyGoalAction(ledger, mission, busy, { action: 'review', goalId: 'goal-1', result: 'passed' })
    expect(applyGoalAction(ledger, mission, busy, { action: 'close', goalId: 'goal-1' }).ok).toBe(false)
    const idle = snap(worker('a1', 'w1', 'idle'))
    reconcileGoal(ledger, idle)
    expect(applyGoalAction(ledger, mission, idle, { action: 'close', goalId: 'goal-1' }).ok).toBe(true)
    reconcileGoal(ledger, snapshotOf(null, null, NOW))
    reconcileGoal(ledger, snap())
    expect(goalStatus(ledger, snap(), mission)).toMatchObject({ phase: 'closing', unconfirmedWorkerIds: ['a1'] })
    reconcileGoal(ledger, snap())
    expect(goalStatus(ledger, snap(), mission)?.phase).toBe('closed')
  })

  test('a worker never observed in the roster cannot be treated as exited', () => {
    const { ledger, mission } = empty()
    start(ledger, mission)
    noteGoalSpawn(ledger, 'a1', 'w1@team', 'w1')
    applyGoalAction(ledger, mission, snap(), { action: 'verify', goalId: 'goal-1' })
    applyGoalAction(ledger, mission, snap(), { action: 'review', goalId: 'goal-1', result: 'passed' })
    applyGoalAction(ledger, mission, snap(), { action: 'close', goalId: 'goal-1' })
    for (let i = 0; i < 5; i++) reconcileGoal(ledger, snap())
    expect(goalStatus(ledger, snap(), mission)).toMatchObject({ phase: 'closing', unconfirmedWorkerIds: ['a1'] })
  })

  test('existing session tasks or unverified completions block new goal ownership', () => {
    const { ledger, mission } = empty()
    noteTaskCall(mission, 'TaskCreate', { subject: 'old' }, { task: { id: 'old', subject: 'old' } })
    expect(start(ledger, mission).ok).toBe(false)
    noteTaskCall(mission, 'TaskUpdate', { taskId: 'old', status: 'completed' }, { success: true }, 'worker')
    expect(start(ledger, mission).ok).toBe(false)
    noteTaskCall(mission, 'TaskUpdate', { taskId: 'old', status: 'completed' }, { success: true })
    expect(start(ledger, mission).ok).toBe(true)
  })
})
