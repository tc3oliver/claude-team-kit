import { describe, expect, test } from 'claude-code/testing'
import type { AgentInfo } from 'claude-code'

import { formatBand } from '../hooks/band.ts'
import { buildMission, collisionLine, newCollisionNote, newMissionState, noteFileChange, noteLeadBash, noteSpawn, noteTaskCall, noteWorkerActive, noteWorkerToolCall, noteWorkerTurnEnd, signalsOf, stalledOf, STALL_MS, taskRows } from '../hooks/mission.ts'
import { stallNotices } from '../hooks/notify.ts'
import { snapshotOf } from '../hooks/team.ts'
import { emptyStats } from '../shared/stats.ts'

const NOW = Date.UTC(2026, 9, 9, 3)
const MIN = 60_000

const agent = (id: string, name: string, status: AgentInfo['status']): AgentInfo => ({ id, teammateId: `${name}@t`, description: '', type: 'teammate', status })

// One worker "w1" owning in-progress task 1, spawned at NOW.
const team = (status: AgentInfo['status'] = 'running') => {
  const m = newMissionState()
  noteSpawn(m, 'a1', 'w1', null, NOW)
  noteTaskCall(m, 'TaskCreate', { subject: 's' }, { task: { id: '1', subject: 's' } })
  noteTaskCall(m, 'TaskUpdate', { taskId: '1', status: 'in_progress', owner: 'w1' }, { success: true })
  return { m, snap: snapshotOf([agent('a1', 'w1', status)], null, NOW) }
}

describe('stalled workers', () => {
  test('no activity for 10 minutes while owning an in-progress task', () => {
    const { m, snap } = team()
    expect(stalledOf(m, snap, NOW + STALL_MS - 1)).toEqual([])
    expect(stalledOf(m, snap, NOW + 12 * MIN)).toEqual([{ name: 'w1', reason: 'no activity', forMs: 12 * MIN }])
  })

  test('a call that has started is activity, so a long-running tool is not a stall', () => {
    const { m, snap } = team()
    noteWorkerActive(m, 'a1', NOW + 11 * MIN)
    expect(stalledOf(m, snap, NOW + 15 * MIN)).toEqual([])
  })

  test('three failed calls in a row, reset by one success', () => {
    const { m, snap } = team()
    for (let i = 0; i < 3; i++) noteWorkerToolCall(m, 'a1', NOW + i * 1000, 'Bash', true)
    expect(stalledOf(m, snap, NOW + 5000)).toMatchObject([{ name: 'w1', forMs: 5000 }])
    noteWorkerToolCall(m, 'a1', NOW + 6000, 'Bash', false)
    expect(stalledOf(m, snap, NOW + 7000)).toEqual([])
  })

  test('not reported without an in-progress task, or once finished', () => {
    const { m } = team()
    noteTaskCall(m, 'TaskUpdate', { taskId: '1', status: 'completed' }, { success: true })
    expect(stalledOf(m, snapshotOf([agent('a1', 'w1', 'running')], null, NOW), NOW + 20 * MIN)).toEqual([])
    const again = team('completed')
    expect(stalledOf(again.m, again.snap, NOW + 20 * MIN)).toEqual([])
  })

  test('one notice per episode; a new one after the worker is active again', () => {
    const noticed = new Set<string>()
    const s = [{ name: 'w1', reason: 'no activity', forMs: 1 }]
    expect(stallNotices(s, noticed)).toHaveLength(1)
    expect(stallNotices(s, noticed)).toEqual([])
    expect(stallNotices([], noticed)).toEqual([])
    expect(stallNotices(s, noticed)).toHaveLength(1)
  })

  test('the band shows one cell, and the ready/idle hint only when both are above zero', () => {
    const { m, snap } = team()
    const opts = { stalled: stalledOf(m, snap, NOW + 12 * MIN), ready: 2, idleWorkers: 1 }
    const line = formatBand(emptyStats('s', 3, NOW), snap, 200, opts)
    expect(line).toContain('⚠ w1 stalled 12m')
    expect(line).toContain('2 ready · 1 idle')
    expect(formatBand(emptyStats('s', 3, NOW), snap, 200, { ready: 2, idleWorkers: 0 })).not.toContain('ready')
  })
})

describe('ready and idle', () => {
  test('lists ready task ids and idle worker names', () => {
    const { m } = team()
    noteTaskCall(m, 'TaskCreate', { subject: 'b' }, { task: { id: '2', subject: 'b' } })
    const s = signalsOf(m, snapshotOf([agent('a1', 'w1', 'idle')], null, NOW), NOW)
    expect(s.ready).toEqual(['2'])
    expect(s.idleWorkers).toEqual(['w1'])
  })
})

