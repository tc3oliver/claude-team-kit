import { describe, expect } from 'claude-code/testing'

import { MC_PANE_ID } from '../../hooks/mission.ts'
import { engine, fresh, spawnInput, test } from '../world.ts'

const START = { cwd: '/w', surface: null, isInteractive: false }
const PANE = { title: 'CTK Mission Control', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 16 }, view: {} }

const pane = ($: any, bodyColumns: number) => $.ui.mount({ plugin: 'ctk', surface: 'terminal', component: 'Pane', requestId: MC_PANE_ID, props: { ...PANE, bodyColumns } })
const flat = (n: any): string => (typeof n === 'string' ? n : (n.children ?? []).map(flat).join(n.type === 'Box' ? ' ' : ''))
const texts = async (m: any): Promise<string> => flat(await m.drawn())
// Text rows in the drawn tree: each Text is one row, a Box of rows is its parts side by side.
const textRows = (n: any): number => (typeof n === 'string' ? 0 : n.type === 'Text' ? 1 : n.type === 'Box' && n.props.flexDirection === 'row' ? Math.max(0, ...(n.children ?? []).map(textRows)) : (n.children ?? []).reduce((a: number, c: any) => a + textRows(c), 0))

const team = async ($: any, on: any) => {
  const w = fresh()
  w.model = 'claude-sonnet-5-5'
  w.settings = { env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' } }
  w.usage = {
    startedAt: 1_000_000 - 12 * 60_000,
    context: { window: 200000, percent: 42 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 28.4, resetsAt: new Date(1_000_000 + 154 * 60_000).toISOString() }],
    cost: { usd: 0.94 },
  }
  engine(on, w)
  await $.session.start(START)
  await $.agent.spawn(spawnInput(0, true, { name: 'w-rle', model: 'claude-sonnet-5-5' }))
}

describe('overview', () => {
  for (const cols of [60, 80, 130]) {
    test(`${cols} columns: guard, workers, quota bars and cost; the quota not observed is a muted dash bar`, async ($, on) => {
      await team($, on)
      const p = await pane($, cols)
      const t = await texts(p)
      for (const want of ['ACTIVE', '1/3 active', '[███', '28%', 'resets in 2h34m', '[──────────', '$0.94', 'unavailable']) expect(t).toContain(want)
      expect(t).not.toContain('Weekly quota [░░░')
      await p.unmount()
    })
  }

  test('130 columns draws metric cards; 60 does not', async ($, on) => {
    await team($, on)
    const wide = await pane($, 130)
    expect(await texts(wide)).toContain('Native workers')
    await wide.unmount()
    const narrow = await pane($, 60)
    expect(await texts(narrow)).not.toContain('Native workers')
    await narrow.unmount()
  })

  test('the long guard explanation is wrapped, not cut', async ($, on) => {
    const w = fresh()
    engine(on, w)
    await $.session.start(START)
    const t = await texts(await pane($, 60))
    expect(t).toContain('Agent Teams are')
    expect(t).toContain('can start')
    expect(t).not.toContain('…')
  })

  test('no team yet: the empty state and the subagent note, and no invented zero counts', async ($, on) => {
    const w = fresh()
    engine(on, w)
    await $.session.start(START)
    for (const cols of [60, 130]) {
      const p = await pane($, cols)
      const t = await texts(p)
      await p.unmount()
      expect(t).toContain('No native team yet.')
      expect(t).toContain('Use a team to start coordinated work.')
      expect(t).toContain('do not count toward the CTK Worker Cap')
      expect(t).not.toContain('0 failed')
    }
  })

  test('the overview stays within the pane row budget and keeps the HUD control', async ($, on) => {
    await team($, on)
    for (const cols of [60, 80, 130]) {
      const p = await pane($, cols)
      expect(textRows(await p.drawn())).toBeLessThanOrEqual(PANE.scroll.bodyRows)
      expect(await texts(p)).toContain('HUD form')
      await p.unmount()
    }
  })
})
