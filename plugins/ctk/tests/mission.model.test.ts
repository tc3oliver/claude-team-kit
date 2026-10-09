import { describe, expect, test } from 'claude-code/testing'
import type { AgentInfo } from 'claude-code'

import {
  BACK_KEY,
  buildMission,
  CLOSE_KEY,
  fmtAge,
  forcedTierColumns,
  guardOf,
  hudKey,
  MEMORY_LIMIT,
  missionJson,
  missionText,
  newMcState,
  newMissionState,
  noteSpawn,
  noteTaskCall,
  noteTeammateIdle,
  noteWorkerToolCall,
  noteWorkerTurnEnd,
  toolLabel,
  pressMc,
  REFRESH_KEY,
  taskKey,
  taskRows,
  viewKey,
  workerKey,
} from '../hooks/mission.ts'
import { snapshotOf } from '../hooks/team.ts'
import { emptyStats } from '../shared/stats.ts'

const NOW = Date.UTC(2026, 9, 9, 3)
const MIN = 60_000

const agent = (id: string, name: string, status: AgentInfo['status']): AgentInfo => ({ id, teammateId: `${name}@t`, description: '', type: 'teammate', status })

const create = (m: ReturnType<typeof newMissionState>, id: string, subject: string) =>
  noteTaskCall(m, 'TaskCreate', { subject, description: 'SECRET detail' }, { task: { id, subject } })

describe('task board', () => {
  test('TaskCreate adds a pending task from the tool’s own record', () => {
    const m = newMissionState()
    create(m, '1', 'write tests')
    expect(taskRows(m)).toMatchObject([{ id: '1', subject: 'write tests', status: 'pending', owner: null, ready: true, blocked: false }])
    expect(m.taskCallsSeen).toBe(true)
  })

  test('descriptions and metadata are never kept', () => {
    const m = newMissionState()
    create(m, '1', 'write tests')
    expect(JSON.stringify([...m.tasks.values()])).not.toContain('SECRET')
  })

  test('TaskUpdate changes status, owner and subject', () => {
    const m = newMissionState()
    create(m, '1', 'a')
    noteTaskCall(m, 'TaskUpdate', { taskId: '1', status: 'in_progress', owner: 'w-rle', subject: 'a2' }, { success: true })
    expect(taskRows(m)[0]).toMatchObject({ status: 'in_progress', owner: 'w-rle', subject: 'a2' })
  })

  test('dependencies: blocked until every blocker is completed; ready afterwards', () => {
    const m = newMissionState()
    create(m, '1', 'one')
    create(m, '2', 'two')
    create(m, '3', 'final run')
    noteTaskCall(m, 'TaskUpdate', { taskId: '3', addBlockedBy: ['1', '2'] }, { success: true })
    let rows = taskRows(m)
    expect(rows[2]).toMatchObject({ id: '3', blocked: true, ready: false, openBlockers: ['1', '2'] })
    noteTaskCall(m, 'TaskUpdate', { taskId: '1', status: 'completed' }, { success: true })
    noteTaskCall(m, 'TaskUpdate', { taskId: '2', status: 'completed' }, { success: true })
    rows = taskRows(m)
    expect(rows[2]).toMatchObject({ blocked: false, ready: true, openBlockers: [] })
    expect(rows[2]?.blockedBy).toEqual(['1', '2'])
  })

  test('addBlocks on the other side blocks the same way', () => {
    const m = newMissionState()
    create(m, '1', 'one')
    create(m, '2', 'two')
    noteTaskCall(m, 'TaskUpdate', { taskId: '1', addBlocks: ['2'] }, { success: true })
    expect(taskRows(m)[1]).toMatchObject({ id: '2', blocked: true, blockedBy: ['1'], openBlockers: ['1'] })
  })

  test('a blocker the board never saw counts as open, not as done', () => {
    const m = newMissionState()
    create(m, '2', 'two')
    noteTaskCall(m, 'TaskUpdate', { taskId: '2', addBlockedBy: ['9'] }, { success: true })
    expect(taskRows(m)[0]).toMatchObject({ blocked: true, openBlockers: ['9'] })
  })

  test('a deleted task leaves the board and no longer blocks', () => {
    const m = newMissionState()
    create(m, '1', 'one')
    create(m, '2', 'two')
    noteTaskCall(m, 'TaskUpdate', { taskId: '2', addBlockedBy: ['1'] }, { success: true })
    noteTaskCall(m, 'TaskUpdate', { taskId: '1', status: 'deleted' }, { success: true })
    expect(taskRows(m).map(t => t.id)).toEqual(['2'])
    expect(taskRows(m)[0]?.blocked).toBe(false)
  })

  test('failed or malformed calls change nothing', () => {
    const m = newMissionState()
    create(m, '1', 'one')
    noteTaskCall(m, 'TaskUpdate', { taskId: '1', status: 'completed' }, { success: false })
    noteTaskCall(m, 'TaskUpdate', { status: 'completed' }, { success: true })
    noteTaskCall(m, 'TaskUpdate', { taskId: '1', status: 'bogus' }, { success: true })
    noteTaskCall(m, 'TaskCreate', { subject: 'x' }, { nothing: true })
    noteTaskCall(m, 'TaskGet', { taskId: '1' }, { task: { id: '1', subject: 'x' } })
    expect(taskRows(m)).toMatchObject([{ id: '1', status: 'pending' }])
  })

  test('ids sort numerically', () => {
    const m = newMissionState()
    for (const id of ['10', '2', '1']) create(m, id, `t${id}`)
    expect(taskRows(m).map(t => t.id)).toEqual(['1', '2', '10'])
  })

  test('memory is bounded', () => {
    const m = newMissionState()
    for (let i = 0; i < MEMORY_LIMIT + 20; i++) create(m, String(i), `t${i}`)
    expect(m.tasks.size).toBe(MEMORY_LIMIT)
  })
})

