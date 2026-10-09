import { describe, expect, test } from 'claude-code/testing'

import { displayWidth } from '../../shared/hudline.ts'
import { padCells, wrapCells } from '../../hooks/ui/text.ts'
import { dividerText, progressBar, statusOf } from '../../hooks/ui/theme.ts'

describe('width-aware text helpers', () => {
  test('pad counts cells, so a CJK name still lines up', () => {
    expect(displayWidth(padCells('工人', 8))).toBe(8)
    expect(displayWidth(padCells('a-very-long-worker-name', 8))).toBe(8)
  })

  test('wrap never exceeds the width and never drops a word', () => {
    const lines = wrapCells('set the 工作者 cap to six and confirm it here', 12)
    for (const l of lines) expect(displayWidth(l)).toBeLessThanOrEqual(12)
    expect(lines.join(' ')).toBe('set the 工作者 cap to six and confirm it here')
  })

  test('ambiguous width 2 doubles the ambiguous block glyphs only: █ and ▓ are ambiguous, ░ is narrow', () => {
    expect(displayWidth('█░')).toBe(2)
    expect(displayWidth('█░', 2)).toBe(3)
    expect(displayWidth('▓', 2)).toBe(2)
    expect(displayWidth('░', 2)).toBe(1)
    // A bar's measured width follows: 3 filled (ambiguous) + 7 empty (narrow) + brackets and the figure.
    expect(displayWidth(progressBar(30).text, 2)).toBe(displayWidth(progressBar(30).text) + 3)
  })
})

describe('progress bar and status', () => {
  test('an unobserved value is a muted dash bar, not 0%', () => {
    expect(progressBar(null)).toEqual({ text: '[──────────] –', color: 'inactive' })
    expect(progressBar(0).text).toBe('[░░░░░░░░░░] 0%')
    expect(progressBar(13).text).toBe('[█░░░░░░░░░] 13%')
  })

  test('an unknown status word is pending, never done', () => {
    expect(statusOf('mystery')).toBe('pending')
    expect(statusOf('in_progress')).toBe('running')
  })

  test('divider fills the width', () => {
    expect(dividerText(20, 'TASKS')).toHaveLength(20)
  })
})
