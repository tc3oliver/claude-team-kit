import { describe, expect } from 'claude-code/testing'

import { MC_PANE_ID, OPEN_KEY } from '../hooks/mission.ts'
import { engine, fresh, spawnInput, test } from './world.ts'

const START = { cwd: '/w', surface: null, isInteractive: false }

const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 200, scroll: { offset: 0, bodyRows: 10 }, view: {} }
const PANE = { title: 'CTK Mission Control', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 16 }, view: {} }

// Task tools answer with the records the real tools return.
const taskTools = (e: Record<string, unknown>): unknown => {
  if (e.tool === 'TaskCreate') return { task: { id: String(e.tool_use_id).replace('tc', ''), subject: e.subject } }
  if (e.tool === 'TaskUpdate') return { success: true, taskId: e.taskId, updatedFields: [] }
  return 'ok'
}

const band = ($: any, surface = 'terminal') => $.ui.mount({ plugin: 'ctk', surface, component: 'AbovePrompt', props: BAND })
const pane = ($: any, props: object = PANE, surface = 'terminal') => $.ui.mount({ plugin: 'ctk', surface, component: 'Pane', requestId: MC_PANE_ID, props })
// The drawn tree as one readable string: every text, and each button as ⟦key|hotkey⟧.
const flat = (n: any): string =>
  typeof n === 'string'
    ? n
    : n.type === 'Button'
      ? `⟦${n.props.key}|${n.props.hotkey ?? ''}⟧${(n.children ?? []).map(flat).join('')}`
      : (n.children ?? []).map(flat).join(n.type === 'Box' ? ' ' : '')
const texts = async (m: any): Promise<string> => flat(await m.drawn())

const call = ($: any, tool: string, id: string, extra: object = {}) => $.tool.call({ tool, tool_use_id: id, ...extra })

// A session with two teammates (one running, one idle) and a task board with a dependency.
const team = async ($: any, on: any, extra: object = {}) => {
  const w = fresh()
  w.model = 'claude-sonnet-5-5'
  w.settings = { env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' } }
  w.usage = {
    startedAt: 1_000_000 - 12 * 60_000,
    context: { window: 200000, percent: 42 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 28.4, resetsAt: new Date(1_000_000 + 154 * 60_000).toISOString() }],
    cost: { usd: 0.94 },
  }
  engine(on, w, undefined, { toolResult: taskTools, ...extra })
  await $.session.start(START)
  await $.agent.spawn(spawnInput(0, true, { name: 'w-rle', model: 'claude-sonnet-5-5' }))
  await $.agent.spawn(spawnInput(1, true, { name: 'w-roman', model: 'claude-haiku-5-5' }))
  w.agents[1]!.status = 'idle'
  await call($, 'TaskCreate', 'tc1', { subject: 'rle tests', description: 'PRIVATE' })
  await call($, 'TaskCreate', 'tc2', { subject: 'roman tests', description: 'PRIVATE' })
  await call($, 'TaskCreate', 'tc3', { subject: 'run npm test', description: 'PRIVATE' })
  await call($, 'TaskUpdate', 'tu1', { taskId: '1', status: 'in_progress', owner: 'w-rle' })
  await call($, 'TaskUpdate', 'tu2', { taskId: '3', addBlockedBy: ['1', '2'] })
  await call($, 'Read', 'r1', { agentId: 'a1' })
  await call($, 'Read', 'r2', { agentId: 'a1' })
  await $.turn.complete({ answer: '', reason: 'answer', durationMs: 1 })
  return w
}

