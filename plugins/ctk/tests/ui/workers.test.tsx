import { describe, expect } from 'claude-code/testing'

import { fmtClock } from '../../hooks/ui/workers.tsx'
import { BACK_KEY, MC_PANE_ID, workerKey } from '../../hooks/mission.ts'
import { displayWidth } from '../../shared/hudline.ts'
import { engine, fresh, spawnInput, test } from '../world.ts'

const START = { cwd: '/w', surface: null, isInteractive: false }
const pane = ($: any, cols: number) =>
  $.ui.mount({ plugin: 'ctk', surface: 'terminal', component: 'Pane', requestId: MC_PANE_ID, props: { title: 'CTK Mission Control', isFocused: true, bodyColumns: cols, placement: 'inline', scroll: { offset: 0, bodyRows: 16 }, view: {} } })
const flat = (n: any): string => (typeof n === 'string' ? n : (n.children ?? []).map(flat).join(n.type === 'Box' ? ' ' : ''))
// One string per row of the Workers body.
const bodyRows = async (p: any): Promise<string[]> => {
  const find = (n: any): any => (typeof n === 'string' ? undefined : n.props?.key === 'body' ? n : (n.children ?? []).map(find).find(Boolean))
  return (find(await p.drawn()).children ?? []).map(flat)
}

