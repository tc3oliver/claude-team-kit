import { describe, expect } from 'claude-code/testing'

import { budgetReached, forecastFull, noteSample } from '../hooks/team.ts'
import type { PctSample } from '../hooks/team.ts'
import { DEFAULT_OPTIONS } from '../shared/policy.ts'
import { STATUS_TOOL } from '../hooks/team.ts'
import { engine, fresh, spawnInput, statusOf, test } from './world.ts'

const MIN = 60_000

describe('usage gate', () => {
  test('off by default: high usage refuses nothing', async ($, on) => {
    const w = fresh()
    w.usage = { startedAt: 0, context: { window: 1 }, rateLimits: [{ kind: 'five_hour', percentUsed: 99, resetsAt: null }], cost: { usd: 99 } }
    engine(on, w)
    expect((await $.agent.spawn(spawnInput(0))).deny).toBeUndefined()
  })

  test('the 5-hour limit refuses a teammate with TEAM_BUDGET_REACHED, an ordinary subagent still starts', { options: { stopAtFiveHourPct: 80 } }, async ($, on) => {
    const w = fresh()
    w.usage = { startedAt: 0, context: { window: 1 }, rateLimits: [{ kind: 'five_hour', percentUsed: 82, resetsAt: null }] }
    engine(on, w)
    expect(String((await $.agent.spawn(spawnInput(0))).deny)).toMatch(/^TEAM_BUDGET_REACHED: .*82%.*stopAtFiveHourPct=80/)
    expect((await $.agent.spawn(spawnInput(1, false))).deny).toBeUndefined()
    const st = statusOf(await $.tool.call({ tool: STATUS_TOOL }))
    expect(st).toMatchObject({ rejected: 0, budgetStopped: 1 })
  })

  test('the cost limit refuses once reached, and passes below it', { options: { stopAtCostUsd: 5 } }, async ($, on) => {
    const w = fresh()
    w.usage = { startedAt: 0, context: { window: 1 }, rateLimits: [], cost: { usd: 1 } }
    engine(on, w)
    expect((await $.agent.spawn(spawnInput(0))).deny).toBeUndefined()
    w.usage = { ...w.usage, cost: { usd: 5.2 } }
    expect(String((await $.agent.spawn(spawnInput(1))).deny)).toMatch(/^TEAM_BUDGET_REACHED: .*\$5\.20/)
  })

  test('a figure that was not reported never trips a limit', () => {
    const opts = { ...DEFAULT_OPTIONS, stopAtFiveHourPct: 50, stopAtCostUsd: 1 }
    expect(budgetReached(opts, { fiveHourPct: null, costUsd: null })).toBeNull()
  })
})

describe('usage reads', () => {
  test('a failed usage read keeps the last figures, so the limit stays on', { options: { stopAtCostUsd: 5 } }, async ($, on) => {
    const w = fresh()
    w.usage = { startedAt: 0, context: { window: 1 }, rateLimits: [], cost: { usd: 6 } }
    engine(on, w)
    expect((await $.agent.spawn(spawnInput(0))).deny).toMatch(/TEAM_BUDGET_REACHED/)
    w.usage = null as never
    expect((await $.agent.spawn(spawnInput(1))).deny).toMatch(/TEAM_BUDGET_REACHED/)
  })
})

describe('burn-rate forecast', () => {
  const at = (t: number, pct: number): PctSample => ({ t: t * MIN, pct })

  test('needs 10 minutes of rising samples and a landing before the reset', () => {
    expect(forecastFull([at(0, 10), at(5, 20)], 5 * MIN, 300 * MIN)).toBeNull()
    expect(forecastFull([at(0, 10), at(10, 20)], 10 * MIN, 300 * MIN)).toBe(90 * MIN)
    expect(forecastFull([at(0, 10), at(10, 20)], 10 * MIN, 60 * MIN)).toBeNull()
    expect(forecastFull([at(0, 20), at(10, 20)], 10 * MIN, 300 * MIN)).toBeNull()
  })

  test('samples are spaced, and a drop (window reset) starts over', () => {
    const s: PctSample[] = []
    noteSample(s, 0, 10)
    noteSample(s, 10_000, 11)
    noteSample(s, 40_000, 12)
    expect(s.length).toBe(2)
    noteSample(s, 100_000, 1)
    expect(s).toEqual([{ t: 100_000, pct: 1 }])
  })
})