describe('the band opens Mission Control', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`pressing the band opens the pane on ${surface}`, async ($, on) => {
      const w = await team($, on)
      const m = await band($, surface)
      expect(await m.find({ key: OPEN_KEY })).toBeDefined()
      await m.press({ key: OPEN_KEY })
      expect(w.opened).toHaveLength(1)
      expect(w.opened[0]).toMatchObject({ id: MC_PANE_ID, title: 'CTK Mission Control', focus: true, closeOnEscape: true })
    })
  }

  test('the whole line is the target: the entry and the figures sit inside one button', async ($, on) => {
    await team($, on)
    const m = await band($)
    const button = await m.find({ type: 'Button', key: OPEN_KEY })
    expect(button?.text).toMatch(/^CTK ▸ .*Agents 2\/3/)
  })

  test('keyboard: the entry is a labelled button the engine can focus and press with Enter', async ($, on) => {
    await team($, on)
    const m = await band($)
    const json = JSON.stringify(await m.drawn())
    expect(json).toContain('"label":"Open CTK Mission Control"')
    expect(json).toContain('"type":"Button"')
  })

  test('opening and closing never touches the team', async ($, on) => {
    const w = await team($, on)
    const spawns = w.spawnCalls
    const files = [...w.files.keys()].length
    const m = await band($)
    await m.press({ key: OPEN_KEY })
    const p = await pane($)
    await p.press({ key: 'mc:close' })
    expect(w.closed).toEqual([MC_PANE_ID])
    expect(w.spawnCalls).toBe(spawns)
    expect(w.agents.map(a => a.status)).toEqual(['running', 'idle'])
    expect([...w.files.keys()].length).toBeGreaterThanOrEqual(files)
  })

  test('where no pane can be drawn the command answers in text with the same facts', async ($, on) => {
    const w = await team($, on)
    w.placePanes = false
    const out = await $.command.run({ command: 'ctk-mission', args: '' } as never)
    expect(out.text).toContain('CTK Mission Control (read-only):')
    expect(out.text).toContain('workers:  2/3 active, 1 running, 1 idle')
    expect(out.text).toContain('tasks:    0/3 done')
    expect(out.text).toContain('worker w-rle: running, model claude-sonnet-5-5, tool calls 2')
  })

  test('the command opens the pane when it can', async ($, on) => {
    const w = await team($, on)
    const out = await $.command.run({ command: 'ctk-mission', args: '' } as never)
    expect(w.opened).toHaveLength(1)
    expect(out.text).toContain('Mission Control is open')
  })

  test('a band hidden by hudBand=false still has the command', { options: { hudBand: false } }, async ($, on) => {
    const w = await team($, on)
    await $.command.run({ command: 'ctk-mission', args: '' } as never)
    expect(w.opened).toHaveLength(1)
  })
})

describe('the band while no team runs', () => {
  const idle = async ($: any, on: any) => {
    const w = fresh()
    w.model = 'claude-sonnet-5-5'
    engine(on, w)
    await $.session.start(START)
  }

  test('minimal: only the entry and the guard', { options: { hudIdle: 'minimal' } }, async ($, on) => {
    await idle($, on)
    expect((await (await band($)).find({ key: OPEN_KEY }))?.text).toBe('CTK ▸ Guard –')
  })

  test('hidden: nothing is drawn, and the command is still there', { options: { hudIdle: 'hidden' } }, async ($, on) => {
    await idle($, on)
    expect(await (await band($)).find({ key: OPEN_KEY })).toBeUndefined()
    const out = await $.command.run({ command: 'ctk-mission', args: '' } as never)
    expect(out.text).toContain('Mission Control')
  })

  test('full (the default) shows everything', async ($, on) => {
    await idle($, on)
    expect((await (await band($)).find({ key: OPEN_KEY }))?.text).toContain('Agents 0/3')
  })

  test('once a teammate has started, hidden and minimal give way to the full band', { options: { hudIdle: 'hidden' } }, async ($, on) => {
    await team($, on)
    expect((await (await band($)).find({ key: OPEN_KEY }))?.text).toContain('Agents 2/3')
  })
})

