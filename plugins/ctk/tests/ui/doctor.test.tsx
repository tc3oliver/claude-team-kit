import { describe, expect } from 'claude-code/testing'

import { createCtx } from '../../hooks/ui/ctx.tsx'
import { renderDoctor } from '../../hooks/ui/doctor.tsx'
import { parseDoctor } from '../../hooks/doctor.ts'
import { MC_PANE_ID } from '../../hooks/mission.ts'
import { engine, fresh, test } from '../world.ts'

const PANE = (bodyColumns: number) => ({ title: 'CTK Mission Control', isFocused: true, bodyColumns, placement: 'inline', scroll: { offset: 0, bodyRows: 16 }, view: {} })
const flat = (n: any): string => (typeof n === 'string' ? n : (n.children ?? []).map(flat).join(n.type === 'Box' ? '\n' : ''))
const textRows = (n: any): number => (typeof n === 'string' ? 0 : n.type === 'Text' ? 1 : n.type === 'Box' && n.props.flexDirection === 'row' ? Math.max(0, ...(n.children ?? []).map(textRows)) : (n.children ?? []).reduce((a: number, c: any) => a + textRows(c), 0))

const open = async ($: any, on: any, teams: boolean, cols = 100) => {
  const w = fresh()
  if (teams) w.settings = { env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' } }
  engine(on, w)
  await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
  const p = await $.ui.mount({ plugin: 'ctk', surface: 'terminal', component: 'Pane', requestId: MC_PANE_ID, props: PANE(cols) })
  await p.press({ key: 'mc:view:doctor' })
  const d = await p.drawn()
  return { text: flat(d), rows: textRows(d) }
}

describe('doctor view', () => {
  test('parseDoctor keeps a fix with its row', () => {
    const rows = parseDoctor('x\n[ok]     mod: loaded\n[action] teams: off\n         fix: do it\nready')
    expect(rows).toEqual([{ level: 'ok', text: 'mod: loaded' }, { level: 'action', text: 'teams: off', fix: 'do it' }])
  })

  test('a fix leads and carries its next step', async ($, on) => {
    const { text: t, rows } = await open($, on, false)
    expect(t).toContain('1 needs a fix')
    expect(t).toContain('Next: Add')
    expect(t.indexOf('not enabled')).toBeLessThan(t.indexOf('mod: loaded'))
  })

  test('a guard that is only available is never shown as ON', async ($, on) => {
    const { text: t, rows } = await open($, on, true)
    expect(t).toContain('No fixes needed')
    expect(t).toContain('agent teams: enabled')
    expect(t).not.toContain('guard: ON')
  })

  test('fits the 16-row pane at 60 columns', async ($, on) => {
    const { text: t, rows } = await open($, on, false, 60)
    expect(rows).toBeLessThanOrEqual(16)
  })

  for (const cols of [55, 60]) {
    test(`wraps the fix and its next step whole at ${cols} columns`, async ($, on) => {
      const { text: t } = await open($, on, false, cols)
      expect(t).not.toContain('…')
      expect(t).toContain('Next:')
      expect(t).toContain('1 needs a fix')
    })
  }

  test('6 actions at 44 columns stay in the row budget, keep the summary and count the rest', () => {
    const kit: any = { Box: (p: any) => p.children, Text: (p: any) => p.children, Button: (p: any) => p.children }
    const text = ['CTK readiness (read-only; nothing is changed):', ...Array.from({ length: 6 }, (_, i) => `[action] problem ${i}\n         fix: do thing ${i}`), '[info]   x: unknown', '6 action(s) needed'].join('\n')
    const out: any[] = renderDoctor(kit, {} as any, { doctorText: text } as any, {} as any, createCtx(kit, { bodyColumns: 44 }))
    const rows = out.map(n => [n].flat().join(''))
    expect(rows.length).toBeLessThanOrEqual(11)
    expect(rows[0]).toContain('6 need a fix')
    expect(rows[rows.length - 1]).toMatch(/^\+\d+ more/)
  })
})
