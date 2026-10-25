import { describe, expect } from 'claude-code/testing'

import { isOwnAssignmentEcho } from '../hooks/notify.ts'
import { engine, fresh, spawnInput, test } from './world.ts'

const msg = (assignedBy: string, wrap = true) => {
  const json = JSON.stringify({ type: 'task_assignment', taskId: '37', subject: 's', assignedBy })
  return wrap ? `<teammate-message teammate_id="${assignedBy}" summary="x">\n${json}\n</teammate-message>` : json
}

describe('isOwnAssignmentEcho', () => {
  test('only a bare task_assignment by the recipient itself, wrapped or not', async () => {
    expect(isOwnAssignmentEcho(msg('w1'), 'w1')).toBe(true)
    expect(isOwnAssignmentEcho(msg('w1', false), 'w1')).toBe(true)
    expect(isOwnAssignmentEcho(msg('team-lead'), 'w1')).toBe(false)
    expect(isOwnAssignmentEcho(`${msg('w1')}\nplease also do X`, 'w1')).toBe(false)
    expect(isOwnAssignmentEcho('{"type":"idle","assignedBy":"w1"}', 'w1')).toBe(false)
    expect(isOwnAssignmentEcho('{not json}', 'w1')).toBe(false)
    expect(isOwnAssignmentEcho('', 'w1')).toBe(false)
  })
})

describe('session.receive', () => {
  test('drops a teammate’s own echo and delivers everything else', async ($, on) => {
    const w = fresh()
    engine(on, w)
    on('session.receive', (_$, e) => ({ text: e.text }))
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    await $.agent.spawn(spawnInput(0, true, { name: 'w1' }))
    const own = await $.session.receive({ origin: { kind: 'peer' }, text: msg('w1'), agentId: 'a1' } as never)
    expect(own.consumed).toBe('ctk: own task_assignment echo')
    const lead = await $.session.receive({ origin: { kind: 'coordinator' }, text: msg('team-lead'), agentId: 'a1' } as never)
    expect(lead.text).toBe(msg('team-lead'))
    const main = await $.session.receive({ origin: { kind: 'peer' }, text: msg('w1') } as never)
    expect(main.text).toBe(msg('w1'))
    const report = String(((await $.command.run({ command: 'ctk-report' } as never)) as { text?: string }).text)
    expect(report).toContain('1 own task_assignment echo(es) dropped')
  })
})
