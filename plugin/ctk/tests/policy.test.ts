import { describe, expect, test } from 'claude-code/testing'

import { STATUS_TOOL } from '../hooks/team.ts'
import { engine, fresh, spawnInput } from './world.ts'

const STATS = '/cfg/ctk/stats/sess_1.json'

const END = { reason: 'other', sessionId: 'sess/1' } as never

const written = (w: ReturnType<typeof fresh>) => JSON.parse(w.files.get(STATS) ?? 'null')

describe('model routing', () => {
  test('a CTK role without a model gets its configured alias', async ($, on) => {
    const w = fresh()
    engine(on, w)
    for (const [i, type] of ['ctk:explorer', 'ctk:implementer', 'ctk:reviewer', 'ctk:high-risk-reviewer'].entries()) {
      await $.agent.spawn(spawnInput(i, false, { subagentType: type }))
    }
    expect(w.models).toEqual(['haiku', 'sonnet', 'sonnet', 'opus'])
  })

  test('configured models apply, teammates included', { options: { explorerModel: 'claude-haiku-5-5' } }, async ($, on) => {
    const w = fresh()
    engine(on, w)
    await $.agent.spawn(spawnInput(0, true, { subagentType: 'ctk:explorer' }))
    expect(w.models).toEqual(['claude-haiku-5-5'])
  })

  test('an explicit model is never overridden', async ($, on) => {
    const w = fresh()
    engine(on, w)
    await $.agent.spawn(spawnInput(0, false, { subagentType: 'ctk:explorer', model: 'opus' }))
    expect(w.models).toEqual(['opus'])
  })

  test('agents that are not CTK roles are untouched', async ($, on) => {
    const w = fresh()
    engine(on, w)
    await $.agent.spawn(spawnInput(0, false, { subagentType: 'Explore' }))
    await $.agent.spawn(spawnInput(1, true))
    expect(w.models).toEqual([undefined, undefined])
  })

  test('inherit passes the spawn through unchanged', { options: { implementerModel: 'inherit' } }, async ($, on) => {
    const w = fresh()
    engine(on, w)
    await $.agent.spawn(spawnInput(0, false, { subagentType: 'ctk:implementer' }))
    expect(w.models).toEqual([undefined])
  })
})

describe('verified acceptance and stats', () => {
  test('an accepted spawn without agentId and teammateId is not counted', async ($, on) => {
    const w = fresh()
    engine(on, w, undefined, { noIds: true })
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    const r = await $.agent.spawn(spawnInput(0))
    expect(r.deny).toBeUndefined()
    await $.session.end(END)
    const s = written(w)
    expect(s.spawnsAccepted).toBe(0)
    expect(s.workerModels).toEqual({})
  })

  test('an accepted spawn is counted with the model Claude Code reports', async ($, on) => {
    const w = fresh()
    engine(on, w, undefined, { modelOf: e => (e.subagentType === 'ctk:explorer' ? 'claude-haiku-5-5' : 'sonnet') })
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    await $.agent.spawn(spawnInput(0, true, { subagentType: 'ctk:explorer' }))
    await $.agent.spawn(spawnInput(1))
    await $.session.end(END)
    const s = written(w)
    expect(s).toMatchObject({
      schemaVersion: 1,
      sessionId: 'sess/1',
      maxWorkers: 3,
      spawnsAccepted: 2,
      spawnsRejected: 0,
      workerModels: { 'claude-haiku-5-5': 1, sonnet: 1 },
    })
  })

  test('refusals and peak live are counted; the file holds counters only', async ($, on) => {
    const w = fresh()
    engine(on, w)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    for (let i = 0; i < 5; i++) await $.agent.spawn(spawnInput(i))
    await $.session.end(END)
    const s = written(w)
    expect(s).toMatchObject({ spawnsAccepted: 3, spawnsRejected: 2, peakLive: 3, tasks: null })
    expect(Object.keys(s).sort()).toEqual(
      ['maxWorkers', 'measured', 'peakLive', 'schemaVersion', 'sessionId', 'spawnsAccepted', 'spawnsFailedClosed', 'spawnsRejected', 'startedAt', 'tasks', 'updatedAt', 'workerModels'],
    )
    expect(JSON.stringify(s)).not.toMatch(/work item|worker-|\/w/)
  })

  test('writes are throttled to one per 2 s and flushed at session end', async ($, on) => {
    const w = fresh()
    const clock = engine(on, w)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    expect(written(w).spawnsAccepted).toBe(0)
    await $.agent.spawn(spawnInput(0))
    expect(written(w).spawnsAccepted).toBe(0)
    await clock.advance(2000)
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1' })
    expect(written(w).spawnsAccepted).toBe(1)
    await $.agent.spawn(spawnInput(1))
    expect(written(w).spawnsAccepted).toBe(1)
    await $.session.end(END)
    expect(written(w).spawnsAccepted).toBe(2)
  })

  test('recordStats=false writes nothing', { options: { recordStats: false } }, async ($, on) => {
    const w = fresh()
    engine(on, w)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    await $.agent.spawn(spawnInput(0))
    expect(w.files.size).toBe(0)
  })

  test('a failing stats write never affects a spawn', async ($, on) => {
    const w = fresh()
    engine(on, w, undefined, { writeFails: true })
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    const r = await $.agent.spawn(spawnInput(0))
    expect(r.deny).toBeUndefined()
    expect(w.started).toBe(1)
  })
})