describe('Mission Control views', () => {
  test('overview: guard, workers, tasks, team time and usage', async ($, on) => {
    await team($, on)
    const t = await texts(await pane($))
    for (const want of ['Guard', 'ON', '2/3 active', '1 running', '1 idle', '0 completed', '0 failed', '0/3 done', '2 pending', '1 in progress', '1 blocked', '1 ready', '5h quota', '28% (resets in 2h34m)', '7 tool calls']) {
      expect(t).toContain(want)
    }
  })

  test('workers list shows model, status, tool calls and last activity; unknown values say unavailable', async ($, on) => {
    await team($, on)
    const p = await pane($)
    await p.press({ key: 'mc:view:workers' })
    const t = await texts(p)
    expect(t).toContain('w-rle')
    expect(t).toContain('claude-sonnet-5-5')
    expect(t).toContain('claude-haiku-5-5')
    expect(t).toContain('w-roman')
  })

  test('worker detail: model, status, current task, tool calls, last activity, idle', async ($, on) => {
    await team($, on)
    const p = await pane($)
    await p.press({ key: 'mc:view:workers' })
    await p.press({ key: 'mc:worker:a1' })
    let t = await texts(p)
    expect(t).toContain('w-rle')
    for (const want of ['claude-sonnet-5-5', 'running', '#1 rle tests', '2 (its own loop)', 'not idle']) expect(t).toContain(want)
    await p.press({ key: 'mc:back' })
    await p.press({ key: 'mc:worker:a2' })
    t = await texts(p)
    expect(t).toContain('claude-haiku-5-5')
    expect(t).toContain('idle')
    expect(t).toContain('unavailable (no in-progress task owned by this worker was observed)')
  })

  test('descriptions the model passed to the task tools are never shown', async ($, on) => {
    await team($, on)
    const p = await pane($)
    for (const key of ['mc:view:tasks', 'mc:view:stats', 'mc:view:usage']) {
      await p.press({ key })
      expect(await texts(p)).not.toContain('PRIVATE')
    }
  })

  test('usage view reports model, context, both windows, cost and tool calls', async ($, on) => {
    await team($, on)
    const p = await pane($)
    await p.press({ key: 'mc:view:usage' })
    const t = await texts(p)
    for (const want of ['claude-sonnet-5-5', '42%', '5H', '[███░░░░░░░] 28%  reset 2h34m', 'WEEK', 'unavailable', '$0.94', 'Tool calls', '7']) expect(t).toContain(want)
  })

  test('config view lists the options and says how to change one', async ($, on) => {
    await team($, on)
    const p = await pane($)
    await p.press({ key: 'mc:view:config' })
    const t = await texts(p)
    for (const want of ['Max live teammates', '3', 'Explorer model', 'haiku', 'Team band', 'Nothing changes without your confirmation']) expect(t).toContain(want)
  })

  test('stats view is the /ctk-stats summary', async ($, on) => {
    await team($, on)
    const p = await pane($)
    await p.press({ key: 'mc:view:stats' })
    const t = await texts(p)
    expect(t).toContain('COUNTED BY CTK')
    expect(t).toContain('per-worker cost: not available from Claude Code')
  })

  test('doctor view reads the readiness report on demand', async ($, on) => {
    await team($, on)
    const p = await pane($)
    await p.press({ key: 'mc:view:doctor' })
    const t = await texts(p)
    expect(t).toContain('CTK readiness (read-only; nothing is changed):')
    expect(t).toContain('agent teams: enabled')
  })

  test('the HUD form buttons switch the band between compact, standard and full', async ($, on) => {
    await team($, on)
    const b = await band($)
    const p = await pane($)
    expect((await b.find({ key: OPEN_KEY }))?.text).toContain('Agents 2/3')
    await p.press({ key: 'mc:hud:compact' })
    expect((await (await band($)).find({ key: OPEN_KEY }))?.text).toMatch(/^CTK ▸ 5h 28% 2h34m/)
    await p.press({ key: 'mc:hud:standard' })
    expect((await (await band($)).find({ key: OPEN_KEY }))?.text).toContain('T7')
    await p.press({ key: 'mc:hud:full' })
    expect((await (await band($)).find({ key: OPEN_KEY }))?.text).toContain('Tools 7')
    await p.press({ key: 'mc:hud:auto' })
  })

  test('every tab has a digit hotkey, so the pane is usable without a mouse', async ($, on) => {
    await team($, on)
    const p = await pane($)
    const drawn = await texts(p)
    const tabs = ['overview', 'workers', 'tasks', 'usage', 'config', 'stats', 'doctor']
    tabs.forEach((tab, i) => expect(drawn).toContain(`⟦mc:view:${tab}|${i + 1}⟧`))
  })

  test('a docked pane (about 50 cells) keeps NAME, MODEL, STATUS, TOOLS and IDLE on screen', async ($, on) => {
    await team($, on)
    const p = await pane($, { ...PANE, bodyColumns: 50 })
    await p.press({ key: 'mc:view:workers' })
    let t = await texts(p)
    expect(t).toContain('IDLE')
    expect(t).not.toContain('LAST')
    expect(t).toContain('Sonnet 5.5')
    expect(t).toContain('Haiku 5.5')
    expect(t).not.toContain('claude-sonnet-5-5')
    await p.press({ key: 'mc:view:tasks' })
    t = await texts(p)
    expect(t).toContain('0/3 marked complete')
    await p.unmount()
  })

  test('narrow panes never draw a line wider than the pane', async ($, on) => {
    await team($, on)
    for (const bodyColumns of [100, 60, 40]) {
      const p = await pane($, { ...PANE, bodyColumns })
      const root = await p.drawn()
      expect((root as any).props.width).toBe(bodyColumns)
      for (const key of ['mc:view:overview', 'mc:view:workers', 'mc:view:tasks']) {
        await p.press({ key })
        for (const r of await p.findAll({ type: 'Text' })) expect(typeof r.text).toBe('string')
      }
      await p.unmount()
    }
  })
})

