import { describe, expect } from 'claude-code/testing'

import { engine, fresh, spawnInput, test } from './world.ts'

const START = { cwd: '/w', surface: null, isInteractive: false }

const taskTools = (e: Record<string, unknown>): unknown => {
  if (e.tool === 'TaskCreate') return { task: { id: String(e.tool_use_id).replace('tc', ''), subject: e.subject } }
  if (e.tool === 'TaskUpdate') return { success: true, taskId: e.taskId, updatedFields: [] }
  return 'ok'
}
const call = ($: any, tool: string, id: string, extra: object = {}) => $.tool.call({ tool, tool_use_id: id, ...extra })

const team = async ($: any, on: any) => {
  const w = fresh()
  w.settings = { env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' } }
  engine(on, w, undefined, { toolResult: taskTools })
  await $.session.start(START)
  await $.agent.spawn(spawnInput(0, true, { name: 'w1' }))
  await $.agent.spawn(spawnInput(1, true, { name: 'w2' }))
  return w
}

describe('context the mod adds to a tool result', () => {
  test('a file collision is an array of strings, told once', async ($, on) => {
    await team($, on)
    await call($, 'Edit', 'e1', { agentId: 'a1', file_path: '/r/a.ts' })
    const second: any = await call($, 'Edit', 'e2', { agentId: 'a2', file_path: '/r/a.ts' })
    expect(Array.isArray(second.context)).toBe(true)
    expect(second.context[0]).toContain('w1 and w2')
    const third: any = await call($, 'Edit', 'e3', { agentId: 'a1', file_path: '/r/a.ts' })
    expect(third.context).toBeUndefined()
  })

  test('the unchecked-completion line is an array and only on the update that completes the last open task', async ($, on) => {
    await team($, on)
    await call($, 'TaskCreate', 'tc1', { subject: 'one' })
    await call($, 'TaskCreate', 'tc2', { subject: 'two' })
    await call($, 'TaskUpdate', 'tu1', { agentId: 'a1', taskId: '1', status: 'completed' })
    const owner: any = await call($, 'TaskUpdate', 'tu2', { taskId: '2', owner: 'w2' })
    expect(owner.context).toBeUndefined()
    const last: any = await call($, 'TaskUpdate', 'tu3', { taskId: '2', status: 'completed' })
    expect(Array.isArray(last.context)).toBe(true)
    expect(last.context[0]).toContain('#1')
    const again: any = await call($, 'TaskUpdate', 'tu4', { taskId: '2', status: 'completed' })
    expect(again.context).toBeUndefined()
  })
})