describe('a board that began before CTK loaded', () => {
  test('an update for an unseen task is recorded as unknown, never as pending', () => {
    const m = newMissionState()
    noteTaskCall(m, 'TaskUpdate', { taskId: '5', owner: 'bob' }, { success: true })
    expect(taskRows(m)[0]).toMatchObject({ id: '5', status: 'unknown', owner: 'bob', ready: false, blocked: false, seenByUpdateOnly: true })
  })

  test('totals and counts become unavailable, with the event counts as the fallback', () => {
    const m = newMissionState()
    create(m, '1', 'seen')
    noteTaskCall(m, 'TaskUpdate', { taskId: '5', owner: 'bob' }, { success: true })
    const stats = emptyStats('s', 3, 0)
    stats.tasks = { created: 5, completed: 4 }
    const out = buildMission({ stats, snap: snapshotOf([], null, NOW), state: m, nowMs: NOW, teamsEnabled: true, ready: true })
    expect(out.tasks).toMatchObject({ detailed: true, partial: true, total: 5, completed: 4, pending: null, blocked: null, ready: null })
    expect(missionText(out)).toContain('some tasks were created before CTK loaded')
  })

  test('a created task that was seen is complete again once nothing is update-only', () => {
    const m = newMissionState()
    create(m, '1', 'seen')
    const out = buildMission({ stats: emptyStats('s', 3, 0), snap: snapshotOf([], null, NOW), state: m, nowMs: NOW, teamsEnabled: true, ready: true })
    expect(out.tasks).toMatchObject({ partial: false, total: 1, pending: 1 })
  })
})

