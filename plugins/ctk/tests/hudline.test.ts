import { describe, expect, test } from 'claude-code/testing'

import {
  DASH,
  displayWidth,
  fmtCountdown,
  fmtPct,
  layoutLine,
  resetMs,
  SEP,
  stripAnsi,
  tierOf,
  truncateToWidth,
  usageSegment,
  windowFigures,
} from '../shared/hudline.ts'
import type { Segment } from '../shared/hudline.ts'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const NOW = Date.UTC(2026, 9, 9, 3, 0, 0)

describe('display width', () => {
  test('ASCII is one cell per character', () => {
    expect(displayWidth('5h 28% (2h34m)')).toBe(14)
  })

  test('CJK and fullwidth characters take two cells', () => {
    expect(displayWidth('分支')).toBe(4)
    expect(displayWidth('ｆｕｌｌ')).toBe(8)
    expect(displayWidth('feat/認證')).toBe(9)
  })

  test('emoji take two cells; combining marks and joiners take none', () => {
    expect(displayWidth('🚀')).toBe(2)
    expect(displayWidth('é')).toBe(1)
    expect(displayWidth('a‍b')).toBe(2)
  })

  test('ANSI colour and OSC sequences take no cells', () => {
    const styled = '\x1b[1;38;5;81mSonnet\x1b[0m \x1b]8;;https://example.com\x07link\x1b]8;;\x07'
    expect(stripAnsi(styled)).toBe('Sonnet link')
    expect(displayWidth(styled)).toBe(11)
  })

  test('control characters take no cells', () => {
    expect(displayWidth('a\tb\r\nc\x07')).toBe(3)
  })

  test('East Asian Ambiguous characters are one cell, or two where the terminal says so', () => {
    expect(displayWidth('│·…×')).toBe(4)
    expect(displayWidth('│·…×', 2)).toBe(8)
    expect(displayWidth('abc', 2)).toBe(3)
  })

  test('truncation never splits a wide character and ends with an ellipsis within the budget', () => {
    expect(truncateToWidth('認證功能分支', 7)).toBe('認證功…')
    expect(displayWidth(truncateToWidth('認證功能分支', 7))).toBe(7)
    expect(truncateToWidth('認證功能分支', 6)).toBe('認證…')
    expect(truncateToWidth('short', 10)).toBe('short')
    expect(truncateToWidth('anything', 0)).toBe('')
    expect(truncateToWidth('\x1b[1mbold text here\x1b[0m', 6)).toBe('bold …')
  })

  test('truncation counts an ambiguous ellipsis as two cells where the terminal does', () => {
    const cut = truncateToWidth('abcdefghij', 6, 2)
    expect(displayWidth(cut, 2)).toBeLessThanOrEqual(6)
    expect(cut.endsWith('…')).toBe(true)
  })
})

describe('figures', () => {
  test('a percentage is rounded; a missing or invalid one is a dash, never 0%', () => {
    expect(fmtPct(28.4)).toBe('28%')
    expect(fmtPct(28.5)).toBe('29%')
    expect(fmtPct(0)).toBe('0%')
    expect(fmtPct(100)).toBe('100%')
    for (const v of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -1]) expect(fmtPct(v as never)).toBe(DASH)
  })

  test('reset times: epoch seconds, epoch milliseconds and ISO 8601 all mean the same instant', () => {
    const iso = '2026-10-09T05:34:00Z'
    const ms = Date.parse(iso)
    expect(resetMs(ms / 1000)).toBe(ms)
    expect(resetMs(ms)).toBe(ms)
    expect(resetMs(iso)).toBe(ms)
  })

  test('an ISO time with an offset is the same instant as its UTC form', () => {
    expect(resetMs('2026-10-09T13:34:00+08:00')).toBe(resetMs('2026-10-09T05:34:00Z'))
  })

  test('anything else is not a reset time', () => {
    for (const v of [null, undefined, '', '  ', 'tomorrow', 0, -5, Number.NaN, {}, [], true]) expect(resetMs(v)).toBeNull()
  })

  test('countdown units', () => {
    const at = (offset: number) => fmtCountdown(NOW + offset, NOW)
    expect(at(30_000)).toBe('<1m')
    expect(at(MIN)).toBe('1m')
    expect(at(34 * MIN + 59_000)).toBe('34m')
    expect(at(59 * MIN + 59_000)).toBe('59m')
    expect(at(HOUR)).toBe('1h00m')
    expect(at(2 * HOUR + 34 * MIN)).toBe('2h34m')
    expect(at(23 * HOUR + 59 * MIN)).toBe('23h59m')
    expect(at(DAY)).toBe('1d0h')
    expect(at(3 * DAY + 12 * HOUR + 40 * MIN)).toBe('3d12h')
    expect(at(6 * DAY + 23 * HOUR + 59 * MIN)).toBe('6d23h')
  })

  test('a reset time that has passed, or no time, gives no countdown', () => {
    expect(fmtCountdown(NOW, NOW)).toBeNull()
    expect(fmtCountdown(NOW - MIN, NOW)).toBeNull()
    expect(fmtCountdown(null, NOW)).toBeNull()
    expect(fmtCountdown(NOW + HOUR, Number.NaN)).toBeNull()
  })

  test('a window whose reset has passed is a dash, not a stale number', () => {
    expect(windowFigures({ pct: 80, resetsAtMs: NOW - MIN }, NOW)).toEqual({ pct: DASH, countdown: null, missing: true })
  })

  test('a percentage without a reset time still shows, without a countdown', () => {
    expect(windowFigures({ pct: 28.4, resetsAtMs: null }, NOW)).toEqual({ pct: '28%', countdown: null, missing: false })
  })

  test('usage segments: parenthesised when full, plain when abbreviated, dash when missing', () => {
    const seg = usageSegment('5h', '5h', 100, { pct: 28.4, resetsAtMs: NOW + 2 * HOUR + 34 * MIN }, NOW)
    expect(seg.forms).toEqual(['5h 28% (2h34m)', '5h 28% 2h34m', '5h 28% 2h34m'])
    const none = usageSegment('wk', 'Wk', 90, { pct: null, resetsAtMs: NOW + DAY }, NOW)
    expect(none).toMatchObject({ missing: true, forms: ['Wk –', 'Wk –', 'Wk –'] })
  })
})

