import { describe, expect } from 'claude-code/testing'

import { isNewToolCall, STATUS_TOOL, TOOL_SEEN_LIMIT } from '../hooks/team.ts'
import { engine, fresh, norm, test } from './world.ts'

const STATS = '/cfg/ctk/stats/sess_1.json'
const END = { reason: 'other', sessionId: 'sess/1' } as never
const written = (w: ReturnType<typeof fresh>) => JSON.parse(w.files.get(norm(STATS)) ?? 'null')
const START = { cwd: '/w', surface: null, isInteractive: false }

const call = ($: any, tool: string, id?: string, extra: object = {}) =>
  $.tool.call({ tool, ...(id === undefined ? {} : { tool_use_id: id }), ...extra })

const toolCalls = async ($: any): Promise<number> => {
  const out = await $.command.run({ command: 'ctk-stats', args: '' })
  return Number(/tool calls: (\d+)/.exec(out.text)?.[1])
}

describe('de-duplication', () => {
  test('a tool_use_id counts once, however often its event arrives', () => {
    const seen = new Set<string>()
    expect([isNewToolCall(seen, 'a'), isNewToolCall(seen, 'a'), isNewToolCall(seen, 'b')]).toEqual([true, false, true])
  })

  test('an event with no id cannot be recognised again and counts each time', () => {
    const seen = new Set<string>()
    expect([undefined, null, '', 7].map(id => isNewToolCall(seen, id))).toEqual([true, true, true, true])
    expect(seen.size).toBe(0)
  })

  test('the memory is bounded and keeps the newest ids', () => {
    const seen = new Set<string>()
    for (let i = 0; i < TOOL_SEEN_LIMIT + 10; i++) isNewToolCall(seen, `t${i}`)
    expect(seen.size).toBeLessThanOrEqual(TOOL_SEEN_LIMIT)
    expect(seen.has(`t${TOOL_SEEN_LIMIT + 9}`)).toBe(true)
    expect(seen.has('t0')).toBe(false)
    expect(isNewToolCall(seen, `t${TOOL_SEEN_LIMIT + 9}`)).toBe(false)
  })
})

describe('tool call counter', () => {
  test('every call counts once and the call is answered by the engine, untouched', async ($, on) => {
    const w = fresh()
    engine(on, w)
    await $.session.start(START)
    const a = await call($, 'Read', 'toolu_1', { file_path: '/w/a.txt' })
    const b = await call($, 'Bash', 'toolu_2', { command: 'ls' })
    expect(a).toMatchObject({ result: 'ok' })
    expect(b).toMatchObject({ result: 'ok' })
    expect(await toolCalls($)).toBe(2)
  })

  test('the same call seen twice counts once', async ($, on) => {
    const w = fresh()
    engine(on, w)
    await $.session.start(START)
    await call($, 'Read', 'toolu_1')
    await call($, 'Read', 'toolu_1')
    await call($, 'Read', 'toolu_2')
    expect(await toolCalls($)).toBe(2)
  })

  test('calls made inside subagents and teammates count with the lead’s, each by its own id', async ($, on) => {
    const w = fresh()
    engine(on, w)
    await $.session.start(START)
    await call($, 'Read', 'toolu_lead')
    await call($, 'Read', 'toolu_w1', { agentId: 'a1' })
    await call($, 'Bash', 'toolu_w2', { agentId: 'a2' })
    await call($, 'Edit', 'toolu_w1b', { agentId: 'a1' })
    expect(await toolCalls($)).toBe(4)
  })

  test('the plugin’s own status tool is a tool call the model made, so it counts', async ($, on) => {
    const w = fresh()
    engine(on, w)
    await $.session.start(START)
    await call($, STATUS_TOOL, 'toolu_s')
    expect(await toolCalls($)).toBe(1)
  })

  test('the count is written to the stats file with counters only', async ($, on) => {
    const w = fresh()
    engine(on, w)
    await $.session.start(START)
    await call($, 'Read', 'toolu_1', { file_path: '/secret/path' })
    await $.session.end(END)
    const s = written(w)
    expect(s.toolCalls).toBe(1)
    expect(JSON.stringify(s)).not.toContain('/secret/path')
  })

  test('a session that starts again continues the count from its stats file', async ($, on) => {
    const w = fresh()
    engine(on, w)
    await $.session.start(START)
    await call($, 'Read', 'toolu_1')
    await call($, 'Read', 'toolu_2')
    await $.session.end(END)
    await $.session.start(START)
    await call($, 'Read', 'toolu_3')
    expect(await toolCalls($)).toBe(3)
  })

  test('a stats file from an earlier version, without the count, starts it at zero', async ($, on) => {
    const w = fresh()
    engine(on, w)
    w.files.set(
      norm(STATS),
      JSON.stringify({
        schemaVersion: 1,
        sessionId: 'sess/1',
        startedAt: 1,
        updatedAt: 1,
        maxWorkers: 3,
        spawnsAccepted: 1,
        spawnsRejected: 0,
        spawnsFailedClosed: 0,
        peakLive: 1,
        workerModels: {},
        tasks: null,
        measured: { costUsd: 0.1, contextPct: 1, fiveHourPct: 5, sevenDayPct: 6 },
      }),
    )
    await $.session.start(START)
    expect(await toolCalls($)).toBe(0)
    const out = await $.command.run({ command: 'ctk-stats', args: '' } as never)
    expect(out.text).toContain('teammate spawns: 1 accepted')
  })

  test('a failing stats write never changes what a tool call returns', async ($, on) => {
    const w = fresh()
    engine(on, w, undefined, { writeFails: true })
    await $.session.start(START)
    const r = await call($, 'Read', 'toolu_1')
    expect(r).toMatchObject({ result: 'ok' })
    expect(await toolCalls($)).toBe(1)
  })

  test('recordStats=false still counts for the band but writes nothing', { options: { recordStats: false } }, async ($, on) => {
    const w = fresh()
    engine(on, w)
    await $.session.start(START)
    await call($, 'Read', 'toolu_1')
    await $.session.end(END)
    expect(w.files.size).toBe(0)
    expect(await toolCalls($)).toBe(1)
  })
})
