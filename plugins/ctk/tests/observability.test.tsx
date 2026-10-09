import { describe, expect } from 'claude-code/testing'

import { MC_PANE_ID, OPEN_KEY } from '../hooks/mission.ts'
import { STATUS_TOOL, CONFIG_TOOL } from '../hooks/team.ts'
import { engine, fresh, spawnInput, statusOf, test } from './world.ts'

// What Mission Control, the band and the status tool say when a session used no team, ordinary
// subagents, native teammates, or teammates without any task events. Modelled on a real session in
// which a lead ran three ctk:* agents with no `name` and no task call: Claude Code started them as
// ordinary subagents (no isTeammate), the guard saw three spawns, and the cap counted none.

const START = { cwd: '/w', surface: null, isInteractive: false }
const FLAG = { env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' } }
const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 200, scroll: { offset: 0, bodyRows: 10 }, view: {} }
const PANE = { title: 'CTK Mission Control', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 40 }, view: {} }

const flat = (n: any): string =>
  typeof n === 'string' ? n : n.type === 'Button' ? `⟦${n.props.key}⟧${(n.children ?? []).map(flat).join('')}` : (n.children ?? []).map(flat).join(n.type === 'Box' ? ' ' : '')
const band = ($: any) => $.ui.mount({ plugin: 'ctk', surface: 'terminal', component: 'AbovePrompt', props: BAND })
const pane = ($: any) => $.ui.mount({ plugin: 'ctk', surface: 'terminal', component: 'Pane', requestId: MC_PANE_ID, props: PANE })
const panes = new WeakMap<object, any>()
const view = async ($: any, v: string): Promise<string> => {
  const p = panes.get($) ?? (await pane($))
  panes.set($, p)
  await p.press({ key: `mc:view:${v}` })
  return flat(await p.drawn())
}
const status = async ($: any) => statusOf(await $.tool.call({ tool: STATUS_TOOL }))

// An agent call with no `name`: what the lead in the real session made.
const plain = (i: number, type: string) => {
  const { name: _name, ...rest } = spawnInput(i, false, { subagentType: type, description: `scout ${i}`, background: false })
  return rest as never
}

const started = async ($: any, on: any, settings: Record<string, unknown> | null = FLAG) => {
  const w = fresh()
  w.settings = settings
  engine(on, w, undefined, { toolResult: () => 'ok' })
  await $.session.start(START)
  return w
}

describe('no team at all', () => {
  test('Workers and Tasks say why they are empty and what to do', async ($, on) => {
    await started($, on)
    const workers = await view($, 'workers')
    expect(workers).toContain('No teammate has started this session.')
    expect(workers).toContain('/ctk:team <goal>')
    expect(workers).not.toContain('ORDINARY SUBAGENTS')
    const tasks = await view($, 'tasks')
    expect(tasks).toContain('No task list yet')
    expect(tasks).toContain('TaskCreate')
    expect(tasks).toContain('CLAUDE_CODE_ENABLE_TODO_TOOLS=1')
  })

  test('with Agent Teams off the Workers page says teams are off, not that a team did not start', async ($, on) => {
    await started($, on, { env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '0' } })
    expect(await view($, 'workers')).toContain('Agent Teams are off, so no teammate can start')
  })

  test('the status tool carries the same explanation for the lead, with nothing invented', async ($, on) => {
    await started($, on)
    const s = await status($)
    expect(s.subagents).toEqual({ total: 0, live: 0 })
    expect(s.explain.workers).toMatch(/^No teammate has started/)
    expect(s.explain.tasks).toMatch(/^No task list yet/)
    expect(s.tasks).toMatchObject({ detailed: false, total: null })
  })
})

