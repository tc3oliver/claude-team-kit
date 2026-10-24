import { describe, expect } from 'claude-code/testing'

import { capNotice, SUMMARY_MAX, teamNotices, teamSummary } from '../hooks/notify.ts'
import { emptySnapshot, snapshotOf } from '../hooks/team.ts'
import type { TaskRec } from '../hooks/mission.ts'
import { engine, fresh, spawnInput, test } from './world.ts'

const agent = (name: string, status: string) => ({ id: `id-${name}`, teammateId: `${name}@t`, description: '', type: 'teammate', status })
const snap = (...a: ReturnType<typeof agent>[]) => snapshotOf(a, null, 0)
const task = (id: string, status: TaskRec['status'], owner: string | null = null): TaskRec => ({ id, subject: 's', status, owner, blockedBy: [], blocks: [] })

describe('teamNotices', () => {
  test('all finished is announced once, on the live-to-zero edge', async () => {
    const seen = new Set<string>()
    const before = snap(agent('a', 'running'))
    const after = snap(agent('a', 'completed'))
    expect(teamNotices(before, after, seen)).toEqual(['All teammates finished.'])
    expect(teamNotices(after, after, seen)).toEqual([])
  })

  test('a failure is announced once and replaces the finished notice', async () => {
    const seen = new Set<string>()
    const before = snap(agent('a', 'running'))
    const after = snap(agent('a', 'killed'))
    expect(teamNotices(before, after, seen)).toEqual(['Teammate a killed.'])
    expect(teamNotices(after, after, seen)).toEqual([])
  })

  test('nothing from an unreadable roster, and a first reading only seeds', async () => {
    const seen = new Set<string>()
    const dead = snap(agent('a', 'failed'))
    expect(teamNotices(snap(agent('a', 'running')), emptySnapshot(), seen)).toEqual([])
    expect(teamNotices(emptySnapshot(), dead, seen)).toEqual([])
    expect(teamNotices(dead, dead, seen)).toEqual([])
  })

  test('a team that was never live stays quiet', async () => {
    expect(teamNotices(snap(), snap(), new Set())).toEqual([])
  })
})

describe('teamSummary', () => {
  test('null with no team and no open task', async () => {
    expect(teamSummary(snap(agent('a', 'completed')), [task('1', 'completed')], 3)).toBeNull()
  })

  test('names live workers, open tasks with owners, and the cap', async () => {
    const text = teamSummary(snap(agent('a', 'running'), agent('b', 'idle'), agent('c', 'failed')), [task('1', 'in_progress', 'a'), task('2', 'pending'), task('3', 'completed')], 3)
    expect(text).toContain('cap 3')
    expect(text).toContain('a running, b idle')
    expect(text).not.toContain('c failed')
    expect(text).toContain('#1 in_progress (a), #2 pending')
    expect(text).not.toContain('#3')
  })

  test('stays short with many tasks', async () => {
    const tasks = Array.from({ length: 200 }, (_, i) => task(String(i), 'pending', 'someone-with-a-long-name'))
    const text = teamSummary(snap(), tasks, 5) as string
    expect(text.length).toBeLessThanOrEqual(SUMMARY_MAX)
    expect(text).toContain('more')
  })
})

describe('wired into the hooks', () => {
  test('cap refusal and team completion each notify once', async ($, on) => {
    const w = fresh()
    engine(on, w)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    for (let i = 0; i < 3; i++) await $.agent.spawn(spawnInput(i))
    const refused = await $.agent.spawn(spawnInput(9))
    expect(refused.deny).toBeDefined()
    expect(w.notices).toEqual([capNotice(3, 3)])
    for (const a of w.agents) a.status = 'completed'
    await $.session.measure({ changed: [] } as never)
    await $.session.measure({ changed: [] } as never)
    expect(w.notices).toEqual([capNotice(3, 3), 'All teammates finished.'])
  })
})
