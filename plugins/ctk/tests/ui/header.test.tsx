import { describe, expect, test } from 'claude-code/testing'

import { createCtx } from '../../hooks/ui/ctx.tsx'
import { header } from '../../hooks/ui/frame.tsx'
import { displayWidth } from '../../shared/hudline.ts'

const Pass = (p: any) => p.children
const kit: any = { Box: Pass, Text: Pass, Button: Pass }

const mission = (usage: { contextUsed?: number | null; fiveHourPct?: number | null; sevenDayPct?: number | null }, over: object = {}): any => ({
  guard: { state: 'active', why: '' },
  active: 1,
  cap: 3,
  rejected: 0,
  usage: { contextUsed: null, fiveHourPct: null, sevenDayPct: null, ...usage },
  ...over,
})

// The element tree's text pieces, in order.
const texts = (n: any): string[] => (typeof n === 'string' ? [n] : n == null || typeof n === 'boolean' ? [] : [n].flat().flatMap(x => (typeof x === 'string' ? [x] : texts(x?.props?.children))))
const line = (columns: number, m: any, ambiguous: 1 | 2 = 1): string => texts(header(kit, m, createCtx(kit, { bodyColumns: columns, ambiguous }))).join('  ')

describe('header pressure badges', () => {
  test('nothing under 60%, so a quiet session keeps the plain header', () => {
    expect(line(100, mission({ contextUsed: 42, fiveHourPct: 10, sevenDayPct: 59 }))).toBe('◆ CTK MISSION CONTROL  ● ACTIVE  read-only')
  })

  test('context, 5h and weekly show from 60%', () => {
    expect(line(100, mission({ contextUsed: 82, fiveHourPct: 61, sevenDayPct: 70 }))).toBe('◆ CTK MISSION CONTROL  ● ACTIVE  Ctx 82%  5h 61%  Wk 70%  read-only')
  })

  test('never wider than the room: read-only goes first, then weekly and 5h, the title shrinks, context stays', () => {
    const m = mission({ contextUsed: 82, fiveHourPct: 61, sevenDayPct: 70 })
    for (const columns of [30, 37, 40, 44, 50, 60, 70, 100, 200]) {
      for (const amb of [1, 2] as const) {
        const l = line(columns, m, amb)
        expect(displayWidth(l, amb)).toBeLessThanOrEqual(Math.max(10, columns - 1))
        expect(l).toContain('Ctx 82%')
      }
    }
    expect(line(46, m)).toBe('◆ CTK MISSION CONTROL  ● ACTIVE  Ctx 82%')
    expect(line(30, m)).toBe('◆ CTK  ● ACTIVE  Ctx 82%')
  })

  test('an unobserved figure draws no badge', () => {
    expect(line(100, mission({ contextUsed: null }))).not.toContain('Ctx')
  })
})