const SEGMENTS: Segment[] = [
  { id: 'model', prio: 60, bold: true, forms: ['Sonnet 5.5', 'Sonnet 5.5', ''] },
  { id: '5h', prio: 100, forms: ['5h 28% (2h34m)', '5h 28% 2h34m', '5h 28% 2h34m'] },
  { id: 'wk', prio: 90, forms: ['Wk 51% (3d12h)', 'Wk 51% 3d12h', 'Wk 51% 3d12h'] },
  { id: 'tools', prio: 80, forms: ['Tools 153', 'T153', 'T153'] },
  { id: 'agents', prio: 50, forms: ['Agents 2/3 (1 busy)', 'A2/3', 'A2/3'] },
  { id: 'ctx', prio: 70, forms: ['Ctx 42%', 'Ctx 42%', 'Ctx 42%'] },
  { id: 'tasks', prio: 40, forms: ['Tasks 3/6', 'Tasks 3/6', ''] },
  { id: 'cost', prio: 30, forms: ['$0.94 (12m)', '$0.94', ''] },
  { id: 'git', prio: 20, forms: ['feat/auth*', 'feat/auth*', ''] },
]

const line = (columns: number, segments = SEGMENTS, extra: object = {}) => layoutLine(segments, { columns, ...extra })

describe('layout snapshots', () => {
  test('tiers follow the width', () => {
    expect([200, 160, 120, 119, 100, 80, 79, 40].map(tierOf)).toEqual([0, 0, 0, 1, 1, 1, 2, 2])
  })

  test('200 columns: everything, full wording', () => {
    expect(line(200)).toBe(
      'Sonnet 5.5 │ 5h 28% (2h34m) │ Wk 51% (3d12h) │ Tools 153 │ Agents 2/3 (1 busy) │ Ctx 42% │ Tasks 3/6 │ $0.94 (12m) │ feat/auth*',
    )
  })

  test('160 columns is the same as 200', () => {
    expect(line(160)).toBe(line(200))
  })

  test('120 columns: full wording, lowest ranks dropped until it fits', () => {
    expect(line(120)).toBe('Sonnet 5.5 │ 5h 28% (2h34m) │ Wk 51% (3d12h) │ Tools 153 │ Agents 2/3 (1 busy) │ Ctx 42% │ Tasks 3/6 │ $0.94 (12m)')
    expect(displayWidth(line(120))).toBeLessThanOrEqual(120)
  })

  test('100 columns: abbreviated wording', () => {
    expect(line(100)).toBe('Sonnet 5.5 │ 5h 28% 2h34m │ Wk 51% 3d12h │ T153 │ A2/3 │ Ctx 42% │ Tasks 3/6 │ $0.94 │ feat/auth*')
  })

  test('80 columns: abbreviated, git and cost go first', () => {
    expect(line(80)).toBe('Sonnet 5.5 │ 5h 28% 2h34m │ Wk 51% 3d12h │ T153 │ A2/3 │ Ctx 42% │ Tasks 3/6')
    expect(displayWidth(line(80))).toBeLessThanOrEqual(80)
  })

  test('under 80 columns only the three most important figures are kept', () => {
    expect(line(79)).toBe('5h 28% 2h34m │ Wk 51% 3d12h │ T153')
    expect(line(60)).toBe('5h 28% 2h34m │ Wk 51% 3d12h │ T153')
  })

  test('a very narrow line drops whole figures in rank order, never half of one', () => {
    expect(line(32)).toBe('5h 28% 2h34m │ Wk 51% 3d12h')
    expect(line(14)).toBe('5h 28% 2h34m')
  })

  test('one figure that still does not fit is shortened with an ellipsis', () => {
    const out = line(8)
    expect(out).toBe('5h 28% …')
    expect(displayWidth(out)).toBe(8)
  })

  test('the order shown is the display order, not the rank order', () => {
    expect(line(200).split(SEP)[0]).toBe('Sonnet 5.5')
  })
})

