import { describe, expect } from 'claude-code/testing'

import { MC_PANE_ID } from '../../hooks/mission.ts'
import { CONFIG_TOOL } from '../../hooks/team.ts'
import { engine, fresh, test } from '../world.ts'

const flat = (n: any): string =>
  typeof n === 'string' ? n : n.type === 'Button' ? `⟦${n.props.key}⟧${(n.children ?? []).map(flat).join('')}` : (n.children ?? []).map(flat).join(n.type === 'Box' ? '\n' : '')
const open = async ($: any, on: any, bodyColumns: number) => {
  engine(on, fresh())
  await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
  await $.tool.call({ tool: CONFIG_TOOL, action: 'propose', option: 'maxWorkers', value: 2 })
  const props = { title: 'CTK Mission Control', isFocused: true, bodyColumns, placement: 'inline', scroll: { offset: 0, bodyRows: 16 }, view: {} }
  const p = await $.ui.mount({ plugin: 'ctk', surface: 'terminal', component: 'Pane', requestId: MC_PANE_ID, props })
  await p.press({ key: 'mc:view:config' })
  return flat(await p.drawn())
}

describe('config view', () => {
  for (const cols of [60, 130]) {
    test(`groups the options and marks the pending change at ${cols} columns`, async ($, on) => {
      const t = await open($, on, cols)
      for (const g of ['Team', 'Models', 'Band', 'Other']) expect(t).toContain(g)
      expect(t).toContain('PENDING CHANGE')
      expect(t).toContain('3 → 2 (pending)')
      expect(t.indexOf('⟦mc:cfg:confirm:c1⟧')).toBeLessThan(t.indexOf('Models'))
      expect(t).toContain('⟦mc:cfg:cancel:c1⟧')
    })
  }
})
