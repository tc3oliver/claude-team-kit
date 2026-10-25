import { describe, expect } from 'claude-code/testing'

import { isLifecycleOnly, isOwnAssignmentEcho } from '../hooks/notify.ts'
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
    // The main conversation is the lead: its own claim comes back as assignedBy team-lead.
    const leadEcho = await $.session.receive({ origin: { kind: 'peer' }, text: msg('team-lead') } as never)
    expect(leadEcho.consumed).toBe('ctk: own task_assignment echo')
    const report = String(((await $.command.run({ command: 'ctk-report' } as never)) as { text?: string }).text)
    expect(report).toContain('2 own task_assignment echo(es) dropped')
  })
})

const block = (from: string, body: object) => `<teammate-message teammate_id="${from}">\n${JSON.stringify(body)}\n</teammate-message>`
const terminated = (message: string) => block('system', { type: 'teammate_terminated', message })
const approved = block('w1', { type: 'shutdown_approved', requestId: 'shutdown-1@w1', from: 'w1' })

describe('isLifecycleOnly', () => {
  test('only shutdown approvals and terminations that released no task', async () => {
    expect(isLifecycleOnly(approved)).toBe(true)
    expect(isLifecycleOnly(`${terminated('w1 has shut down.')}\n\n${approved}`)).toBe(true)
    expect(isLifecycleOnly(terminated('w1 has shut down. 1 task(s) were unassigned: #23'))).toBe(false)
    expect(isLifecycleOnly(`${approved}\n${block('w2', { type: 'idle_notification', from: 'w2', result: 'done' })}`)).toBe(false)
    expect(isLifecycleOnly(`${approved}\nplease also check X`)).toBe(false)
    expect(isLifecycleOnly(block('w1', { type: 'shutdown_rejected' }))).toBe(false)
    expect(isLifecycleOnly('<teammate-message teammate_id="w1">{bad</teammate-message>')).toBe(false)
    expect(isLifecycleOnly('')).toBe(false)
  })

  test('the lead is not woken for them; a teammate’s delivery is never judged by it', async ($, on) => {
    const w = fresh()
    engine(on, w)
    on('session.receive', (_$, e) => ({ text: e.text }))
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    await $.agent.spawn(spawnInput(0, true, { name: 'w1' }))
    expect((await $.session.receive({ origin: { kind: 'peer' }, text: approved } as never)).consumed).toBe('ctk: shutdown bookkeeping')
    expect((await $.session.receive({ origin: { kind: 'peer' }, text: approved, agentId: 'a1' } as never)).text).toBe(approved)
    const released = terminated('w1 has shut down. 1 task(s) were unassigned: #23')
    expect((await $.session.receive({ origin: { kind: 'peer' }, text: released } as never)).text).toBe(released)
    const report = String(((await $.command.run({ command: 'ctk-report' } as never)) as { text?: string }).text)
    expect(report).toContain('1 shutdown notice(s) dropped')
  })
})
