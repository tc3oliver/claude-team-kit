import { describe, expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On } from 'claude-code'

import { BAND_MARGIN, bandSegments, formatBand, formatSummary, fmtElapsed, modelLabel } from '../hooks/band.ts'
import { snapshotOf } from '../hooks/team.ts'
import { displayWidth } from '../shared/hudline.ts'
import { emptyStats } from '../shared/stats.ts'

const SURFACES = ['terminal', 'desktop'] as const

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 200,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const NOW = Date.UTC(2026, 9, 9, 3, 0, 0)
const iso = (offset: number) => new Date(NOW + offset).toISOString()

const USAGE = {
  startedAt: NOW - 12 * MIN,
  context: { tokens: 84000, window: 200000, percent: 42 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 28.4, resetsAt: iso(2 * HOUR + 34 * MIN) },
    { kind: 'seven_day', percentUsed: 51, resetsAt: iso(3 * DAY + 12 * HOUR) },
  ],
  cost: { usd: 1.234 },
}

const AGENTS: AgentInfo[] = [
  { id: 'a1', teammateId: 'w1@t', description: '', type: 'teammate', status: 'running' },
  { id: 'a2', teammateId: 'w2@t', description: '', type: 'teammate', status: 'idle' },
  { id: 'a3', teammateId: 'w3@t', description: '', type: 'teammate', status: 'completed' },
  { id: 'a4', description: '', type: 'Explore', status: 'running' },
]

const filled = () => {
  const s = emptyStats('s', 3, 0)
  s.measured = {
    costUsd: 1.234,
    contextPct: 42,
    fiveHourPct: 28.4,
    fiveHourResetsAt: iso(2 * HOUR + 34 * MIN),
    sevenDayPct: 51,
    sevenDayResetsAt: iso(3 * DAY + 12 * HOUR),
    model: 'claude-sonnet-5-5',
  }
  s.toolCalls = 153
  return s
}

const snap = () => snapshotOf(AGENTS, USAGE as never, NOW)

// The band body is BAND_MARGIN columns narrower than the terminal; tests speak in terminal widths.
const band = (s: ReturnType<typeof filled>, terminal: number, opts: object = {}) => formatBand(s, snap(), terminal - BAND_MARGIN, { nowMs: NOW, ...opts })

describe('model label', () => {
  test('ids and aliases become the name Claude Code shows', () => {
    expect(
      ['claude-sonnet-5-5', 'claude-opus-4-1-20250805', 'claude-haiku-5-5', 'claude-fable-5-1', 'sonnet', 'opus[1m]', 'claude-sonnet-5-5[1m]'].map(modelLabel),
    ).toEqual(['Sonnet 5.5', 'Opus 4.1', 'Haiku 5.5', 'Fable 5.1', 'Sonnet', 'Opus 1M', 'Sonnet 5.5 1M'])
  })

  test('something unrecognised is shown as given; nothing is nothing', () => {
    expect(modelLabel('my-gateway-model')).toBe('my-gateway-model')
    expect(modelLabel('claude-')).toBeNull()
    expect(modelLabel(null)).toBeNull()
  })
})

