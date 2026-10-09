import { describe, expect, test } from 'claude-code/testing'

import { createCtx } from '../../hooks/ui/ctx.tsx'
import { renderUsage } from '../../hooks/ui/usage.tsx'
import { MC_PANE_ID } from '../../hooks/mission.ts'
import { engine, fresh, test as worldTest } from '../world.ts'

const PANE = { title: 'CTK Mission Control', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 16 }, view: {} }
const flat = (n: any): string => (typeof n === 'string' ? n : (n.children ?? []).map(flat).join(n.type === 'Box' ? '\n' : ''))

describe('usage view', () => {
  worldTest('draws bars from observed percents and a muted dash bar for the rest', async ($, on) => {
    const w = fresh()
    w.usage = {
      startedAt: 0,
      context: { window: 200000, percent: 42 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 13, resetsAt: new Date(2_000_000).toISOString() }],
    }
    engine(on, w)
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    const p = await $.ui.mount({ plugin: 'ctk', surface: 'terminal', component: 'Pane', requestId: MC_PANE_ID, props: PANE })
    await p.press({ key: 'mc:view:usage' })
    const t = flat(await p.drawn())
    expect(t).toContain('5H   [█░░░░░░░░░] 13%')
    expect(t).toMatch(/WEEK \[─+\] –\s+unavailable/)
    expect(t).toContain('CTX  [████░░░░░░] 42%')
    expect(t).not.toContain('WEEK [░')
  })
})

describe('usage bars', () => {
  test('read numbers, not display wording', async () => {
    const Box = (p: any) => p.children
    const kit: any = { Box, Text: Box, Button: Box }
    const ctx = createCtx(kit, { bodyColumns: 100 })
    const base: any = { usage: { fiveHourPct: 13, sevenDayPct: null, contextUsed: 42, fiveHourReset: '2h45m', sevenDayReset: null, fiveHour: 'whatever', sevenDay: 'x', contextPct: 'y', cost: '$1', toolCalls: 1, model: null } }
    const draw = (m: any) => JSON.stringify(renderUsage(kit, m, {} as any, {} as any, ctx))
    const a = draw(base)
    const b = draw({ usage: { ...base.usage, fiveHour: 'other wording', sevenDay: 'zzz' } })
    expect(a).toContain('[█░░░░░░░░░] 13%  reset 2h45m')
    expect(a).toContain('[──────────] –')
    expect(b).toContain('[█░░░░░░░░░] 13%  reset 2h45m')
    expect(b).toContain('[──────────] –')
  })
})