describe('workers', () => {
  test('tool calls, last activity and idle time come from the worker’s own events', () => {
    const m = newMissionState()
    noteSpawn(m, 'a1', 'w-rle', 'claude-sonnet-5-5', NOW - 10 * MIN)
    noteWorkerToolCall(m, 'a1', NOW - 5 * MIN)
    noteWorkerToolCall(m, 'a1', NOW - 4 * MIN)
    noteWorkerToolCall(m, undefined, NOW)
    noteWorkerToolCall(m, 'unknown', NOW)
    noteTeammateIdle(m, 'w-rle', NOW - 2 * MIN)
    const snap = snapshotOf([agent('a1', 'w-rle', 'idle')], null, NOW)
    const [w] = buildMission({ stats: emptyStats('s', 3, 0), snap, state: m, nowMs: NOW, teamsEnabled: true, ready: true }).workers
    expect(w).toMatchObject({ name: 'w-rle', model: 'claude-sonnet-5-5', toolCalls: 2, status: 'idle', lastActivityMs: 2 * MIN, idleMs: 2 * MIN })
  })

  test('a call label keeps the tool name and a file basename, nothing else of the input', () => {
    expect(toolLabel('Bash', { command: 'curl -H "Authorization: sk-secret" x' })).toBe('Bash')
    expect(toolLabel('Grep', { pattern: 'password' })).toBe('Grep')
    expect(toolLabel('Read', { file_path: '/a/b/notes.md' })).toBe('Read notes.md')
    expect(toolLabel('NotebookEdit', { notebook_path: '/a/n.ipynb' })).toBe('NotebookEdit n.ipynb')
    expect(toolLabel('Write', { file_path: `/a/${'x'.repeat(80)}` })).toHaveLength(40)
    expect(toolLabel('Read', null)).toBe('Read')
  })

  test('recent labels keep the last six, newest first in the row; none is an empty list', () => {
    const m = newMissionState()
    noteSpawn(m, 'a1', 'w1', null, NOW - MIN)
    for (let i = 1; i <= 8; i++) noteWorkerToolCall(m, 'a1', NOW, `T${i}`)
    noteWorkerToolCall(m, 'a1', NOW)
    noteSpawn(m, 'a2', 'w2', null, NOW - MIN)
    const snap = snapshotOf([agent('a1', 'w1', 'running'), agent('a2', 'w2', 'running'), agent('a9', 'ghost', 'running')], null, NOW)
    const ws = buildMission({ stats: emptyStats('s', 3, 0), snap, state: m, nowMs: NOW, teamsEnabled: true, ready: true }).workers
    expect(ws.map(w => w.recent)).toEqual([['T8', 'T7', 'T6', 'T5', 'T4', 'T3'], [], []])
    expect(ws[0]?.toolCalls).toBe(9)
  })

  test('activity after an idle notice clears the idle clock', () => {
    const m = newMissionState()
    noteSpawn(m, 'a1', 'w1', null, NOW - 10 * MIN)
    noteTeammateIdle(m, 'w1', NOW - 5 * MIN)
    noteWorkerToolCall(m, 'a1', NOW - MIN)
    expect(m.workers.get('a1')?.idleSinceAt).toBeNull()
  })

  test('a worker with no spawn record has unavailable model and tool calls, not zeros', () => {
    const snap = snapshotOf([agent('a9', 'ghost', 'running')], null, NOW)
    const [w] = buildMission({ stats: emptyStats('s', 3, 0), snap, state: newMissionState(), nowMs: NOW, teamsEnabled: true, ready: true }).workers
    expect(w).toMatchObject({ model: null, toolCalls: null, lastActivityMs: null, idleMs: null, currentTask: null })
    expect(fmtAge(w?.lastActivityMs ?? null)).toBe('unavailable')
  })

  test('the current task is the in-progress task the worker owns, and only when task calls were seen', () => {
    const m = newMissionState()
    noteSpawn(m, 'a1', 'w1', null, NOW)
    const snap = snapshotOf([agent('a1', 'w1', 'running')], null, NOW)
    const input = { stats: emptyStats('s', 3, 0), snap, state: m, nowMs: NOW, teamsEnabled: true, ready: true }
    expect(buildMission(input).workers[0]?.currentTask).toBeNull()
    create(m, '4', 'write wordcount tests')
    noteTaskCall(m, 'TaskUpdate', { taskId: '4', status: 'in_progress', owner: 'w1' }, { success: true })
    expect(buildMission(input).workers[0]?.currentTask).toBe('#4 write wordcount tests')
  })

  test('turn ends count as activity', () => {
    const m = newMissionState()
    noteSpawn(m, 'a1', 'w1', null, NOW - 9 * MIN)
    noteWorkerTurnEnd(m, 'a1', NOW - MIN)
    noteWorkerTurnEnd(m, undefined, NOW)
    expect(m.workers.get('a1')?.lastActivityAt).toBe(NOW - MIN)
  })

  test('team time starts at the first worker, not at the session', () => {
    const m = newMissionState()
    const base = { stats: emptyStats('s', 3, 0), snap: snapshotOf([], null, NOW), state: m, nowMs: NOW, teamsEnabled: true, ready: true }
    expect(buildMission(base).teamElapsedMs).toBeNull()
    noteSpawn(m, 'a1', 'w1', null, NOW - 3 * MIN)
    noteSpawn(m, 'a2', 'w2', null, NOW - MIN)
    expect(buildMission(base).teamElapsedMs).toBe(3 * MIN)
  })
})

