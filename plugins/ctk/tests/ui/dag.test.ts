import { describe, expect, test } from 'claude-code/testing'

import { displayWidth } from '../../shared/hudline.ts'
import type { TaskRow } from '../../hooks/mission.ts'
import { layoutDag } from '../../hooks/ui/dag.ts'

type Spec = [id: string, by: string[], status?: TaskRow['status']]

// Rows as taskRows builds them: blockedBy and blocks are both filled from either declaration.
const rows = (specs: Spec[]): TaskRow[] =>
  specs.map(([id, by, status = 'pending']) => {
    const open = by.filter(b => specs.find(s => s[0] === b)?.[2] !== 'completed')
    return {
      id,
      subject: `task ${id}`,
      status,
      owner: null,
      blockedBy: by,
      blocks: specs.filter(s => s[1].includes(id)).map(s => s[0]),
      openBlockers: open,
      ready: status === 'pending' && open.length === 0,
      blocked: (status === 'pending' || status === 'in_progress') && open.length > 0,
      seenByUpdateOnly: false,
    }
  })

const draw = (specs: Spec[], width = 80, maxRows = 6): string[] | null => {
  const d = layoutDag(rows(specs), { width, maxRows })
  return d === null ? null : d.lines.map(l => l.map(s => s.text).join('').trimEnd())
}

describe('layoutDag', () => {
  test('chain: one row', () => {
    expect(draw([['1', [], 'completed'], ['2', ['1'], 'in_progress'], ['3', ['2']]])).toEqual(['[✓ 1]───[● 2]───[○ 3]'])
  })

  test('diamond: fan-out then fan-in', () => {
    expect(draw([['1', []], ['2', ['1']], ['3', ['1']], ['4', ['2', '3']]])).toEqual(['[◇ 1]─┬─[○ 2]─┬─[○ 4]', '      └─[○ 3]─┘'])
  })

  test('fan-in: two parents join one child', () => {
    expect(draw([['1', []], ['2', []], ['3', ['1', '2']]])).toEqual(['[◇ 1]─┬─[○ 3]', '[◇ 2]─┘'])
  })

  test('fan-out: one parent, three children', () => {
    expect(draw([['1', []], ['2', ['1']], ['3', ['1']], ['4', ['1']]])).toEqual(['[◇ 1]─┬─[○ 2]', '      ├─[○ 3]', '      └─[○ 4]'])
  })

  test('ready uses the ready glyph', () => {
    expect(draw([['1', [], 'completed'], ['2', ['1']]])).toEqual(['[✓ 1]───[◇ 2]'])
  })

  test('cycle: null, and it terminates', () => {
    expect(draw([['1', ['2']], ['2', ['1']]])).toBeNull()
    expect(draw([['1', ['1']]])).toBeNull()
  })

  test('missing id: the undeclared-on-board edge is not drawn, nothing is invented', () => {
    expect(draw([['1', ['9']], ['2', ['1']]])).toEqual(['[○ 1]───[○ 2]'])
    expect(draw([['1', ['9']]])).toBeNull()
  })

  test('an edge that skips a column cannot be drawn faithfully: null', () => {
    expect(draw([['1', []], ['2', ['1']], ['3', ['1', '2']]])).toBeNull()
  })

  test('two separate chains do not get joined', () => {
    expect(draw([['1', []], ['2', ['1']], ['3', []], ['4', ['3']]])).toEqual(['[◇ 1]───[○ 2]', '[◇ 3]───[○ 4]'])
  })

  test('40 tasks: bounded by rows and width, never throws', () => {
    const chain = Array.from({ length: 40 }, (_, i): Spec => [String(i + 1), i === 0 ? [] : [String(i)]])
    expect(draw(chain)).toBeNull()
    const wide = Array.from({ length: 40 }, (_, i): Spec => [String(i + 1), i === 0 ? [] : ['1']])
    expect(draw(wide, 200, 4)).toBeNull()
    const d = draw(wide, 200, 40)!
    expect(d).toHaveLength(39)
    for (const l of d) expect(displayWidth(l)).toBeLessThanOrEqual(200)
  })

  test('width: a narrow room draws nothing', () => {
    expect(draw([['1', []], ['2', ['1']]], 10)).toBeNull()
  })
})