describe('ordinary subagents, as in the real session', () => {
  const run = async ($: any, on: any) => {
    const w = await started($, on)
    for (const [i, t] of ['ctk:explorer', 'ctk:implementer', 'ctk:reviewer'].entries()) expect((await $.agent.spawn(plain(i, t))).deny).toBeUndefined()
    return w
  }

  test('they are listed apart from teammates, with their type, status and description', async ($, on) => {
    await run($, on)
    const text = await view($, 'workers')
    expect(text).toContain('No teammate has started this session. 3 ordinary subagents ran or are running')
    expect(text).toContain('ORDINARY SUBAGENTS (3) - not teammates, not counted by the cap')
    for (const t of ['ctk:explorer', 'ctk:implementer', 'ctk:reviewer', 'scout 0']) expect(text).toContain(t)
  })

  test('the numbers match the observation: guard saw 3 spawns, 0 teammates, no workers', async ($, on) => {
    await run($, on)
    const s = await status($)
    expect(s).toMatchObject({ accepted: 0, workers: [], outsideCap: 0, live: 0, subagents: { total: 3, live: 3 } })
    expect(s.guard.state).toBe('active')
    expect(s.guard.why).toMatch(/reached by 3 spawn\(s\) this session, 0 of them teammate\(s\)/)
    expect(s.explain.workers).toContain('they are not teammates, so the cap does not count them')
  })

  test('Guard ON keeps its meaning and the overview does not read as a started team', async ($, on) => {
    await run($, on)
    const text = await view($, 'overview')
    expect(text).toContain('Guard ON')
    expect(text).toContain('0/3 active')
    expect(text).toContain('3 ordinary · 3 live · not teammates, so the cap does not count them')
    expect(text).toContain('Team time    unavailable (no worker started since CTK loaded)')
  })

  test('they never enter the hard limit: more of them than the cap all start', async ($, on) => {
    await started($, on)
    for (let i = 0; i < 6; i++) expect((await $.agent.spawn(plain(i, 'ctk:explorer'))).deny).toBeUndefined()
    const s = await status($)
    expect(s).toMatchObject({ live: 0, rejected: 0, subagents: { total: 6 } })
  })

  test('the band shows how many are live, apart from Agents n/cap', async ($, on) => {
    await run($, on)
    const line = flat(await (await band($)).drawn())
    expect(line).toContain('Agents 0/3')
    expect(line).toContain('Sub 3')
  })

  test('the command answers in text with the same split', async ($, on) => {
    const w = await run($, on)
    w.placePanes = false
    const out = await $.command.run({ command: 'ctk-mission', args: '' } as never)
    expect(out.text).toContain('subagents: 3 ordinary (3 live); not teammates, so the cap does not count them')
    expect(out.text).toContain('workers:  0/3 active')
    expect(out.text).toContain('note: No teammate has started this session. 3 ordinary subagents')
  })
})

describe('native teammates', () => {
  test('are listed as workers, and no subagent section appears when there are none', async ($, on) => {
    await started($, on)
    await $.agent.spawn(spawnInput(0, true, { name: 'w-a' }))
    await $.agent.spawn(spawnInput(1, true, { name: 'w-b' }))
    const text = await view($, 'workers')
    expect(text).toContain('w-a')
    expect(text).toContain('w-b')
    expect(text).not.toContain('No teammate has started')
    expect(text).not.toContain('ORDINARY SUBAGENTS')
    expect((await status($)).subagents).toEqual({ total: 0, live: 0 })
  })

  test('a team and a subagent side by side stay separate', async ($, on) => {
    await started($, on)
    await $.agent.spawn(spawnInput(0, true, { name: 'w-a' }))
    await $.agent.spawn(plain(5, 'general-purpose'))
    const text = await view($, 'workers')
    expect(text).toContain('w-a')
    expect(text).toContain('ORDINARY SUBAGENTS (1)')
    expect(await status($)).toMatchObject({ live: 1, subagents: { total: 1 } })
  })

  test('without task events the Tasks page explains it instead of showing a made-up list', async ($, on) => {
    await started($, on)
    await $.agent.spawn(spawnInput(0, true, { name: 'w-a' }))
    const text = await view($, 'tasks')
    expect(text).toContain('No task list yet')
    expect(text).not.toContain('#1')
    expect((await status($)).tasks).toMatchObject({ detailed: false, total: null, completed: null })
  })
})

describe('changing a setting is visible outside the pane', () => {
  test('the proposal tells the lead exactly what to say and where, and the band says Confirm until answered', async ($, on) => {
    const w = await started($, on)
    const r = statusOf(await $.tool.call({ tool: CONFIG_TOOL, action: 'propose', option: 'maxWorkers', value: 6 }))
    expect(r).toMatchObject({ status: 'pending_user_confirmation', applied: false })
    expect(r.next).toContain('press Confirm there')
    expect(r.next).toContain('Confirm setting')
    expect(w.opened.at(-1)).toMatchObject({ id: MC_PANE_ID })
    expect(flat(await (await band($)).drawn())).toContain('Confirm setting: click here')
    const p = await pane($)
    await p.press({ key: 'mc:view:config' })
    const text = flat(await p.drawn())
    expect(text).toContain('Nothing has changed yet. Press Confirm to apply it, or Cancel.')
  })

  test('a quiet band (hudIdle hidden) still appears while a change waits', { options: { hudIdle: 'hidden' } }, async ($, on) => {
    await started($, on)
    expect(flat(await (await band($)).drawn())).not.toContain('CTK ▸')
    await $.tool.call({ tool: CONFIG_TOOL, action: 'propose', option: 'maxWorkers', value: 6 })
    expect(flat(await (await band($)).drawn())).toContain('Confirm setting')
  })

  test('the Config page without a proposal says how a change is made', async ($, on) => {
    await started($, on)
    const text = await view($, 'config')
    expect(text).toContain('a Confirm button then appears on this page and you press it')
  })
})

void OPEN_KEY
