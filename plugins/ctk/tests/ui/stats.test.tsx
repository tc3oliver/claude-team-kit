import { describe, expect } from 'claude-code/testing'

import { createCtx } from '../../hooks/ui/ctx.tsx'
import { renderStats, unobserved } from '../../hooks/ui/stats.tsx'
import { MC_PANE_ID } from '../../hooks/mission.ts'
import { engine, fresh, test } from '../world.ts'

const PANE = (bodyColumns: number) => ({ title: 'CTK Mission Control', isFocused: true, bodyColumns, placement: 'inline', scroll: { offset: 0, bodyRows: 16 }, view: {} })
const flat = (n: any): string => (typeof n === 'string' ? n : (n.children ?? []).map(flat).join(n.type === 'Box' ? '\n' : ''))
const textRows = (n: any): number => (typeof n === 'string' ? 0 : n.type === 'Text' ? 1 : n.type === 'Box' && n.props.flexDirection === 'row' ? Math.max(0, ...(n.children ?? []).map(textRows)) : (n.children ?? []).reduce((a: number, c: any) => a + textRows(c), 0))

const open = async ($: any, on: any, cols = 100) => {
  const w = fresh()
  engine(on, w)
  await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
  const p = await $.ui.mount({ plugin: 'ctk', surface: 'terminal', component: 'Pane', requestId: MC_PANE_ID, props: PANE(cols) })
  await p.press({ key: 'mc:view:stats' })
  const d = await p.drawn()
  return { text: flat(d), rows: textRows(d) }
}

describe('the unobserved matcher (hoisted out of the per-segment loop)', () => {
  test('a dash or "unavailable" value is unobserved; a number, and a dash not after the colon, are not', () => {
    for (const seg of ['cost: –', 'model: –', 'cost: unavailable', 'per-worker cost: unavailable']) expect(unobserved(seg)).toBe(true)
    for (const seg of ['tool calls: 0', 'spawns: 5 accepted', 'elapsed: 5m', 'refused: 0 – later', 'context: 42%']) expect(unobserved(seg)).toBe(false)
  })

  test('repeat calls agree: a hoisted non-global regex keeps no lastIndex between segments', () => {
    for (let i = 0; i < 3; i++) {
      expect(unobserved('cost: –')).toBe(true)
      expect(unobserved('tool calls: 3')).toBe(false)
    }
  })
})

describe('stats view', () => {
  test('counted and measured are separate sections', async ($, on) => {
    const { text: t, rows } = await open($, on)
    expect(t.indexOf('COUNTED BY CTK')).toBeGreaterThan(-1)
    expect(t.indexOf('COUNTED BY CTK')).toBeLessThan(t.indexOf('MEASURED BY CLAUDE CODE'))
    expect(t).toContain('per-worker cost: not available from Claude Code')
  })

  test('an unreported figure is a dash while a zero count stays 0', async ($, on) => {
    const { text: t, rows } = await open($, on)
    expect(t).toContain('cost: –')
    expect(t).toContain('0 refused at capacity')
  })

  test('fits the 16-row pane at 60 columns', async ($, on) => {
    expect((await open($, on, 60)).rows).toBeLessThanOrEqual(16)
  })

  for (const cols of [55, 60]) {
    test(`no row is cut mid-sentence at ${cols} columns and the weekly reset survives`, () => {
      const Box = (p: any) => p.children
      const kit: any = { Box, Text: Box, Button: Box }
      const ctx = createCtx(kit, { bodyColumns: cols })
      const statsText = [
        'CTK session s1',
        'counted by CTK:',
        '  teammate spawns: 5 accepted, 0 refused at capacity, 0 failed closed',
        'measured (reported by Claude Code):',
        '  model: Opus 5  cost: $1.20  context: 42%',
        '  5h limit: 28% (resets in 2h34m)  7d limit: 12% (resets in 4d0h)',
        '  elapsed: 5m  per-worker cost: not available from Claude Code',
      ].join('\n')
      const t = JSON.stringify(renderStats(kit, {} as any, {} as any, { statsText } as any, ctx))
      expect(t).not.toContain('…')
      expect(t).toContain('7d limit 12% · resets in 4d0h')
      expect(t).toContain('failed closed')
    })
  }
})
