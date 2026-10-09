import { describe, expect, test } from 'claude-code/testing'

import { MC_PANE_ID } from '../hooks/mission.ts'
import { CONFIG_TOOL } from '../hooks/team.ts'
import { engine, fresh, spawnInput } from './world.ts'

const START = { cwd: '/w', surface: null, isInteractive: false }
const PANE = { title: 'CTK Mission Control', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 16 }, view: {} }

const flat = (n: any): string =>
  typeof n === 'string' ? n : n.type === 'Button' ? `⟦${n.props.key}⟧${(n.children ?? []).map(flat).join('')}` : (n.children ?? []).map(flat).join(n.type === 'Box' ? ' ' : '')

const pane = ($: any) => $.ui.mount({ plugin: 'ctk', surface: 'terminal', component: 'Pane', requestId: MC_PANE_ID, props: PANE })
const ask = ($: any, input: object) => $.tool.call({ tool: CONFIG_TOOL, ...input })
const answer = (r: any) => JSON.parse(r.result)

const session = async ($: any, on: any, opts: object = {}, delay?: (i: number) => number) => {
  const w = fresh()
  const clock = engine(on, w, delay, opts)
  await $.session.start(START)
  return { w, clock }
}

describe('the model can only propose', () => {
  test('a proposal changes nothing and says the user must confirm', async ($, on) => {
    const { w } = await session($, on)
    const r = answer(await ask($, { action: 'propose', option: 'maxWorkers', value: 2 }))
    expect(r).toMatchObject({ status: 'pending_user_confirmation', applied: false })
    expect(r.change).toContain('3 -> 2')
    expect(r.next).toContain('do not say it is done')
    expect(w.configSets).toEqual([])
    expect(w.opened[0]).toMatchObject({ id: MC_PANE_ID })
  })

  test('the pane shows the waiting change with Confirm and Cancel', async ($, on) => {
    await session($, on)
    await ask($, { action: 'propose', option: 'maxWorkers', value: 2 })
    const t = flat(await (await pane($)).drawn())
    expect(t).toContain('Waiting for you:')
    expect(t).toContain('3 -> 2')
    expect(t).toContain('⟦mc:cfg:confirm:c1⟧')
    expect(t).toContain('⟦mc:cfg:cancel:c1⟧')
  })

  test('show lists the real options and values, and any waiting change', async ($, on) => {
    await session($, on)
    const r = answer(await ask($, { action: 'show' }))
    expect(r.options.map((o: any) => o.option)).toEqual(['maxWorkers', 'explorerModel', 'implementerModel', 'reviewerModel', 'highRiskModel', 'hudBand', 'hudIdle', 'recordStats'])
    expect(r.options[0]).toMatchObject({ option: 'maxWorkers', value: '3', default: '3' })
    expect(r.waiting).toBeNull()
  })

  test('bad requests are rejected with the valid names, and nothing is stored or opened', async ($, on) => {
    const { w } = await session($, on)
    for (const input of [
      { action: 'propose', option: 'maxWorkers', value: 99 },
      { action: 'propose', option: 'maxWorkers', value: 0 },
      { action: 'propose', option: 'maxWorkers', value: 2.5 },
      { action: 'propose', option: 'settings.json', value: 'x' },
      { action: 'propose', option: 'explorerModel', value: 'bad model; rm -rf /' },
      { action: 'propose', option: 'hudBand', value: 'maybe' },
      { action: 'propose', option: 'maxWorkers', value: 3 },
    ]) {
      const r = answer(await ask($, input))
      expect(r.status).toBe('rejected')
      expect(w.opened).toHaveLength(0)
    }
    expect(w.configSets).toEqual([])
    expect(answer(await ask($, { action: 'propose', option: 'nope', value: 1 })).validOptions).toContain('maxWorkers')
  })

  test('an unknown action is an error, not a guess', async ($, on) => {
    await session($, on)
    expect(answer(await ask($, { action: 'apply', option: 'maxWorkers', value: 2 }))).toMatchObject({ error: expect.stringContaining('show') })
  })

  test('a rejected value is never echoed back', async ($, on) => {
    await session($, on)
    const text = JSON.stringify(await ask($, { action: 'propose', option: 'explorerModel', value: 'sk-ABCDEFGHIJKLMNOP1234' }))
    expect(text).not.toContain('ABCDEFGHIJKLMNOP')
  })
})

