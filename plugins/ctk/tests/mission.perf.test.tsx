import { describe, expect } from 'claude-code/testing'

import * as mission from '../hooks/mission.ts'
import { MC_PANE_ID } from '../hooks/mission.ts'
import { register } from '../hooks/register.tsx'
import { calls, engine, fresh, norm, test } from './world.ts'

// The two hot paths, measured, with the numbers pinned so a regression fails a test instead of
// only showing up in a transcript: one pane draw builds the Mission once (D2), and a burst of
// task events goes through the throttled touch(), not a full refresh per event (D3).
//
// The plugin under test runs in its own JS realm, so its module state is not visible here. The
// draw-cost test therefore drives the register.tsx imported into THIS realm: the same code, with
// mission.missionBuilds countable. Host-call counts cross realms through the event chain, so the
// world.ts spy answers those.

const START = { cwd: '/w', surface: null, isInteractive: false }
const PANE_PROPS = { title: 'CTK Mission Control', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 16 }, view: {} }
const STATS = '/cfg/ctk/stats/sess_1.json'

type Handler = ($: unknown, e: unknown, next: (e: unknown) => Promise<unknown>) => Promise<unknown>

/** register.tsx's `ui.render` handler for the Mission Control pane, hooked out of a fresh registration. */
const paneHandler = (): Handler => {
  const hooks: [string, unknown, unknown][] = []
  const on = ((event: string, ...rest: unknown[]) => {
    hooks.push([event, ...rest] as [string, unknown, unknown])
    return { catch: () => undefined }
  }) as never
  register(on, { maxWorkers: 3 })
  const found = hooks.find(([ev, matcher]) => ev === 'ui.render' && (matcher as { component?: string } | undefined)?.component === 'Pane')
  if (found === undefined) throw new Error('register.tsx has no ui.render Pane hook')
  return found[2] as Handler
}

describe('pane draw cost', () => {
  test('one draw builds the Mission exactly once and reads the clock once', async () => {
    const handler = paneHandler()
    const host: string[] = []
    const Box = (p: { children?: unknown }) => ({ type: 'Box', props: p })
    const kit = { Box, Text: Box, Button: Box }
    const $ = {
      clock: {
        now: () => {
          host.push('clock.now')
          return Promise.resolve(1_000_000)
        },
        after: () => {
          host.push('clock.after')
          return { cancel: () => undefined }
        },
      },
      ui: {
        resolve: () => kit,
        invalidate: () => host.push('ui.invalidate'),
      },
    }
    const e = { requestId: MC_PANE_ID, props: PANE_PROPS }
    const next = async (x: unknown) => x
    const before = mission.missionBuilds
    await handler($, e, next)
    const built = mission.missionBuilds - before
    const clocks = host.filter(h => h === 'clock.now').length
    // eslint-disable-next-line no-console
    console.log(`[perf] pane draw: buildMission=${built} clock.now=${clocks}`)
    expect(built).toBe(1)
    expect(clocks).toBe(1)
  })

  test('a draw through the engine dispatches no host event beyond the frame itself', async ($, on) => {
    const w = fresh()
    engine(on, w)
    await $.session.start(START)
    const before = calls(w)
    const p = await $.ui.mount({ plugin: 'ctk', surface: 'terminal', component: 'Pane', requestId: MC_PANE_ID, props: PANE_PROPS })
    await p.drawn()
    expect(calls(w) - before).toBeLessThanOrEqual(2)
  })
})

describe('task event cost', () => {
  test('a burst of 50 task events is bounded in host calls and loses no counter', async ($, on) => {
    const w = fresh()
    engine(on, w)
    await $.session.start(START)
    const before = calls(w)
    for (let i = 0; i < 25; i++) {
      await $.classic.TaskCreated({ task_id: String(i), task_subject: `t${i}` })
      await $.classic.TaskCompleted({ task_id: String(i), task_subject: `t${i}` })
    }
    const used = calls(w) - before
    // eslint-disable-next-line no-console
    console.log(`[perf] 50 task events: hostCalls=${used}`)
    // Measured: 300 before (a full refresh per event), 150 after — 100 for the throttled touch()
    // (a clock read in touch and one in persist, the stats write coalesced by the gap) plus the
    // 50 dispatches of the classic events themselves, which the engine makes either way. A
    // revert to refresh() doubles this and fails the bound.
    expect(used).toBeLessThanOrEqual(160)
    const out = await $.command.run({ command: 'ctk-stats', args: '' } as never)
    expect(out.text).toMatch(/tasks created\/completed: 25\/25/)
    await $.session.end({ reason: 'other', sessionId: 'sess/1' } as never)
    const s = JSON.parse(w.files.get(norm(STATS)) ?? 'null')
    expect(s.tasks).toEqual({ created: 25, completed: 25 })
    // The stats file keeps its shape: the burst changed the counters, not the record.
    expect(Object.keys(s).sort()).toEqual(
      ['schemaVersion', 'sessionId', 'startedAt', 'updatedAt', 'maxWorkers', 'spawnsAccepted', 'spawnsRejected', 'spawnsFailedClosed', 'spawnsSeen', 'spawnsOutsideCap', 'peakLive', 'workerModels', 'tasks', 'toolCalls', 'measured'].sort(),
    )
  })
})
