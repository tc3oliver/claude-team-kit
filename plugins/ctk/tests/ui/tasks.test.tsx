import { describe, expect } from 'claude-code/testing'

import { MC_PANE_ID } from '../../hooks/mission.ts'
import { moreHint, TASK_ROWS } from '../../hooks/ui/tasks.tsx'
import { displayWidth } from '../../shared/hudline.ts'
import { engine, fresh, test } from '../world.ts'

const START = { cwd: '/w', surface: null, isInteractive: false }
const pane = ($: any, cols = 100) =>
  $.ui.mount({ plugin: 'ctk', surface: 'terminal', component: 'Pane', requestId: MC_PANE_ID, props: { title: 'CTK Mission Control', isFocused: true, bodyColumns: cols, placement: 'inline', scroll: { offset: 0, bodyRows: 16 }, view: {} } })
const flat = (n: any): string =>
  typeof n === 'string' ? n : n.type === 'Button' ? `⟦${n.props.key}⟧${(n.children ?? []).map(flat).join('')}` : (n.children ?? []).map(flat).join(n.type === 'Box' ? ' ' : '')
const find = (n: any, key: string): any => (typeof n === 'string' ? undefined : n.props?.key === key ? n : (n.children ?? []).map((c: any) => find(c, key)).find(Boolean))
const call = ($: any, tool: string, id: string, extra: object = {}) => $.tool.call({ tool, tool_use_id: id, ...extra })
const taskTools = (e: Record<string, unknown>): unknown =>
  e.tool === 'TaskCreate' ? { task: { id: String(e.tool_use_id).replace('tc', ''), subject: e.subject } } : e.tool === 'TaskUpdate' ? { success: true, taskId: e.taskId, updatedFields: [] } : 'ok'

const board = async ($: any, on: any, n: number) => {
  engine(on, fresh(), undefined, { toolResult: taskTools })
  await $.session.start(START)
  for (let i = 1; i <= n; i++) await call($, 'TaskCreate', `tc${i}`, { subject: n === 7 ? ['Expand test/caesar.test.js to >=10 cases', 'Expand test/rle.test.js to >=10 cases', 'Expand test/roman.test.js to >=10 cases', 'Expand test/slugify.test.js to >=10 cases', 'Expand test/wordcount.test.js to >=10 cases', 'Run npm test', 'Write TEST-REPORT.md'][i - 1] : `task ${i}` })
}
const open = async ($: any, cols = 100) => {
  const p = await pane($, cols)
  await p.press({ key: 'mc:view:tasks' })
  return p
}
const bodyRows = async (p: any): Promise<number> => (find(await p.drawn(), 'body').children ?? []).length

describe('Tasks page', () => {
  test('rows, progress, frontier and the dependency are shown', async ($, on) => {
    await board($, on, 3)
    await call($, 'TaskUpdate', 'tu1', { taskId: '1', status: 'in_progress', owner: 'w-rle' })
    await call($, 'TaskUpdate', 'tu2', { taskId: '3', addBlockedBy: ['1', '2'] })
    const t = flat(await (await open($)).drawn())
    for (const want of ['0/3 marked complete', 'Ready #2', 'Blocked 1', '⟦mc:task:1⟧', '⟦mc:task:3⟧', '@w-rle', 'needs #1,#2']) expect(t).toContain(want)
  })

  test('the mini DAG appears with room and not below it', async ($, on) => {
    await board($, on, 3)
    await call($, 'TaskUpdate', 'tu1', { taskId: '3', addBlockedBy: ['1', '2'] })
    const wide = await open($, 130)
    expect(flat(await wide.drawn())).toContain('─┬▸[○ 3]')
    await wide.unmount()
    expect(flat(await (await open($, 8)).drawn())).not.toContain('─┬')
  })

  test('the docked 48-cell pane draws the five-test fan-in', async ($, on) => {
    await board($, on, 7)
    await call($, 'TaskUpdate', 'tu1', { taskId: '6', addBlockedBy: ['2', '4', '5'] })
    await call($, 'TaskUpdate', 'tu2', { taskId: '7', addBlockedBy: ['6'] })
    for (const id of ['1', '3']) await call($, 'TaskUpdate', `tc-${id}`, { taskId: id, status: 'completed' })
    for (const id of ['2', '4']) await call($, 'TaskUpdate', `tr-${id}`, { taskId: id, status: 'in_progress' })
    const p = await $.ui.mount({ plugin: 'ctk', surface: 'terminal', component: 'Pane', requestId: MC_PANE_ID, props: { title: 'CTK Mission Control', isFocused: true, bodyColumns: 48, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } })
    await p.press({ key: 'mc:view:tasks' })
    const t = flat(await p.drawn())
    expect(t).toContain('─┼▸[○ 6]')
    expect(t).toContain('──▸[○ 7]')
    expect(t).toContain('⟦mc:task:3⟧') // the unlinked tasks stay in the list
  })

  test('completion is marked complete, not verified', async ($, on) => {
    await board($, on, 2)
    await call($, 'TaskUpdate', 'tu1', { taskId: '1', status: 'completed' })
    const p = await open($)
    expect(flat(await p.drawn())).toContain('1/2 marked complete')
    await p.press({ key: 'mc:task:1' })
    const t = flat(await p.drawn())
    expect(t).toContain('marked complete (TaskUpdate; not verified)')
    expect(t).toContain('⟦mc:back⟧')
    await p.press({ key: 'mc:back' })
    expect(flat(await p.drawn())).toContain('⟦mc:task:2⟧')
  })

  test('detail lists blockers and flags an id the board has not seen', async ($, on) => {
    await board($, on, 2)
    await call($, 'TaskUpdate', 'tu1', { taskId: '2', addBlockedBy: ['1', '9'] })
    const p = await open($)
    await p.press({ key: 'mc:task:2' })
    const t = flat(await p.drawn())
    expect(t).toContain('#1 #9 (not seen)')
  })

  for (const cols of [60, 130]) {
    test(`40 tasks stay within ${TASK_ROWS} rows at ${cols} columns`, async ($, on) => {
      await board($, on, 40)
      for (let i = 2; i <= 40; i += 2) await call($, 'TaskUpdate', `tu${i}`, { taskId: String(i), addBlockedBy: ['1'] })
      const p = await open($, cols)
      expect(await bodyRows(p)).toBeLessThanOrEqual(TASK_ROWS)
      expect(flat(await p.drawn())).toMatch(/\+\d+ more/)
      await p.unmount()
    })
  }

  test('the overflow hint says how to see the rest and fits the room', () => {
    for (const cols of [58, 80, 98]) {
      const h = moreHint(12, cols - 1)
      expect(displayWidth(h)).toBeLessThanOrEqual(cols - 1)
      expect(h).toContain('+12 more')
      expect(h).toContain('enlarge')
    }
    expect(moreHint(12, 97)).toContain('ask Claude for the task list')
    expect(moreHint(12, 79)).toContain('ask Claude to list them')
    expect(moreHint(12, 40)).toContain('ask Claude')
    expect(moreHint(12, 30)).toBe('+12 more · enlarge terminal')
  })
})