describe('pure formatting', () => {
  test('snapshot counts busy, idle and done teammates only', () => {
    const s = snap()
    expect(s).toMatchObject({ busy: 1, idle: 1, done: 1, live: 2, elapsedMs: 12 * MIN })
    expect(s.workers.map(w => w.name)).toEqual(['w1', 'w2', 'w3'])
  })

  test('the full band at 200 columns', () => {
    const s = filled()
    s.tasks = { created: 6, completed: 3 }
    s.workerModels = { sonnet: 2, haiku: 1 }
    expect(band(s, 200)).toBe(
      'Sonnet 5.5 │ 5h 28% (2h34m) │ Wk 51% (3d12h) │ Tools 153 │ Agents 2/3 (1 busy) │ Ctx 42% │ Tasks 3/6 │ $1.23 (12m) │ models haiku×1 sonnet×2',
    )
  })

  const WIDTHS: [number, string][] = [
    [160, 'Sonnet 5.5 │ 5h 28% (2h34m) │ Wk 51% (3d12h) │ Tools 153 │ Agents 2/3 (1 busy) │ Ctx 42% │ Tasks 3/6 │ $1.23 (12m) │ models haiku×1 sonnet×2'],
    [120, 'Sonnet 5.5 │ 5h 28% (2h34m) │ Wk 51% (3d12h) │ Tools 153 │ Agents 2/3 (1 busy) │ Ctx 42% │ Tasks 3/6 │ $1.23 (12m)'],
    [100, 'Sonnet 5.5 │ 5h 28% 2h34m │ Wk 51% 3d12h │ T153 │ A2/3 │ Ctx 42% │ Tasks 3/6 │ $1.23'],
    [80, 'Sonnet 5.5 │ 5h 28% 2h34m │ Wk 51% 3d12h │ T153 │ A2/3 │ Ctx 42%'],
    [79, '5h 28% 2h34m │ Wk 51% 3d12h │ T153'],
    [50, '5h 28% 2h34m │ Wk 51% 3d12h │ T153'],
    [33, '5h 28% 2h34m │ Wk 51% 3d12h'],
    [30, '5h 28% 2h34m'],
  ]
  for (const [columns, expected] of WIDTHS) {
    test(`the band in a ${columns}-column terminal`, () => {
      const s = filled()
      s.tasks = { created: 6, completed: 3 }
      s.workerModels = { sonnet: 2, haiku: 1 }
      const out = band(s, columns)
      expect(out).toBe(expected)
      expect(displayWidth(out)).toBeLessThanOrEqual(columns - BAND_MARGIN)
    })
  }

  test('with the CTK status line configured the band keeps only what the status line cannot know', () => {
    const s = filled()
    s.tasks = { created: 6, completed: 3 }
    s.spawnsRejected = 1
    const out = band(s, 200, { coordinated: true })
    expect(out).toBe('Tools 153 │ Agents 2/3 (refused 1) │ Tasks 3/6')
    for (const dup of ['Sonnet', '5h', 'Wk', 'Ctx', '$']) expect(out).not.toContain(dup)
  })

  test('a refused spawn travels with the agents segment and survives the abbreviated form', () => {
    const s = filled()
    s.spawnsRejected = 2
    expect(band(s, 100)).toContain('A2/3 !2')
  })

  test('missing figures render as dashes, never as 0% or a made-up reset', () => {
    const s = emptyStats('s', 3, 0)
    const out = formatBand(s, snapshotOf(null, null, NOW), 195, { nowMs: NOW })
    expect(out).toBe('– │ 5h – │ Wk – │ Tools 0 │ Agents –/3 │ Ctx – │ –')
    expect(out).not.toMatch(/0%|\(\d/)
  })

  test('a percentage with no reset time shows without a countdown', () => {
    const s = filled()
    s.measured.fiveHourResetsAt = null
    s.measured.sevenDayResetsAt = 'not a time'
    const out = band(s, 200)
    expect(out).toContain('5h 28% │ Wk 51% │')
  })

  test('a window that has already reset is a dash, not last window’s number', () => {
    const s = filled()
    s.measured.fiveHourResetsAt = iso(-MIN)
    expect(band(s, 200)).toContain('5h – │')
  })

  test('the countdown follows the clock it is given', () => {
    const s = filled()
    expect(band(s, 200, { nowMs: NOW + HOUR })).toContain('5h 28% (1h34m)')
  })

  test('a CJK model name or terminal that draws │ double-wide still fits', () => {
    const s = filled()
    s.measured.model = '千問'
    for (const ambiguous of [1, 2] as const) {
      for (const columns of [200, 120, 100, 80, 60]) {
        expect(displayWidth(band(s, columns, { ambiguous }), ambiguous)).toBeLessThanOrEqual(columns - BAND_MARGIN)
      }
    }
  })

  test('segments exist for each required figure', () => {
    expect(bandSegments(filled(), snap(), { nowMs: NOW }).map(x => x.id)).toEqual(['model', '5h', 'wk', 'tools', 'agents', 'ctx', 'cost'])
  })

  test('elapsed formatting', () => {
    expect([45_000, 12 * MIN, 65 * MIN, null].map(fmtElapsed)).toEqual(['45s', '12m', '1h05m', '–'])
  })

  test('the summary names tool calls, model and both reset countdowns', () => {
    const out = formatSummary(filled(), snap(), NOW)
    expect(out).toContain('tool calls: 153 (lead, subagents and teammates; each call once)')
    expect(out).toContain('model: Sonnet 5.5  cost: $1.23  context: 42%')
    expect(out).toContain('5h limit: 28% (resets in 2h34m)  7d limit: 51% (resets in 3d12h)')
  })
})

// Records every read-only host call the band makes; hudBand tests run with recordStats off.
const host = (on: On, calls: string[], usage: unknown = USAGE, settings: Record<string, unknown> = {}) => {
  mock.clock(on, { now: NOW })
  mock.env(on, {})
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sess/1' }) as never)
  on('session.usage', () => (calls.push('session.usage'), { value: usage }) as never)
  on('session.model', () => (calls.push('session.model'), { value: 'claude-sonnet-5-5' }) as never)
  on('agent.list', () => (calls.push('agent.list'), { value: AGENTS }) as never)
  on('settings.read', () => ({ value: settings }) as never)
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

describe('HUD band', () => {
  const OFF = { options: { recordStats: false } }

  for (const surface of SURFACES) {
    test(`session.measure fills the AbovePrompt band on ${surface}`, OFF, async ($, on) => {
      const calls: string[] = []
      host(on, calls)
      await measure($)
      const m = await mount($, surface)
      const found = await m.find({ text: /Sonnet/ })
      expect(found?.text).toBe(
        'Sonnet 5.5 │ 5h 28% (2h34m) │ Wk 51% (3d12h) │ Tools 0 │ Agents 2/3 (1 busy) │ Ctx 42% │ $1.23 (12m)',
      )
      expect([...new Set(calls)].sort()).toEqual(['agent.list', 'session.model', 'session.usage'])
    })
  }

  test('band yields to a survey', OFF, async ($, on) => {
    host(on, [])
    await measure($)
    const m = await mount($, 'terminal', { ...PROPS, hasSurvey: true })
    expect(await m.find({ text: /Agents/ })).toBeUndefined()
  })

  test('nothing drawn before the first measurement', OFF, async ($, on) => {
    host(on, [])
    const m = await mount($, 'terminal')
    expect(await m.find({ text: /Agents/ })).toBeUndefined()
  })

  test('hidden when hudBand is false', { options: { hudBand: false, recordStats: false } }, async ($, on) => {
    host(on, [])
    await measure($)
    const m = await mount($, 'terminal')
    expect(await m.find({ text: /Agents/ })).toBeUndefined()
  })

  for (const columns of [200, 160, 120, 100, 80, 60, 40]) {
    test(`the drawn line fits ${columns} columns`, OFF, async ($, on) => {
      host(on, [])
      await measure($)
      const m = await mount($, 'terminal', { ...PROPS, bodyColumns: columns })
      const found = await m.find({ text: /5h/ })
      expect(found).toBeDefined()
      expect(displayWidth(found?.text ?? '')).toBeLessThanOrEqual(columns)
    })
  }

  test('resizing redraws at the new width', OFF, async ($, on) => {
    host(on, [])
    await measure($)
    const wide = await (await mount($, 'terminal', { ...PROPS, bodyColumns: 200 })).find({ text: /5h/ })
    const narrow = await (await mount($, 'terminal', { ...PROPS, bodyColumns: 70 })).find({ text: /5h/ })
    expect(wide?.text).toContain('Agents 2/3')
    expect(narrow?.text).toBe('5h 28% 2h34m │ Wk 51% 3d12h │ T0')
  })

  test('an unreadable terminal width falls back to 80 columns', OFF, async ($, on) => {
    host(on, [])
    await measure($)
    const m = await mount($, 'terminal', { ...PROPS, bodyColumns: Number.NaN })
    const found = await m.find({ text: /5h/ })
    expect(displayWidth(found?.text ?? '')).toBeLessThanOrEqual(80)
  })

  test('with the CTK status line configured the band leaves out what that line shows', OFF, async ($, on) => {
    host(on, [], USAGE, { statusLine: { type: 'command', command: 'node "/cfg/ctk/bin/ctk-statusline.mjs"' } })
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    await measure($)
    const found = await (await mount($, 'terminal')).find({ text: /Agents/ })
    expect(found?.text).toBe('Tools 0 │ Agents 2/3 (1 busy)')
  })

  test('another tool’s status line does not hide anything', OFF, async ($, on) => {
    host(on, [], USAGE, { statusLine: { type: 'command', command: 'npx some-other-hud' } })
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    await measure($)
    const found = await (await mount($, 'terminal')).find({ text: /Agents/ })
    expect(found?.text).toContain('5h 28%')
  })

  test('without usage data every usage figure is a dash and the band still draws', OFF, async ($, on) => {
    host(on, [], { startedAt: NOW - MIN, context: { window: 200000 }, rateLimits: [] })
    await measure($)
    const found = await (await mount($, 'terminal')).find({ text: /Agents/ })
    expect(found?.text).toBe('Sonnet 5.5 │ 5h – │ Wk – │ Tools 0 │ Agents 2/3 (1 busy) │ Ctx – │ –')
  })
})