describe('unverified completion', () => {
  test('a teammate completion is unverified until the lead runs a command', () => {
    const { m, snap } = team()
    noteTaskCall(m, 'TaskUpdate', { taskId: '1', status: 'completed' }, { success: true }, 'a1')
    expect(signalsOf(m, snap, NOW).unverified).toEqual(['1'])
    noteLeadBash(m)
    expect(signalsOf(m, snap, NOW).unverified).toEqual([])
  })

  test('a lead completion is not unverified, and reopening clears it', () => {
    const { m, snap } = team()
    noteTaskCall(m, 'TaskUpdate', { taskId: '1', status: 'completed' }, { success: true })
    expect(signalsOf(m, snap, NOW).unverified).toEqual([])
    noteTaskCall(m, 'TaskUpdate', { taskId: '1', status: 'completed' }, { success: true }, 'a1')
    noteTaskCall(m, 'TaskUpdate', { taskId: '1', status: 'in_progress' }, { success: true })
    expect(signalsOf(m, snap, NOW).unverified).toEqual([])
  })

  test('the mission carries the signals', () => {
    const { m, snap } = team()
    const mission = buildMission({ stats: emptyStats('s', 3, NOW), snap, state: m, nowMs: NOW + 12 * MIN, teamsEnabled: true, ready: true })
    expect(mission.signals.stalled).toHaveLength(1)
    expect(mission.workers[0]?.stalled?.name).toBe('w1')
  })
})

describe('file collisions', () => {
  const two = () => {
    const m = newMissionState()
    noteSpawn(m, 'a1', 'w1', null, NOW)
    noteSpawn(m, 'a2', 'w2', null, NOW)
    return { m, snap: snapshotOf([agent('a1', 'w1', 'running'), agent('a2', 'w2', 'running')], null, NOW) }
  }

  test('a second live writer is told once per path', () => {
    const { m, snap } = two()
    const path = noteFileChange(m, 'Edit', { file_path: '/r/a.ts' }, 'a1') as string
    expect(newCollisionNote(m, snap, path)).toBeNull()
    noteFileChange(m, 'Write', { file_path: '/r/a.ts' }, 'a2')
    expect(newCollisionNote(m, snap, path)).toContain('w1 and w2')
    noteFileChange(m, 'Edit', { file_path: '/r/a.ts' }, 'a1')
    expect(newCollisionNote(m, snap, path)).toBeNull()
    expect(signalsOf(m, snap, NOW).collisions).toEqual([{ path: '/r/a.ts', writers: ['w1', 'w2'] }])
    expect(collisionLine(signalsOf(m, snap, NOW).collisions)).toBe('⚠ a.ts written by w1 + w2')
  })

  test('the lead counts, and a finished writer does not', () => {
    const { m } = two()
    noteFileChange(m, 'Edit', { file_path: '/r/b.ts' }, 'a1')
    noteFileChange(m, 'Edit', { file_path: '/r/b.ts' })
    expect(signalsOf(m, snapshotOf([agent('a1', 'w1', 'running')], null, NOW), NOW).collisions[0]?.writers).toEqual(['w1', 'lead'])
    expect(signalsOf(m, snapshotOf([agent('a1', 'w1', 'completed')], null, NOW), NOW).collisions).toEqual([])
  })
})

describe('worker tokens', () => {
  test('each turn.complete adds its own counts; none reported stays null', () => {
    const { m, snap } = team()
    expect(buildMission({ stats: emptyStats('s', 3, NOW), snap, state: m, nowMs: NOW, teamsEnabled: true, ready: true }).workers[0]?.usage).toBeNull()
    noteWorkerTurnEnd(m, 'a1', NOW, { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5 })
    noteWorkerTurnEnd(m, 'a1', NOW, { input_tokens: 50, output_tokens: 10, cache_read_input_tokens: 0 })
    expect(buildMission({ stats: emptyStats('s', 3, NOW), snap, state: m, nowMs: NOW, teamsEnabled: true, ready: true }).workers[0]?.usage).toEqual({ input: 150, output: 30, cacheRead: 5 })
  })
})

describe('large boards', () => {
  test('500 tasks with dependencies build rows in linear time', () => {
    const m = newMissionState()
    for (let i = 1; i <= 500; i++) {
      noteTaskCall(m, 'TaskCreate', { subject: `t${i}` }, { task: { id: String(i), subject: `t${i}` } })
      if (i > 1) noteTaskCall(m, 'TaskUpdate', { taskId: String(i), addBlockedBy: [String(i - 1)] }, { success: true })
    }
    const start = performance.now()
    for (let k = 0; k < 20; k++) signalsOf(m, snapshotOf([], null, NOW), NOW)
    expect(performance.now() - start).toBeLessThan(1000)
    const rows = taskRows(m)
    expect(rows).toHaveLength(500)
    expect(rows[0]?.blocks).toEqual(['2'])
    expect(rows[1]?.blockedBy).toEqual(['1'])
  })
})