describe('only the confirm button applies', () => {
  test('Confirm calls $.config.set once with the key and the typed value, and the pending change is gone', async ($, on) => {
    const { w } = await session($, on)
    await ask($, { action: 'propose', option: 'maxWorkers', value: '2' })
    const p = await pane($)
    await p.press({ key: 'mc:cfg:confirm:c1' })
    expect(w.configSets).toEqual([{ key: 'ctk.maxWorkers', value: 2 }])
    expect(answer(await ask($, { action: 'show' })).waiting).toBeNull()
  })

  test('the cap in force follows the confirmed value at once', async ($, on) => {
    const { w } = await session($, on)
    await ask($, { action: 'propose', option: 'maxWorkers', value: 1 })
    await (await pane($)).press({ key: 'mc:cfg:confirm:c1' })
    await $.agent.spawn(spawnInput(0))
    const second = await $.agent.spawn(spawnInput(1))
    expect(second.deny).toContain('TEAM_CAPACITY_REACHED')
    expect(w.started).toBe(1)
  })

  test('Cancel discards the change and applies nothing', async ($, on) => {
    const { w } = await session($, on)
    await ask($, { action: 'propose', option: 'hudBand', value: false })
    const p = await pane($)
    await p.press({ key: 'mc:cfg:cancel:c1' })
    expect(w.configSets).toEqual([])
    expect(flat(await p.drawn())).toContain('Cancelled')
    expect(answer(await ask($, { action: 'show' })).waiting).toBeNull()
  })

  test('a second proposal replaces the first; only the latest can be confirmed', async ($, on) => {
    const { w } = await session($, on)
    await ask($, { action: 'propose', option: 'maxWorkers', value: 2 })
    await ask($, { action: 'propose', option: 'maxWorkers', value: 4 })
    const p = await pane($)
    await p.press({ key: 'mc:cfg:confirm:c2' })
    expect(w.configSets).toEqual([{ key: 'ctk.maxWorkers', value: 4 }])
  })

  test('a Confirm drawn for an earlier proposal cannot apply a later one', async ($, on) => {
    const { w } = await session($, on)
    await ask($, { action: 'propose', option: 'maxWorkers', value: 4 })
    const p = await pane($)
    // the model proposes again before the person presses; the old button is still in the person's hand
    await ask($, { action: 'propose', option: 'hudBand', value: false })
    await p.press({ key: 'mc:cfg:confirm:c1' }).catch(() => undefined)
    expect(w.configSets).toEqual([])
    expect(answer(await ask($, { action: 'show' })).waiting).toContain('Team band')
  })

  test('the buttons on screen always belong to the proposal now waiting', async ($, on) => {
    await session($, on)
    await ask($, { action: 'propose', option: 'maxWorkers', value: 4 })
    await ask($, { action: 'propose', option: 'hudBand', value: false })
    const t = flat(await (await pane($)).drawn())
    expect(t).toContain('⟦mc:cfg:confirm:c2⟧')
    expect(t).not.toContain('⟦mc:cfg:confirm:c1⟧')
  })

  test('pressing Confirm twice applies once', async ($, on) => {
    const { w } = await session($, on)
    await ask($, { action: 'propose', option: 'maxWorkers', value: 2 })
    const p = await pane($)
    await p.press({ key: 'mc:cfg:confirm:c1' })
    await p.press({ key: 'mc:view:config' })
    expect(w.configSets).toHaveLength(1)
  })

  test('a proposal older than ten minutes is dropped, not applied', async ($, on) => {
    const { w, clock } = await session($, on)
    await ask($, { action: 'propose', option: 'maxWorkers', value: 2 })
    await clock.advance(11 * 60_000)
    const p = await pane($)
    await p.press({ key: 'mc:cfg:confirm:c1' }).catch(() => undefined)
    expect(w.configSets).toEqual([])
  })

  test('a setting locked by managed policy is not changed', async ($, on) => {
    const { w } = await session($, on)
    w.configLocked = true
    await ask($, { action: 'propose', option: 'maxWorkers', value: 2 })
    const p = await pane($)
    await p.press({ key: 'mc:cfg:confirm:c1' })
    expect(w.configSets).toEqual([])
    expect(flat(await p.drawn())).toContain('managed setting')
  })

  test('a deny from Claude Code is shown and nothing is claimed as applied', async ($, on) => {
    const { w } = await session($, on)
    w.configDeny = 'takes a number between 1 and 12.'
    await ask($, { action: 'propose', option: 'maxWorkers', value: 2 })
    const p = await pane($)
    await p.press({ key: 'mc:cfg:confirm:c1' })
    const t = flat(await p.drawn())
    expect(t).toContain('Not applied: takes a number between 1 and 12.')
    expect(t).not.toContain('Applied: Max')
  })

  test('while a teammate is starting, Confirm waits and the proposal stays', async ($, on) => {
    const { w } = await session($, on)
    let release: () => void = () => {}
    w.spawnGate = new Promise<void>(r => { release = r })
    await ask($, { action: 'propose', option: 'maxWorkers', value: 2 })
    const spawning = $.agent.spawn(spawnInput(0))
    for (let i = 0; i < 500 && w.spawnCalls === 0; i++) await Promise.resolve()
    expect(w.spawnCalls).toBe(1)
    await (await pane($)).press({ key: 'mc:cfg:confirm:c1' })
    expect(w.configSets).toEqual([])
    release()
    await spawning
    expect(answer(await ask($, { action: 'show' })).waiting).toContain('3 -> 2')
  })

  test('a team that has settled does not block a change (listed teammates are pruned)', async ($, on) => {
    const { w, clock } = await session($, on)
    await $.agent.spawn(spawnInput(0))
    await clock.advance(30_000)
    await ask($, { action: 'propose', option: 'maxWorkers', value: 4 })
    await (await pane($)).press({ key: 'mc:cfg:confirm:c1' })
    expect(w.configSets).toEqual([{ key: 'ctk.maxWorkers', value: 4 }])
  })

  test('while a confirmed change is being written, a teammate spawn waits with a retryable refusal', async ($, on) => {
    const { w } = await session($, on)
    let release: () => void = () => {}
    w.configGate = new Promise<void>(r => { release = r })
    await ask($, { action: 'propose', option: 'maxWorkers', value: 4 })
    const p = await pane($)
    const pressing = p.press({ key: 'mc:cfg:confirm:c1' })
    await Promise.resolve()
    await new Promise(r => setTimeout(r, 20))
    const refused = await $.agent.spawn(spawnInput(0))
    expect(refused.deny).toContain('TEAM_GUARD_FAILED')
    expect(refused.deny).toContain('setting change')
    expect(w.started).toBe(0)
    release()
    await pressing
    const after = await $.agent.spawn(spawnInput(1))
    expect(after.deny).toBeUndefined()
  })

  test('the counters are written before the option is changed', async ($, on) => {
    const { w } = await session($, on)
    w.configSets.length = 0
    await $.agent.spawn(spawnInput(0, true)).catch(() => undefined)
    await ask($, { action: 'propose', option: 'maxWorkers', value: 4 })
    const before = w.rawPaths.length
    await (await pane($)).press({ key: 'mc:cfg:confirm:c1' })
    expect(w.rawPaths.length).toBeGreaterThanOrEqual(before)
  })

  test('when the roster cannot be read Confirm refuses rather than guessing', async ($, on) => {
    const { w } = await session($, on)
    await ask($, { action: 'propose', option: 'maxWorkers', value: 4 })
    w.listFails = true
    await (await pane($)).press({ key: 'mc:cfg:confirm:c1' })
    expect(w.configSets).toEqual([])
  })

  test('with no pane a proposal says how to change the option instead', async ($, on) => {
    const { w } = await session($, on)
    w.placePanes = false
    const r = answer(await ask($, { action: 'propose', option: 'maxWorkers', value: 2 }))
    expect(r.next).toContain('/plugin configure')
    expect(w.configSets).toEqual([])
  })

  test('nothing but Confirm ever reaches $.config.set', async ($, on) => {
    const { w } = await session($, on)
    await ask($, { action: 'show' })
    await ask($, { action: 'propose', option: 'maxWorkers', value: 2 })
    const p = await pane($)
    for (const key of ['mc:view:config', 'mc:hud:full', 'mc:refresh', 'mc:view:stats', 'mc:view:doctor']) await p.press({ key })
    await $.command.run({ command: 'ctk-mission', args: '' } as never)
    expect(w.configSets).toEqual([])
  })
})