describe('guard', () => {
  const stats = emptyStats('s', 3, 0)
  const snap = snapshotOf([], null, NOW)

  const seen = { ...stats, spawnsSeen: 1 }

  test('each state says why, and only evidence makes it active', () => {
    // Armed but never reached: available, not active, whatever the Claude Code version supports.
    expect(guardOf(stats, snap, true, true)).toMatchObject({ state: 'available', label: 'ready' })
    expect(guardOf(stats, snap, true, true).why).toMatch(/no spawn has reached the guard yet/)
    expect(guardOf(seen, snap, true, true)).toMatchObject({ state: 'active', label: 'ON' })
    // The flag could not be read: even a reached guard is not called active.
    expect(guardOf(seen, snap, null, true)).toMatchObject({ state: 'available' })
    expect(guardOf(stats, snap, null, true).why).toMatch(/flag could not be read/)
    expect(guardOf(seen, snap, false, true)).toMatchObject({ state: 'unavailable', label: '–' })
    expect(guardOf(seen, snap, true, false)).toMatchObject({ state: 'unavailable' })
    expect(guardOf(seen, snapshotOf(null, null, NOW), true, true)).toMatchObject({ state: 'error', label: 'ERR' })
    expect(guardOf({ ...seen, spawnsFailedClosed: 1 }, snap, true, true)).toMatchObject({ state: 'error' })
  })

  test('more live teammates than the cap is an error that names both causes', () => {
    const four = snapshotOf([agent('a1', 'w1', 'running'), agent('a2', 'w2', 'running'), agent('a3', 'w3', 'idle'), agent('a4', 'w4', 'running')], null, NOW)
    const g = guardOf(seen, four, true, true)
    expect(g).toMatchObject({ state: 'error', label: 'ERR' })
    expect(g.why).toBe('4 teammates are live, above the cap of 3: they started before the cap was lowered, or outside the guard')
    // exactly at the cap is fine
    const three = snapshotOf(four.workers.slice(0, 3).map((w, i) => agent(`b${i}`, `x${i}`, 'running')), null, NOW)
    expect(guardOf(seen, three, true, true).state).toBe('active')
  })
})

