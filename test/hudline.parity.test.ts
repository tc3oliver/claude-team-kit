import assert from 'node:assert/strict'
import { test } from 'node:test'

import * as mjs from '../plugins/ctk/statusline/ctk-statusline.mjs'
import * as ts from '../plugins/ctk/shared/hudline.ts'

// The status line script is installed as one file, so it carries its own copy of the layout code
// that the Mods band imports from shared/hudline.ts. This runs both over the same pseudo-random
// inputs: any edit made to only one of them fails here.

let seed = 20261009
const rand = (n: number): number => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed % n
}
const pick = <T>(xs: readonly T[]): T => xs[rand(xs.length)] as T

const WORDS = [
  '', 'a', '5h 28% (2h34m)', '5h 28% 2h34m', 'Wk 51%', 'T153', 'Tools 153', 'Ctx 42%', 'Sonnet 5.5', '$0.94 (12m)',
  '功能/認證分支', '千問三號', 'ｆｕｌｌ', '🚀 ship', 'école', 'a‍b', '\x1b[1mbold\x1b[22m', '\x1b[38;5;81mcolour\x1b[0m',
  '\x1b]8;;https://example.com\x07link\x1b]8;;\x07', '│·…×', 'x'.repeat(40), 'feat/very-long-branch-name-here*',
]

const randomSegments = (): ts.Segment[] =>
  Array.from({ length: 1 + rand(9) }, (_, i) => {
    const f = pick(WORDS)
    return {
      id: `s${i}`,
      prio: rand(120),
      missing: rand(5) === 0,
      bold: rand(3) === 0,
      forms: [pick(WORDS), rand(2) === 0 ? f : pick(WORDS), rand(3) === 0 ? '' : f] as const,
    }
  })

test('layout: both copies draw the same line for 5000 random inputs', () => {
  for (let i = 0; i < 5000; i++) {
    const segments = randomSegments()
    const opts = {
      columns: rand(6) === 0 ? pick([Number.NaN, 0, -4, 80.7]) : 1 + rand(260),
      ambiguous: pick([1, 2] as const),
      color: rand(2) === 0,
      ...(rand(3) === 0 ? { tierColumns: pick([Number.NaN, 0, 60, 79, 80, 119, 120, 300]) } : {}),
    }
    assert.equal(mjs.layoutLine(segments, opts), ts.layoutLine(segments, opts), JSON.stringify({ segments, opts }))
  }
})

test('width and truncation agree on every sample string', () => {
  for (const w of WORDS) {
    for (const amb of [1, 2] as const) {
      assert.equal(mjs.displayWidth(w, amb), ts.displayWidth(w, amb), w)
      for (const max of [0, 1, 2, 3, 5, 8, 13, 40]) assert.equal(mjs.truncateToWidth(w, max, amb), ts.truncateToWidth(w, max, amb), `${w} ${max}`)
    }
    assert.equal(mjs.stripAnsi(w), ts.stripAnsi(w))
  }
  for (let cp = 0; cp < 0x30000; cp += 7) assert.equal(mjs.charWidth(cp, 2), ts.charWidth(cp, 2), String(cp))
})

test('countdown, reset time and percentage agree', () => {
  const now = Date.UTC(2026, 9, 9, 3)
  for (let i = 0; i < 2000; i++) {
    const at = now + (rand(9 * 86_400_000) - 86_400_000)
    assert.equal(mjs.fmtCountdown(at, now), ts.fmtCountdown(at, now))
  }
  for (const v of [null, undefined, '', 'soon', 0, -1, 1.79e9, 1.79e12, '2026-10-09T05:34:00Z', '2026-10-09T13:34:00+08:00', Number.NaN, {}, true]) {
    assert.equal(mjs.resetMs(v), ts.resetMs(v), String(v))
  }
  for (const v of [null, undefined, Number.NaN, -1, 0, 0.4, 28.5, 100, 140.2, Number.POSITIVE_INFINITY]) {
    assert.equal(mjs.fmtPct(v as never), ts.fmtPct(v as never), String(v))
  }
})

test('usage segments agree, including stale and missing windows', () => {
  const now = Date.UTC(2026, 9, 9, 3)
  for (const pct of [null, 0, 28.4, 100]) {
    for (const resetsAtMs of [null, now - 1, now + 30_000, now + 3 * 86_400_000]) {
      assert.deepEqual(mjs.usageSegment('5h', '5h', 100, { pct, resetsAtMs }, now), ts.usageSegment('5h', '5h', 100, { pct, resetsAtMs }, now))
    }
  }
})

test('tier thresholds agree', () => {
  for (let c = 1; c <= 300; c++) assert.equal(mjs.tierOf(c), ts.tierOf(c))
  assert.equal(mjs.SEP, ts.SEP)
  assert.equal(mjs.DASH, ts.DASH)
})
