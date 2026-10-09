import { describe, expect, test } from 'claude-code/testing'

import { STATUS_TOOL, startsOutsideCap } from '../hooks/team.ts'
import { parseStats } from '../shared/stats.ts'
import { engine, fresh, spawnInput, statusOf } from './world.ts'

// What the worker limit does and does not cover, and what the guard can honestly say about itself.
// The facts under the first block were observed live on Claude Code 2.1.295 (docs/REVIEW.md): a named
// Agent call is a teammate, a named call that passes `isolation` is an ordinary subagent without
// `isTeammate`, an unnamed call is an ordinary subagent. The tests drive the same event shapes.

const FLAG = 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'
const TEAMS_ON = { env: { [FLAG]: '1' } }

// What Claude Code sent for a named call with `isolation: worktree` (no `isTeammate`), as the live probe logged it.
const isolated = (i: number) => spawnInput(i, false, { name: `iso-${i}`, subagentType: 'ctk:explorer' })
const unnamed = (i: number) => {
  const { name: _name, ...rest } = spawnInput(i, false)
  return rest
}

describe('which spawns the limit covers', () => {
  test('a teammate from any provider counts the same: the gate reads isTeammate, not who defined the agent', async ($, on) => {
    const w = fresh()
    engine(on, w)
    const providers = [
      { plugin: 'engine', tier: 'core' },
      { plugin: 'ctk@ctk-kit', tier: 'user' },
      { plugin: 'someone-else@their-market', tier: 'user' },
    ]
    const results = []
    for (let i = 0; i < 4; i++) {
      results.push(await $.agent.spawn(spawnInput(i, true, { provider: providers[i % 3] as never, subagentType: i % 2 === 0 ? 'general-purpose' : 'other:reviewer' })))
    }
    expect(results.map(r => r.deny === undefined)).toEqual([true, true, true, false])
    expect(results[3]?.deny).toMatch(/^TEAM_CAPACITY_REACHED: live=3/)
  })

  test('a named agent with isolation is not a teammate: it starts above the cap and is counted as outside it', async ($, on) => {
    const w = fresh()
    engine(on, w, undefined, TEAMS_ON)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    for (let i = 0; i < 3; i++) await $.agent.spawn(spawnInput(i))
    expect((await $.agent.spawn(spawnInput(3))).deny).toMatch(/TEAM_CAPACITY_REACHED/)
    const iso = await $.agent.spawn(isolated(4))
    expect(iso.deny).toBeUndefined()
    expect(iso.teammateId).toBeUndefined()
    const status = statusOf(await $.tool.call({ tool: STATUS_TOOL }))
    expect(status.outsideCap).toBe(1)
    expect(status.live).toBe(3)
    expect(status.rejected).toBe(1)
  })

  test('an unnamed subagent and a fork are never limited and never counted as outside the cap', async ($, on) => {
    const w = fresh()
    engine(on, w, undefined, TEAMS_ON)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    for (let i = 0; i < 5; i++) expect((await $.agent.spawn(unnamed(i) as never)).deny).toBeUndefined()
    expect((await $.agent.spawn(spawnInput(9, false, { fork: true }))).deny).toBeUndefined()
    expect(statusOf(await $.tool.call({ tool: STATUS_TOOL })).outsideCap).toBe(0)
  })

  test('startsOutsideCap needs Agent Teams confirmed on: with the flag off or unknown a named subagent is simply a subagent', () => {
    const named = { name: 'x', fork: false } as const
    expect(startsOutsideCap(named, true)).toBe(true)
    expect(startsOutsideCap(named, false)).toBe(false)
    expect(startsOutsideCap(named, null)).toBe(false)
    expect(startsOutsideCap({ ...named, isTeammate: true }, true)).toBe(false)
    expect(startsOutsideCap({ fork: false }, true)).toBe(false)
    expect(startsOutsideCap({ ...named, fork: true }, true)).toBe(false)
    expect(startsOutsideCap({ ...named, workflow: { runId: 'wf_x', agentIndex: 1 } }, true)).toBe(false)
  })
})

