import { describe, expect } from 'claude-code/testing'

import { MC_PANE_ID } from '../../hooks/mission.ts'
import { delayFor, FRAME_MS, HIGHLIGHT_MS, newMotionState, observe, reducedFrom } from '../../hooks/ui/motion.ts'
import type { Mission } from '../../hooks/mission.ts'
import { engine, fresh, spawnInput, test } from '../world.ts'

const START = { cwd: '/w', surface: null, isInteractive: false }
const PANE = { title: 'CTK Mission Control', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 16 }, view: {} }

const mission = (over: Partial<Mission> = {}): Mission =>
  ({ workers: [], tasks: { rows: [] }, rejected: 0, running: 0, ...over }) as unknown as Mission
const worker = (agentId: string) => ({ agentId }) as never

describe('motion state (pure)', () => {
  test('reduced motion: CTK_REDUCED_MOTION=1 or any NO_COLOR', () => {
    expect(reducedFrom('1', undefined)).toBe(true)
    expect(reducedFrom(undefined, '1')).toBe(true)
    expect(reducedFrom('0', '')).toBe(false)
    expect(reducedFrom(undefined, undefined)).toBe(false)
  })

  test('the first draw highlights nothing; a new worker, a completed task and a refusal each do for 3 s', () => {
    let s = observe(newMotionState(), mission({ workers: [worker('a1')] }), 1000)
    expect(s.until).toEqual({})
    s = observe(s, mission({ workers: [worker('a1'), worker('a2')], rejected: 1, tasks: { rows: [{ id: '1', status: 'completed' }] } as never }), 2000)
    expect(s.until).toEqual({ 'worker:a2': 2000 + HIGHLIGHT_MS, guard: 2000 + HIGHLIGHT_MS, 'task:1': 2000 + HIGHLIGHT_MS })
    expect(observe(s, mission({ workers: [worker('a1'), worker('a2')], rejected: 1 }), 2000 + HIGHLIGHT_MS).until).toEqual({})
  })

  test('a timer is wanted only for a running worker or a highlight still to end', () => {
    const idle = observe(newMotionState(), mission(), 0)
    expect(delayFor(idle, mission(), 0)).toBeNull()
    expect(delayFor(idle, mission({ running: 1 }), 0)).toBe(FRAME_MS)
    const hot = observe(observe(newMotionState(), mission(), 0), mission({ workers: [worker('a1')] }), 100)
    expect(delayFor(hot, mission(), 100)).toBe(HIGHLIGHT_MS)
  })

  test('reduced motion never asks for a timer and never highlights', () => {
    const s = observe(observe(newMotionState(true), mission(), 0), mission({ running: 2, workers: [worker('a1')] }), 100)
    expect(s.until).toEqual({})
    expect(delayFor(s, mission({ running: 2 }), 100)).toBeNull()
  })
})

const pane = ($: any) => $.ui.mount({ plugin: 'ctk', surface: 'terminal', component: 'Pane', requestId: MC_PANE_ID, props: PANE })

// The pane redraws once per `invalidate`; counting them counts timer fires.
const setup = async ($: any, on: any, env: Record<string, string> = { CLAUDE_CONFIG_DIR: '/cfg' }) => {
  const w = fresh()
  w.model = 'claude-sonnet-5-5'
  w.settings = { env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' } }
  const clock = engine(on, w, undefined, { env })
  let draws = 0
  on('ui.invalidate', async (_$: any, e: any, next: any) => {
    draws++
    return next(e)
  })
  await $.session.start(START)
  await $.agent.spawn(spawnInput(0, true, { name: 'w-rle', model: 'claude-sonnet-5-5' }))
  return { w, clock, draws: () => draws }
}

describe('motion timers (fake clock)', () => {
  test('pane closed: no timer, so advancing the clock redraws nothing', async ($, on) => {
    const { clock, draws } = await setup($, on)
    await clock.advance(1000)
    const before = draws()
    await clock.advance(10_000)
    expect(draws()).toBe(before)
  })

  test('pane open with a running worker: one slow frame per second; closing it stops them', async ($, on) => {
    const { clock, draws } = await setup($, on)
    const p = await pane($)
    await clock.advance(1)
    const before = draws()
    await clock.advance(3_000)
    expect(draws() - before).toBeGreaterThanOrEqual(2)
    // A real close unmounts the pane; the mock does not, so unmount it as the close does.
    await p.press({ key: 'mc:close' })
    await p.unmount()
    const closed = draws()
    await clock.advance(10_000)
    expect(draws() - closed).toBeLessThanOrEqual(1)
  })

  test('pane open but nothing running: no timer after the highlight ends', async ($, on) => {
    const { w, clock, draws } = await setup($, on)
    w.agents[0]!.status = 'completed'
    const p = await pane($)
    await p.press({ key: 'mc:refresh' })
    await clock.advance(HIGHLIGHT_MS + 1_000)
    const before = draws()
    await clock.advance(10_000)
    expect(draws()).toBe(before)
    await p.unmount()
  })

  test('CTK_REDUCED_MOTION=1: a running worker still draws, with no timer at all', async ($, on) => {
    const { clock, draws } = await setup($, on, { CLAUDE_CONFIG_DIR: '/cfg', CTK_REDUCED_MOTION: '1' })
    const p = await pane($)
    await clock.advance(1)
    const before = draws()
    await clock.advance(10_000)
    expect(draws()).toBe(before)
    await p.unmount()
  })

  test('NO_COLOR also turns motion off', async ($, on) => {
    const { clock, draws } = await setup($, on, { CLAUDE_CONFIG_DIR: '/cfg', NO_COLOR: '1' })
    const p = await pane($)
    await clock.advance(1)
    const before = draws()
    await clock.advance(10_000)
    expect(draws()).toBe(before)
    await p.unmount()
  })
})