describe('layout rules', () => {
  test('the line is never wider than the terminal at any width from 1 to 250', () => {
    for (let columns = 1; columns <= 250; columns++) {
      expect(displayWidth(line(columns))).toBeLessThanOrEqual(columns)
      expect(displayWidth(line(columns, SEGMENTS, { ambiguous: 2 }), 2)).toBeLessThanOrEqual(columns)
    }
  })

  test('a width that cannot be read falls back to a safe 80', () => {
    for (const columns of [Number.NaN, 0, -3, undefined as never]) expect(line(columns)).toBe(line(80))
  })

  test('fractional widths are floored', () => {
    expect(line(99.9)).toBe(line(99))
  })

  test('a missing figure is dropped before a real one, whatever its rank', () => {
    const segs: Segment[] = [
      { id: '5h', prio: 100, missing: true, forms: ['5h –', '5h –', '5h –'] },
      { id: 'wk', prio: 90, forms: ['Wk 51% (3d12h)', 'Wk 51% 3d12h', 'Wk 51% 3d12h'] },
      { id: 'tools', prio: 80, forms: ['Tools 153', 'T153', 'T153'] },
    ]
    expect(line(200, segs)).toBe('5h – │ Wk 51% (3d12h) │ Tools 153')
    expect(line(20, segs)).toBe('Wk 51% 3d12h │ T153')
    expect(line(79, segs)).toBe('5h – │ Wk 51% 3d12h │ T153')
  })

  test('in the narrowest tier real figures take the three places before missing ones do', () => {
    const segs: Segment[] = [
      { id: '5h', prio: 100, missing: true, forms: ['5h –', '5h –', '5h –'] },
      { id: 'wk', prio: 90, missing: true, forms: ['Wk –', 'Wk –', 'Wk –'] },
      { id: 'tools', prio: 80, forms: ['Tools 1', 'T1', 'T1'] },
      { id: 'ctx', prio: 70, forms: ['Ctx 4%', 'Ctx 4%', 'Ctx 4%'] },
    ]
    expect(line(60, segs)).toBe('5h – │ T1 │ Ctx 4%')
    expect(line(60, segs.slice(2))).toBe('T1 │ Ctx 4%')
  })

  test('CJK text counts two cells when the line is fitted', () => {
    const segs: Segment[] = [
      { id: '5h', prio: 100, forms: ['5h 28%', '5h 28%', '5h 28%'] },
      { id: 'git', prio: 20, forms: ['功能/認證分支', '功能/認證分支', '功能/認證分支'] },
    ]
    const wide = line(200, segs)
    expect(wide).toBe('5h 28% │ 功能/認證分支')
    expect(displayWidth(wide)).toBe(22)
    expect(line(21, segs)).toBe('5h 28%')
    expect(line(22, segs)).toBe(wide)
  })

  test('where ambiguous characters are two cells the separators count double', () => {
    const segs: Segment[] = [
      { id: 'a', prio: 2, forms: ['aaaaaaaaaa', 'aaaaaaaaaa', 'aaaaaaaaaa'] },
      { id: 'b', prio: 1, forms: ['bbbbbbbbbb', 'bbbbbbbbbb', 'bbbbbbbbbb'] },
    ]
    expect(line(23, segs)).toBe('aaaaaaaaaa │ bbbbbbbbbb')
    expect(line(23, segs, { ambiguous: 2 })).toBe('aaaaaaaaaa')
    expect(line(25, segs, { ambiguous: 2 })).toBe('aaaaaaaaaa │ bbbbbbbbbb')
  })

  test('bold styling adds no width and never changes what is dropped', () => {
    const plain = line(100)
    const styled = line(100, SEGMENTS, { color: true })
    expect(styled.startsWith('\x1b[1mSonnet 5.5\x1b[22m')).toBe(true)
    expect(stripAnsi(styled)).toBe(plain)
    expect(displayWidth(styled)).toBe(displayWidth(plain))
  })

  test('ANSI inside a segment is not counted and does not break the fit', () => {
    const segs: Segment[] = [
      { id: 'a', prio: 2, forms: ['\x1b[31mred\x1b[0m', '\x1b[31mred\x1b[0m', '\x1b[31mred\x1b[0m'] },
      { id: 'b', prio: 1, forms: ['blue', 'blue', 'blue'] },
    ]
    expect(displayWidth(line(10, segs))).toBeLessThanOrEqual(10)
    expect(stripAnsi(line(10, segs))).toBe('red │ blue')
  })

  test('no segments gives an empty line', () => {
    expect(line(100, [])).toBe('')
  })

  test('the layout is deterministic across a resize back and forth', () => {
    const wide = line(160)
    line(60)
    line(100)
    expect(line(160)).toBe(wide)
  })
})