describe('missing data', () => {
  test('a fresh session: guard unavailable until read, every count unavailable, no zero invented', async ($, on) => {
    const w = fresh()
    engine(on, w)
    const p = await pane($)
    const t = await texts(p)
    expect(t).toContain('unavailable')
    expect(t).not.toContain('0 failed')
    await p.press({ key: 'mc:view:tasks' })
    expect(await texts(p)).toContain('No task list yet')
    await p.press({ key: 'mc:view:workers' })
    expect(await texts(p)).toContain('No teammate has started this session.')
  })

  test('an unreadable roster is a guard error, not an empty team', async ($, on) => {
    const w = fresh()
    engine(on, w, undefined, { listFails: true })
    await $.session.start(START)
    const t = await texts(await pane($))
    expect(t).toContain('error')
    expect(t).toContain('the roster could not be read')
  })

  test('Agent Teams off: guard unavailable, with the reason', async ($, on) => {
    const w = fresh()
    engine(on, w)
    await $.session.start(START)
    const t = await texts(await pane($))
    expect(t).toContain('Agent Teams are not enabled')
  })
})

describe('what Mission Control never does', () => {
  test('pressing every button spawns nothing, writes no settings and calls no model', async ($, on) => {
    const w = await team($, on)
    const spawns = w.spawnCalls
    const p = await pane($)
    for (const key of ['mc:view:workers', 'mc:worker:a1', 'mc:back', 'mc:view:tasks', 'mc:view:usage', 'mc:view:config', 'mc:hud:compact', 'mc:hud:auto', 'mc:view:stats', 'mc:view:doctor', 'mc:refresh', 'mc:close']) {
      await p.press({ key })
    }
    expect(w.spawnCalls).toBe(spawns)
    expect([...w.files.keys()].every(f => f.includes('/ctk/stats/'))).toBe(true)
  })

  test('a roster that cannot be read does not break a press or the pane', async ($, on) => {
    const w = fresh()
    engine(on, w, undefined, { listFails: true })
    await $.session.start(START)
    const p = await pane($)
    await p.press({ key: 'mc:refresh' })
    await p.press({ key: 'mc:view:workers' })
    expect(await texts(p)).toContain('CTK Mission Control')
  })
})
