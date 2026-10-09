import { describe, expect } from 'claude-code/testing'

import { MC_PANE_ID } from '../../hooks/mission.ts'
import { bodyRowsFor, moreText } from '../../hooks/ui/ctx.tsx'
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
      for (const want of ['ACTIVE', 'SLOTS', '1/3', '[███', '28%', 'resets 2h34m', '[──────────', '$0.94', 'unavailable']) expect(t).toContain(want)
      expect(t).not.toContain('Weekly quota [░░░')
      await p.unmount()
    })
  }

  test('four metric cards across from 56 cells, 2 by 2 below; a card never invents a zero', async ($, on) => {
    await team($, on)
    for (const cols of [60, 130, 44]) {
      const p = await pane($, cols)
      const t = await texts(p)
      for (const want of ['WORKERS', 'TASKS', 'REFUSED', 'COST']) expect(t).toContain(want)
      await p.unmount()
    }
    // No task event was seen: the TASKS card says unavailable, not 0/0.
    const p = await pane($, 80)
    expect(await texts(p)).toMatch(/TASKS\s+unavailable/)
    await p.unmount()
  })

  test('the slot meter has one glyph per cap slot, and a full team reads CAPACITY, never green ACTIVE', async ($, on) => {
    await team($, on)
    await $.agent.spawn(spawnInput(1, true, { name: 'w-b' }))
    await $.agent.spawn(spawnInput(2, true, { name: 'w-c' }))
    await $.agent.spawn(spawnInput(3, true, { name: 'w-d' }))
    const p = await pane($, 80)
    await p.press({ key: 'mc:refresh' })
    const t = await texts(p)
    expect(t).toContain('▲ CAPACITY')
    expect(t).not.toContain('● ACTIVE')
    expect(t).toContain('3/3')
    expect(t).toContain('TEAM_CAPACITY_REACHED')
    await p.unmount()
  })

  test('tabs: full labels from 69 cells, four letters below, on every body from 56 to 130', async ($, on) => {
    await team($, on)
    for (const [cols, full] of [[57, false], [60, false], [70, true], [80, true], [130, true]] as const) {
      const p = await pane($, cols)
      const t = await texts(p)
      expect(t.includes('Overview Workers Tasks')).toBe(full)
      expect(t.includes('Over Work Task')).toBe(!full)
      await p.unmount()
    }
  })

  test('a docked pane gets the rows the engine reports, an inline one keeps 11', () => {
    expect(bodyRowsFor({ placement: 'inline', scroll: { bodyRows: 60 } })).toBe(11)
    expect(bodyRowsFor({ placement: 'dock', scroll: { bodyRows: 60 } })).toBe(55)
    expect(bodyRowsFor({ placement: 'dock', scroll: { bodyRows: 8 } })).toBe(11)
    expect(bodyRowsFor({})).toBe(11)
  })

  test('the long guard explanation is wrapped, not cut', async ($, on) => {
    const w = fresh()
    engine(on, w)
    await $.session.start(START)
    const t = await texts(await pane($, 60))
    expect(t).toContain('Agent Teams are not enabled')
    expect(t).toContain('start')
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

describe('overflow line', () => {
  test('says how to see the rest, short at 58 cells and in full at 98', () => {
    expect(moreText(3, 58)).toBe('+3 more · enlarge terminal or ask Claude')
    expect(moreText(3, 98)).toBe('+3 more lines not shown · enlarge the terminal or ask Claude')
    expect(moreText(3, 30)).toBe('+3 more · enlarge terminal')
    expect(moreText(3, 8)).toBe('+3 more')
  })
})

describe('guard sentence and cards', () => {
  test('the guard reason is a whole sentence with the code intact at 60 and 100 columns', async ($, on) => {
    await team($, on)
    for (const cols of [60, 100]) {
      const p = await pane($, cols)
      const t = await texts(p)
      expect(t).toContain('spawn(s) reached the guard')
      expect(t).toContain('refuses a 4th')
      expect(t).toContain('TEAM_CAPACITY_REACHED')
      expect(t).not.toContain('…')
      await p.unmount()
    }
  })

  test('curated tab stubs are whole words, never a cut label', async ($, on) => {
    await team($, on)
    const p = await pane($, 60)
    const t = await texts(p)
    for (const stub of ['Over', 'Work', 'Task', 'Use', 'Cfg', 'Stat', 'Doc']) expect(t).toContain(stub)
    for (const cut of ['Usag', 'Conf', 'Doct']) expect(t).not.toContain(cut)
    await p.unmount()
  })

  test('four cards sit side by side at 60 columns, two rows in all', async ($, on) => {
    await team($, on)
    const p = await pane($, 60)
    const root: any = await p.drawn()
    const row = (n: any): any => (typeof n === 'string' ? null : n.type === 'Box' && n.props.flexDirection === 'row' && (n.children ?? []).length === 4 && (n.children ?? []).every((c: any) => c.props?.flexDirection === 'column') ? n : (n.children ?? []).map(row).find(Boolean))
    expect(row(root)?.children).toHaveLength(4)
    await p.unmount()
  })
})
