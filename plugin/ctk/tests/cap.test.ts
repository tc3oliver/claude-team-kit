import { describe, expect, test } from 'claude-code/testing'

import { engine, fresh, live, spawnInput } from './world.ts'

const spawnSix = ($: any, from = 0, teammate = true) =>
  Promise.all(Array.from({ length: 6 }, (_, i) => $.agent.spawn(spawnInput(from + i, teammate))))

describe('teammate cap (default 3)', () => {
  test('6 concurrent teammate spawns: exactly 3 start, 3 refused, peak never above 3', async ($, on) => {
    const w = fresh()
    engine(on, w)
    const results = await spawnSix($)
    const denied = results.filter(r => r.deny !== undefined)
    expect(w.started).toBe(3)
    expect(denied.length).toBe(3)
    expect(w.peak).toBeLessThanOrEqual(3)
    expect(String(denied[0].deny)).toMatch(/^TEAM_CAPACITY_REACHED: live=\d+ starting=\d+ max=3\./)
  })

  test('2 already live + 6 concurrent: exactly 1 more starts', async ($, on) => {
    const w = fresh()
    w.agents.push(
      { id: 'x1', teammateId: 'a@t', description: '', type: 'teammate', status: 'idle' },
      { id: 'x2', teammateId: 'b@t', description: '', type: 'teammate', status: 'running' },
    )
    engine(on, w)
    await spawnSix($)
    expect(w.started).toBe(1)
    expect(live(w)).toBe(3)
  })

  test('finished teammates free their slot; idle ones do not', async ($, on) => {
    const w = fresh()
    w.agents.push(
      { id: 'x1', teammateId: 'a@t', description: '', type: 'teammate', status: 'completed' },
      { id: 'x2', teammateId: 'b@t', description: '', type: 'teammate', status: 'killed' },
      { id: 'x3', teammateId: 'c@t', description: '', type: 'teammate', status: 'idle' },
    )
    engine(on, w)
    await spawnSix($)
    expect(w.started).toBe(2)
  })

  test('plain subagents are never capped', async ($, on) => {
    const w = fresh()
    engine(on, w)
    const results = await spawnSix($, 0, false)
    expect(results.every(r => r.deny === undefined)).toBe(true)
    expect(w.spawnCalls).toBe(6)
  })

  test('sequential spawns after a teammate finishes are allowed again', async ($, on) => {
    const w = fresh()
    engine(on, w)
    for (let i = 0; i < 3; i++) await $.agent.spawn(spawnInput(i))
    expect((await $.agent.spawn(spawnInput(3))).deny).toBeDefined()
    w.agents[0]!.status = 'completed'
    expect((await $.agent.spawn(spawnInput(4))).deny).toBeUndefined()
    expect(live(w)).toBe(3)
  })

  test('fails closed when the roster cannot be read', async ($, on) => {
    const w = fresh()
    engine(on, w, undefined, { listFails: true })
    const r = await $.agent.spawn(spawnInput(0))
    expect(String(r.deny)).toMatch(/^TEAM_GUARD_FAILED:/)
    expect(w.spawnCalls).toBe(0)
  })

  test('the same roster failure never blocks a plain subagent', async ($, on) => {
    const w = fresh()
    engine(on, w, undefined, { listFails: true })
    const r = await $.agent.spawn(spawnInput(0, false))
    expect(r.deny).toBeUndefined()
    expect(w.spawnCalls).toBe(1)
  })
})

describe('teammate cap (configured)', () => {
  test('maxWorkers 5: 6 concurrent spawns start 5', { options: { maxWorkers: 5 } }, async ($, on) => {
    const w = fresh()
    engine(on, w)
    await spawnSix($)
    expect(w.started).toBe(5)
    expect(w.peak).toBeLessThanOrEqual(5)
  })

  test('maxWorkers 1: serialises to one teammate', { options: { maxWorkers: 1 } }, async ($, on) => {
    const w = fresh()
    engine(on, w)
    await spawnSix($)
    expect(w.started).toBe(1)
  })
})

describe('race stress', () => {
  // Varying startup latency per spawn reorders when each reaches the roster.
  for (const [label, delay] of [
    ['instant', () => 0],
    ['slow first', (n: number) => (n === 1 ? 40 : 1)],
    ['slow last', (n: number) => (n >= 3 ? 40 : 1)],
    ['alternating', (n: number) => (n % 2 ? 25 : 2)],
    ['pseudo-random', (n: number) => (n * 7919) % 31],
  ] as const) {
    test(`6 concurrent, ${label}: never above cap, never below cap`, async ($, on) => {
      const w = fresh()
      engine(on, w, delay)
      const results = await spawnSix($)
      expect(w.peak).toBeLessThanOrEqual(3)
      expect(w.started).toBe(3)
      expect(results.filter(r => r.deny !== undefined).length).toBe(3)
    })
  }
})

describe('double-count window', () => {
  // Teammate visible in the roster for a while before next() resolves: the
  // cap may count it twice. The hard limit must still hold.
  for (const late of [5, 50]) {
    test(`roster-before-return ${late} ticks: peak never above cap`, async ($, on) => {
      const w = fresh()
      engine(on, w, n => n * 3, { lateReturn: late })
      await spawnSix($)
      expect(w.peak).toBeLessThanOrEqual(3)
    })
  }
})
