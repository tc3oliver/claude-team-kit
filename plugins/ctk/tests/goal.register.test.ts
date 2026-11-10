import { describe, expect } from 'claude-code/testing'
import { engine, fresh, spawnInput, test } from './world.ts'

const START = { cwd: '/w', surface: null, isInteractive: false }
const GOAL = 'mcp__ctk__ctk_goal'
const STATUS = 'mcp__ctk__ctk_team_status'
const ask = async ($: any, action: string, extra: object = {}) =>
  JSON.parse((await $.tool.call({ tool: GOAL, action, ...extra })).result as string)
const status = async ($: any) =>
  JSON.parse((await $.tool.call({ tool: STATUS })).result as string)
const taskResult = (e: Record<string, unknown>): unknown =>
  e.tool === 'TaskCreate' ? { task: { id: '1', subject: e.subject } } :
  e.tool === 'TaskUpdate' ? { success: true } : 'ok'

describe('goal tool integration', () => {
  test('registers a deferred goal tool and exposes owned workers in status', async ($, on) => {
    const w = fresh()
    engine(on, w)
    await $.session.start(START)
    expect(w.registeredTools).toContain('ctk_goal')
    expect((await ask($, 'start')).goal).toMatchObject({ id: 'goal-1', phase: 'active', workerIds: [] })
    await $.agent.spawn(spawnInput(0, true, { name: 'w1' }))
    expect((await status()).goal).toMatchObject({ id: 'goal-1', workerIds: ['a1'] })
    w.agents[0]!.status = 'idle'
    expect((await ask($, 'close', { goalId: 'goal-1' })).ok).toBe(false)
    expect((await ask($, 'verify', { goalId: 'goal-1' })).ok).toBe(true)
    expect((await ask($, 'review', { goalId: 'goal-1', result: 'passed' })).ok).toBe(true)
    const r = await ask($, 'close', { goalId: 'goal-1' })
    expect(r).toMatchObject({ ok: true, goal: { phase: 'closing', shutdownCandidates: [{ agentId: 'a1', name: 'w1' }] } })
    expect(w.agents[0]!.status).toBe('idle') // ctk_goal never stops it.
    w.agents[0]!.status = 'completed'
    expect((await status()).goal).toMatchObject({ phase: 'closed', confirmedWorkerIds: ['a1'] })
  })

  test('native TaskCreate/TaskUpdate are attributed and incomplete work blocks close', async ($, on) => {
    const w = fresh()
    engine(on, w, undefined, { toolResult: taskResult })
    await $.session.start(START)
    await ask($, 'start')
    await $.agent.spawn(spawnInput(0, true, { name: 'w1' }))
    w.agents[0]!.status = 'idle'
    await $.tool.call({ tool: 'TaskCreate', tool_use_id: 'tc1', subject: 'build' })
    expect((await status()).goal).toMatchObject({ taskIds: ['1'], unverifiedOrOpen: ['1'] })
    expect((await ask($, 'verify', { goalId: 'goal-1' })).ok).toBe(false)
    await $.tool.call({ tool: 'TaskUpdate', tool_use_id: 'tu1', agentId: 'a1', taskId: '1', status: 'completed' })
    expect((await status()).goal).toMatchObject({ unverifiedOrOpen: ['1'] })
    await $.tool.call({ tool: 'TaskUpdate', tool_use_id: 'tu2', taskId: '1', status: 'completed' })
    expect((await status()).goal).toMatchObject({ unverifiedOrOpen: [] })
    expect((await ask($, 'verify', { goalId: 'goal-1' })).ok).toBe(true)
    expect((await ask($, 'review', { goalId: 'goal-1', result: 'passed' })).ok).toBe(true)
    expect((await ask($, 'close', { goalId: 'goal-1' })).ok).toBe(true)
  })

  test('without Task tools the lead can attest but a previous live worker blocks a new goal', async ($, on) => {
    const w = fresh()
    w.tools = []
    engine(on, w)
    await $.session.start(START)
    await $.agent.spawn(spawnInput(0, true, { name: 'old' }))
    const result = await ask($, 'start')
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('live workers') })
    expect((await status()).goal).toBeNull()
  })

  test('roster unavailable blocks changes and teammate cannot attest for the lead', async ($, on) => {
    const w = fresh()
    engine(on, w)
    await $.session.start(START)
    await ask($, 'start')
    await $.agent.spawn(spawnInput(0, true, { name: 'w1' }))
    const denied = await $.tool.call({ tool: GOAL, action: 'verify', goalId: 'goal-1', agentId: 'a1' })
    expect(JSON.parse(denied.result as string)).toMatchObject({ ok: false, error: expect.stringContaining('only the lead') })
    expect((await status()).goal.verification).toBe('unknown')
    w.listFails = true
    expect((await ask($, 'close', { goalId: 'goal-1' })).ok).toBe(false)
  })
})