describe('mission model', () => {
  test('counts running, idle, completed and failed from the roster', () => {
    const snap = snapshotOf(
      [agent('a1', 'a', 'running'), agent('a2', 'b', 'idle'), agent('a3', 'c', 'completed'), agent('a4', 'd', 'failed'), agent('a5', 'e', 'killed')],
      null,
      NOW,
    )
    const m = buildMission({ stats: emptyStats('s', 3, 0), snap, state: newMissionState(), nowMs: NOW, teamsEnabled: true, ready: true })
    expect(m).toMatchObject({ active: 2, running: 1, idle: 1, completed: 1, failed: 2 })
  })

  test('without task calls the task counts fall back to the task events, with no detail', () => {
    const stats = emptyStats('s', 3, 0)
    stats.tasks = { created: 7, completed: 4 }
    const m = buildMission({ stats, snap: snapshotOf([], null, NOW), state: newMissionState(), nowMs: NOW, teamsEnabled: true, ready: true })
    expect(m.tasks).toMatchObject({ detailed: false, total: 7, completed: 4, pending: null, blocked: null, ready: null })
  })

  test('with no task data at all every count is null, never zero', () => {
    const m = buildMission({ stats: emptyStats('s', 3, 0), snap: snapshotOf(null, null, NOW), state: newMissionState(), nowMs: NOW, teamsEnabled: null, ready: false })
    expect(m.tasks).toMatchObject({ detailed: false, total: null, completed: null })
    expect(m).toMatchObject({ active: null, running: null, idle: null, completed: null, failed: null })
    expect(m.usage).toMatchObject({ contextPct: 'unavailable', fiveHour: 'unavailable', sevenDay: 'unavailable', cost: 'unavailable', model: null })
  })

  test('usage shows the countdown, and a window that already reset as unavailable', () => {
    const stats = emptyStats('s', 3, 0)
    stats.measured.fiveHourPct = 28.4
    stats.measured.fiveHourResetsAt = new Date(NOW + 154 * MIN).toISOString()
    stats.measured.sevenDayPct = 51
    stats.measured.sevenDayResetsAt = new Date(NOW - MIN).toISOString()
    const m = buildMission({ stats, snap: snapshotOf([], null, NOW), state: newMissionState(), nowMs: NOW, teamsEnabled: true, ready: true })
    expect(m.usage.fiveHour).toBe('28% (resets in 2h34m)')
    expect(m.usage.sevenDay).toBe('unavailable (window reset)')
  })

  test('the text answer and the status JSON carry the same facts', () => {
    const stats = emptyStats('s', 3, 0)
    stats.toolCalls = 12
    const snap = snapshotOf([agent('a1', 'w1', 'running')], null, NOW)
    const m = buildMission({ stats, snap, state: newMissionState(), nowMs: NOW, teamsEnabled: true, ready: true })
    expect(missionText(m)).toContain('workers:  1/3 active, 1 running, 0 idle, 0 completed, 0 failed; 0 refused')
    expect(missionText(m)).toContain('12 tool calls')
    expect(missionText(m)).toContain('unavailable')
    expect(missionJson(m)).toMatchObject({ guard: { state: 'available' }, outsideCap: 0, running: 1, usage: { toolCalls: 12 } })
  })
})

describe('pane presses', () => {
  const mc = newMcState()

  test('view tabs switch the view and clear a selection', () => {
    const picked = pressMc(mc, workerKey('a1')).mc
    expect(picked).toMatchObject({ view: 'workers', selected: { kind: 'worker', id: 'a1' } })
    expect(pressMc(picked, viewKey('usage')).mc).toMatchObject({ view: 'usage', selected: null })
  })

  test('selecting a task opens its detail; Back returns to the list', () => {
    const picked = pressMc(mc, taskKey('3')).mc
    expect(picked).toMatchObject({ view: 'tasks', selected: { kind: 'task', id: '3' } })
    expect(pressMc(picked, BACK_KEY).mc.selected).toBeNull()
  })

  test('the doctor view asks the host to read the report; refresh does too there', () => {
    expect(pressMc(mc, viewKey('doctor'))).toMatchObject({ effect: 'doctor', mc: { view: 'doctor' } })
    expect(pressMc(pressMc(mc, viewKey('doctor')).mc, REFRESH_KEY).effect).toBe('doctor')
    expect(pressMc(mc, REFRESH_KEY).effect).toBe('refresh')
  })

  test('close is an effect, not a state change', () => {
    expect(pressMc(mc, CLOSE_KEY)).toEqual({ mc, effect: 'close' })
    expect(pressMc(mc, 'mc:cfg:confirm:c7')).toEqual({ mc, effect: 'confirm', id: 'c7' })
    expect(pressMc(mc, 'mc:cfg:cancel:c7')).toEqual({ mc, effect: 'cancel', id: 'c7' })
  })

  test('the HUD form is session state: auto, compact, standard, full', () => {
    expect(pressMc(mc, hudKey('compact')).mc.hudMode).toBe('compact')
    expect(pressMc(mc, hudKey('full')).mc.hudMode).toBe('full')
    expect(pressMc(mc, 'mc:hud:bogus').mc).toBe(mc)
    expect([forcedTierColumns('auto'), forcedTierColumns('compact'), forcedTierColumns('standard'), forcedTierColumns('full')]).toEqual([undefined, 60, 100, 200])
  })

  test('unknown keys and unknown views change nothing', () => {
    expect(pressMc(mc, 'something-else').mc).toBe(mc)
    expect(pressMc(mc, 'mc:view:nope').mc).toBe(mc)
  })
})
