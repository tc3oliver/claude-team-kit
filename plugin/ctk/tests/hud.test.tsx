import { describe, expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On } from 'claude-code'

import { formatBand, fmtElapsed, truncate } from '../hooks/band.ts'
import { snapshotOf } from '../hooks/team.ts'
import { emptyStats } from '../shared/stats.ts'

const SURFACES = ['terminal', 'desktop'] as const

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

const NOW = 5_000_000

const USAGE = {
  startedAt: NOW - 12 * 60_000,
  context: { tokens: 84000, window: 200000, percent: 42 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-08T20:00:00Z' },
    { kind: 'seven_day', percentUsed: 61 },
  ],
  cost: { usd: 1.234 },
}

const AGENTS: AgentInfo[] = [
  { id: 'a1', teammateId: 'w1@t', description: '', type: 'teammate', status: 'running' },
  { id: 'a2', teammateId: 'w2@t', description: '', type: 'teammate', status: 'idle' },
  { id: 'a3', teammateId: 'w3@t', description: '', type: 'teammate', status: 'completed' },
  { id: 'a4', description: '', type: 'Explore', status: 'running' },
]

// Records every read-only host call the band makes; hudBand tests run with recordStats off.
const host = (on: On, calls: string[], usage: unknown = USAGE) => {
  mock.clock(on, { now: NOW })
  on('session.usage', () => (calls.push('session.usage'), { value: usage }) as never)
  on('agent.list', () => (calls.push('agent.list'), { value: AGENTS }) as never)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('turn.complete', () => ({}) as never)
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-default" />
  })
}

const measure = ($: any) =>
  $.session.measure({ context: USAGE.context, rateLimits: USAGE.rateLimits, cost: USAGE.cost, changed: ['context'] })

const mount = ($: any, surface: string, props: object = PROPS) =>
  $.ui.mount({ plugin: 'ctk', surface, component: 'AbovePrompt', props })

describe('pure formatting', () => {
  test('snapshot counts busy, idle and done teammates only', () => {
    const s = snapshotOf(AGENTS, USAGE as never, NOW)
    expect(s).toMatchObject({ busy: 1, idle: 1, done: 1, live: 2, elapsedMs: 12 * 60_000 })
    expect(s.workers.map(w => w.name)).toEqual(['w1', 'w2', 'w3'])
  })

  test('band shows the contract segments and omits ones without data', () => {
    const s = emptyStats('s', 3, 0)
    const snap = snapshotOf(AGENTS, USAGE as never, NOW)
    s.measured.costUsd = 1.234
    expect(formatBand(s, snap, 100)).toBe('team 1 busy · 1 idle · 1 done / cap 3 · $1.23 · 12m')
    s.tasks = { created: 5, completed: 2 }
    s.spawnsRejected = 1
    s.workerModels = { sonnet: 2, haiku: 1 }
    expect(formatBand(s, snap, 200)).toBe(
      'team 1 busy · 1 idle · 1 done / cap 3 · tasks 2/5 · rejected 1 · models haiku×1 sonnet×2 · $1.23 · 12m',
    )
  })

  test('missing figures render as dashes, never guesses', () => {
    const s = emptyStats('s', 3, 0)
    const snap = snapshotOf(null, null, NOW)
    expect(formatBand(s, snap, 100)).toBe('team – busy · – idle · – done / cap 3 · – · –')
  })

  test('truncation keeps the line within the width and ends with an ellipsis', () => {
    const s = emptyStats('s', 3, 0)
    s.tasks = { created: 12, completed: 7 }
    s.workerModels = { 'claude-sonnet-5-5': 4, 'claude-haiku-5-5': 3 }
    const snap = snapshotOf(AGENTS, USAGE as never, NOW)
    const line = formatBand(s, snap, 80)
    expect(line.length).toBe(80)
    expect(line.endsWith('…')).toBe(true)
    expect(truncate('abc', 3)).toBe('abc')
    expect(truncate('abcd', 3)).toBe('ab…')
    expect(truncate('abc', 0)).toBe('')
  })

  test('elapsed formatting', () => {
    expect([45_000, 12 * 60_000, 65 * 60_000, null].map(fmtElapsed)).toEqual(['45s', '12m', '1h05m', '–'])
  })
})

describe('HUD band', () => {
  const OFF = { options: { recordStats: false } }

  for (const surface of SURFACES) {
    test(`session.measure fills the AbovePrompt band on ${surface}`, OFF, async ($, on) => {
      const calls: string[] = []
      host(on, calls)
      await measure($)
      const m = await mount($, surface)
      const found = await m.find({ text: /team 1 busy/ })
      expect(found?.text).toBe('team 1 busy · 1 idle · 1 done / cap 3 · $1.23 · 12m')
      expect([...new Set(calls)].sort()).toEqual(['agent.list', 'session.usage'])
    })
  }

  test('band yields to a survey', OFF, async ($, on) => {
    host(on, [])
    await measure($)
    const m = await mount($, 'terminal', { ...PROPS, hasSurvey: true })
    expect(await m.find({ text: /team/ })).toBeUndefined()
  })

  test('nothing drawn before the first measurement', OFF, async ($, on) => {
    host(on, [])
    const m = await mount($, 'terminal')
    expect(await m.find({ text: /team/ })).toBeUndefined()
  })

  test('hidden when hudBand is false', { options: { hudBand: false, recordStats: false } }, async ($, on) => {
    host(on, [])
    await measure($)
    const m = await mount($, 'terminal')
    expect(await m.find({ text: /team/ })).toBeUndefined()
  })

  test('drawn line is cut to the band width', OFF, async ($, on) => {
    host(on, [])
    await measure($)
    const m = await mount($, 'terminal', { ...PROPS, bodyColumns: 30 })
    const found = await m.find({ text: /team/ })
    expect(found?.text).toBe('team 1 busy · 1 idle · 1 done…')
    expect(found?.text.length).toBe(30)
  })
})