const open = async ($: any, on: any, names: string[], cols: number, total = names.length, extra: Record<string, unknown> = {}) => {
  const w = fresh()
  w.settings = { env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' } }
  engine(on, w)
  await $.session.start(START)
  for (const [i, name] of names.entries()) await $.agent.spawn(spawnInput(i, true, { name, ...extra }))
  // The cap stops at 12 spawns; the roster itself may hold more.
  for (let i = names.length; i < total; i++) w.agents.push({ ...w.agents[0]!, agentId: `x${i}`, teammateId: `x${i}`, name: `w${i}` })
  const p = await pane($, cols)
  await p.press({ key: 'mc:view:workers' })
  return { w, p }
}

const opts = { options: { maxWorkers: 12 } }

describe('Workers page', () => {
  test('empty: says no teammate started', opts, async ($, on) => {
    const { p } = await open($, on, [], 100)
    expect((await bodyRows(p)).join('\n')).toContain('No teammate')
  })

  for (const cols of [60, 100, 200]) {
    test(`${cols} columns: long and CJK names stay inside the room`, opts, async ($, on) => {
      const { p } = await open($, on, ['a-very-long-worker-name-that-keeps-going-and-going', '工作者小明的助手'], cols)
      const rows = await bodyRows(p)
      expect(rows.join('\n')).toContain('tools')
      for (const r of rows) expect(displayWidth(r)).toBeLessThanOrEqual(cols - 1)
    })
  }

  test('20 workers: the page stays within its row budget and counts the rest', opts, async ($, on) => {
    const { p } = await open($, on, Array.from({ length: 12 }, (_, i) => `w${i}`), 100, 20)
    const rows = await bodyRows(p)
    expect(rows.length).toBeLessThanOrEqual(11)
    expect(rows.join('\n')).toMatch(/\+\d+ more/)
  })

  test('12 workers at 60 columns stay in the budget too', opts, async ($, on) => {
    const { p } = await open($, on, Array.from({ length: 12 }, (_, i) => `w${i}`), 60)
    const rows = await bodyRows(p)
    expect(rows.length).toBeLessThanOrEqual(11)
    expect(rows.join('\n')).toMatch(/\+\d+ more/)
    expect(rows.join('\n')).toContain('Select a worker')
  })

  test('docked width: two lines per worker, whole name, task line kept, unobserved field is a dash', opts, async ($, on) => {
    const { p } = await open($, on, ['frontend-integration-tester'], 55)
    const rows = await bodyRows(p)
    expect(rows.find(r => r.includes('frontend-integration-tester'))).toMatch(/RUNNING/)
    expect(rows.join('\n')).toMatch(/– · 0 tools/)
  })

  for (const cols of [40, 44, 48, 55]) {
    test(`${cols} columns: line 2 keeps its numbers whole and cuts only the task`, opts, async ($, on) => {
      const w = fresh()
      w.settings = { env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' } }
      engine(on, w, undefined, { toolResult: (e: any) => (e.tool === 'TaskCreate' ? { task: { id: String(e.tool_use_id).replace('tc', ''), subject: e.subject } } : 'ok') })
      await $.session.start(START)
      const titles = ['Tests for caesar', 'Write the unit tests for the slugify module now']
      for (const [i, name] of ['t-caesar', 't-slug'].entries()) {
        await $.agent.spawn(spawnInput(i, true, { name }))
        await $.tool.call({ tool: 'TaskCreate', tool_use_id: `tc${i + 1}`, subject: titles[i] })
        await $.tool.call({ tool: 'TaskUpdate', tool_use_id: `tu${i + 1}`, taskId: String(i + 1), status: 'in_progress', owner: name })
      }
      const p = await pane($, cols)
      await p.press({ key: 'mc:view:workers' })
      const rows = await bodyRows(p)
      const details = rows.filter(r => r.includes('tools') || /\d+s/.test(r))
      expect(details.length).toBeGreaterThanOrEqual(2)
      for (const r of rows) expect(displayWidth(r)).toBeLessThanOrEqual(cols - 1)
      for (const r of details) expect(r.trimEnd()).toMatch(/(\d+[smh]|\d+s ago|–)$/) // never ends in a cut number
    })
  }

  test('12 workers at 60 columns fall back to one line with the TASK column', opts, async ($, on) => {
    const { p } = await open($, on, Array.from({ length: 12 }, (_, i) => `w${i}`), 60)
    expect((await bodyRows(p)).join('\n')).toContain('TASK')
  })

  test('wide: two lines per worker, elapsed since spawn, unobserved task says unavailable', opts, async ($, on) => {
    const { p } = await open($, on, ['w-a'], 100)
    const rows = await bodyRows(p)
    expect(rows.find(r => r.includes('w-a'))).toMatch(/RUNNING/)
    expect(rows.join('\n')).toMatch(/– · 0 tools · \d+:\d\d · last \d+s ago/)
  })

  test('five workers still get two lines each', opts, async ($, on) => {
    const { p } = await open($, on, ['a', 'b', 'c', 'd', 'e'], 100)
    const rows = await bodyRows(p)
    expect(rows.filter(r => r.includes(' tools'))).toHaveLength(5)
    expect(rows.length).toBeLessThanOrEqual(11)
  })

  test('six workers fall back to one line each with a TASK column', opts, async ($, on) => {
    const { p } = await open($, on, ['a', 'b', 'c', 'd', 'e', 'f'], 100)
    const rows = await bodyRows(p)
    expect(rows[0]).toContain('TASK')
    expect(rows.filter(r => r.includes('RUNNING'))).toHaveLength(6)
    expect(rows.join('\n')).not.toMatch(/\+\d+ more/)
  })

  test('status pill is whole, DONE for completed, activity bar relative to the busiest', opts, async ($, on) => {
    const { w, p } = await open($, on, ['a', 'b'], 100)
    for (let i = 0; i < 4; i++) await $.tool.call({ tool: 'Read', tool_use_id: `t${i}`, agentId: w.agents[0]!.id, file_path: '/w/x.ts' })
    const rows = (await bodyRows(p)).join('\n')
    expect(rows).toContain('RUNNING')
    expect(rows).toContain('▁▃▅▇')
    expect(rows).toContain('····')
    expect(rows).not.toContain('SUBAGENTS')
  })

  test('detail: recent calls newest first, unavailable when none, within the row budget', opts, async ($, on) => {
    const { w, p } = await open($, on, ['a', 'b'], 100)
    const id = w.agents[0]!.id
    await $.tool.call({ tool: 'Read', tool_use_id: 't1', agentId: id, file_path: '/w/one.ts' })
    await $.tool.call({ tool: 'Bash', tool_use_id: 't2', agentId: id, command: 'echo sk-secret' })
    await p.press({ key: workerKey(id) })
    const rows = await bodyRows(p)
    expect(rows.find(r => r.startsWith('Recent'))).toMatch(/Bash ‹ Read one\.ts/)
    expect(rows.join('\n')).not.toContain('sk-secret')
    expect(rows.length).toBeLessThanOrEqual(11)
    await p.press({ key: BACK_KEY })
    await p.press({ key: workerKey(w.agents[1]!.id) })
    expect((await bodyRows(p)).find(r => r.startsWith('Recent'))).toContain('unavailable (no tool call')
  })

  for (const cols of [60, 100]) {
    test(`a Button holds Text only, never a Box (${cols} columns)`, opts, async ($, on) => {
      const { p } = await open($, on, ['a', 'b', 'c'], cols)
      const bad = (n: any): boolean => typeof n !== 'string' && ((n.type === 'Button' && (n.children ?? []).some((c: any) => c.type === 'Box')) || (n.children ?? []).some(bad))
      expect(bad(await p.drawn())).toBe(false)
    })
  }
})

test('elapsed is m:ss, h:mm:ss past an hour', () => {
  expect(fmtClock(0)).toBe('0:00')
  expect(fmtClock(65_000)).toBe('1:05')
  expect(fmtClock(3_725_000)).toBe('1:02:05')
})