describe('guard health is judged from evidence', () => {
  const guard = async ($: any) => statusOf(await $.tool.call({ tool: STATUS_TOOL })).guard

  test('loaded and armed is "available" until a spawn reaches it, then "active"', async ($, on) => {
    const w = fresh()
    engine(on, w, undefined, TEAMS_ON)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    expect(await guard($)).toMatchObject({ state: 'available' })
    await $.agent.spawn(spawnInput(0))
    expect(await guard($)).toMatchObject({ state: 'active' })
  })

  test('an ordinary subagent spawn also proves the hook is reached', async ($, on) => {
    const w = fresh()
    engine(on, w, undefined, TEAMS_ON)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    await $.agent.spawn(unnamed(0) as never)
    expect(await guard($)).toMatchObject({ state: 'active' })
  })

  test('the Agent Teams flag off is "unavailable", never "active"', async ($, on) => {
    const w = fresh()
    engine(on, w, undefined, { env: { [FLAG]: '0' } })
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    await $.agent.spawn(unnamed(0) as never)
    expect(await guard($)).toMatchObject({ state: 'unavailable' })
  })

  test('a flag that cannot be read keeps the guard at "available" even after spawns', async ($, on) => {
    const w = fresh()
    engine(on, w, undefined, { envFails: true })
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    await $.agent.spawn(spawnInput(0))
    expect(await guard($)).toMatchObject({ state: 'available' })
  })

  test('a roster that cannot be read is an error, and the spawn it blocks is refused, not allowed', async ($, on) => {
    const w = fresh()
    engine(on, w, undefined, TEAMS_ON)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    await $.agent.spawn(spawnInput(0))
    w.listFails = true
    const r = await $.agent.spawn(spawnInput(1))
    expect(r.deny).toMatch(/^TEAM_GUARD_FAILED/)
    w.listFails = false
    expect(await guard($)).toMatchObject({ state: 'error' })
  })

  test('more live teammates than the cap reads as an error with the reason, not as a working guard', async ($, on) => {
    const w = fresh()
    engine(on, w, undefined, TEAMS_ON)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    await $.agent.spawn(spawnInput(0))
    // Four teammates the guard never saw (started outside it) appear in the roster.
    for (let i = 1; i < 4; i++) w.agents.push({ id: `x${i}`, teammateId: `late-${i}@session-test`, description: '', type: 'teammate', status: 'running' })
    const g = await guard($)
    expect(g.state).toBe('error')
    expect(g.why).toMatch(/4 teammates are live, above the cap of 3/)
  })
})

describe('doctor and the status tool say what the guard covers', () => {
  test('the doctor shows the guard state and that only teammates are limited', async ($, on) => {
    const w = fresh()
    engine(on, w, undefined, TEAMS_ON)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    await $.agent.spawn(isolated(0))
    const text = ((await $.command.run({ command: 'ctk-doctor', args: '' } as never)).text ?? '').split('\n')
    expect(text.find(l => l.includes('guard:'))).toMatch(/guard: ON \(reached by 1 spawn/)
    expect(text.find(l => l.includes('outside the cap'))).toMatch(/1 named agent\(s\) started as ordinary subagents/)
  })

  test('the stats file keeps the two new counters, and an older file without them reads as zero', () => {
    const old = { schemaVersion: 1, sessionId: 's', startedAt: 1, updatedAt: 1, maxWorkers: 3, spawnsAccepted: 1, spawnsRejected: 0, spawnsFailedClosed: 0, peakLive: 1, workerModels: {}, tasks: null }
    expect(parseStats(old)).toMatchObject({ spawnsSeen: 0, spawnsOutsideCap: 0 })
    expect(parseStats({ ...old, spawnsSeen: 4, spawnsOutsideCap: 2 })).toMatchObject({ spawnsSeen: 4, spawnsOutsideCap: 2 })
    expect(parseStats({ ...old, spawnsSeen: -1, spawnsOutsideCap: 'x' })).toMatchObject({ spawnsSeen: 0, spawnsOutsideCap: 0 })
  })
})