describe('session.start again (enable, respawn, reload)', () => {
  const START = { cwd: '/w', surface: null, isInteractive: false } as const

  test('counters continue from the stats file', async ($, on) => {
    const w = fresh()
    engine(on, w)
    await $.session.start(START)
    for (let i = 0; i < 4; i++) await $.agent.spawn(spawnInput(i))
    await $.classic.TaskCreated({ task_id: '1', task_subject: 'a' })
    await $.session.end(END)
    const startedAt = written(w).startedAt
    await $.session.start(START)
    const out = await $.command.run({ command: 'ctk-stats', args: '' } as never)
    expect(out.text).toContain('teammate spawns: 3 accepted, 1 refused at capacity')
    expect(out.text).toContain('tasks created/completed: 1/0')
    await $.session.end(END)
    expect(written(w).startedAt).toBe(startedAt)
  })

  for (const [label, text] of [
    ['another session', JSON.stringify({ schemaVersion: 1, sessionId: 'other', spawnsAccepted: 9, spawnsRejected: 9 })],
    ['a broken file', '{not json'],
  ] as const) {
    test(`a stats file of ${label} is ignored`, async ($, on) => {
      const w = fresh()
      w.files.set(STATS, text)
      engine(on, w)
      await $.session.start(START)
      const out = await $.command.run({ command: 'ctk-stats', args: '' } as never)
      expect(out.text).toContain('teammate spawns: 0 accepted, 0 refused at capacity')
    })
  }

  test('a failed write is retried by the forced write at session end', async ($, on) => {
    const w = fresh()
    engine(on, w)
    w.failWrites = true
    await $.session.start(START)
    await $.agent.spawn(spawnInput(0))
    expect(w.files.size).toBe(0)
    w.failWrites = false
    await $.session.end(END)
    expect(written(w).spawnsAccepted).toBe(1)
  })
})

describe('task counters', () => {
  test('TaskCreated and TaskCompleted count and never block', async ($, on) => {
    const w = fresh()
    engine(on, w)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    expect(written(w).tasks).toBeNull()
    const created = await $.classic.TaskCreated({ task_id: '1', task_subject: 'a' })
    await $.classic.TaskCreated({ task_id: '2', task_subject: 'b' })
    const done = await $.classic.TaskCompleted({ task_id: '1', task_subject: 'a' })
    expect(created.block).toBeUndefined()
    expect(done.block).toBeUndefined()
    const out = await $.command.run({ command: 'ctk-stats', args: '' } as never)
    expect(out.text).toMatch(/tasks created\/completed: 2\/1/)
  })
})

describe('status tool and command', () => {
  test('session start registers the status tool and the command', async ($, on) => {
    const w = fresh()
    engine(on, w)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    expect(w.registeredTools).toEqual(['ctk_team_status'])
    expect(w.registeredCommands).toEqual(['ctk-stats'])
  })

  test('ctk_team_status reports the real roster and counters', async ($, on) => {
    const w = fresh()
    engine(on, w)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    for (let i = 0; i < 4; i++) await $.agent.spawn(spawnInput(i))
    w.agents[0]!.status = 'idle'
    const r: any = await $.tool.call({ tool: STATUS_TOOL })
    const status = JSON.parse(r.result.content[0].text)
    expect(status).toEqual({
      live: 3,
      max: 3,
      workers: [
        { name: 'worker-0', teammateId: 'worker-0@session-test', status: 'idle' },
        { name: 'worker-1', teammateId: 'worker-1@session-test', status: 'running' },
        { name: 'worker-2', teammateId: 'worker-2@session-test', status: 'running' },
      ],
      rejected: 1,
      accepted: 3,
    })
  })

  test('ctk_team_status shows live as null when the roster is unreadable', async ($, on) => {
    const w = fresh()
    engine(on, w, undefined, { listFails: true })
    const r: any = await $.tool.call({ tool: STATUS_TOOL })
    expect(JSON.parse(r.result.content[0].text)).toMatchObject({ live: null, workers: [] })
  })

  test('ctk-stats labels counted vs measured and admits no per-worker cost', async ($, on) => {
    const w = fresh()
    w.usage = { startedAt: 1_000_000 - 90_000, context: { window: 200000, percent: 42 }, rateLimits: [], cost: { usd: 0.42 } }
    engine(on, w)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    await $.agent.spawn(spawnInput(0, true, { subagentType: 'ctk:implementer' }))
    const out = await $.command.run({ command: 'ctk-stats', args: '' } as never)
    expect(out.text).toContain('counted by CTK:')
    expect(out.text).toContain('measured (reported by Claude Code):')
    expect(out.text).toContain('teammate spawns: 1 accepted, 0 refused at capacity, 0 failed closed')
    expect(out.text).toContain('cost: $0.42  context: 42%  5h limit: –  7d limit: –')
    expect(out.text).toContain('worker models: sonnet×1')
    expect(out.text).toContain('per-worker cost: not available from Claude Code')
  })
})
