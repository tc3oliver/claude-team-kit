import { describe, expect, test } from 'claude-code/testing'

import { displayWidth } from '../../shared/hudline.ts'
import type { TaskRow } from '../../hooks/mission.ts'
import { layoutDag } from '../../hooks/ui/dag.ts'

type Spec = [id: string, by: string[], status?: TaskRow['status']]

// Rows as taskRows builds them: blockedBy and blocks are both filled from either declaration.
const rows = (specs: Spec[], title = ''): TaskRow[] =>
  specs.map(([id, by, status = 'pending']) => {
    const open = by.filter(b => specs.find(s => s[0] === b)?.[2] !== 'completed')
    return {
      id,
      subject: title === '' ? '' : `${title} ${id}`,
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

const SHOWCASE: Spec[] = [['1', [], 'completed'], ['2', [], 'completed'], ['3', [], 'in_progress'], ['4', [], 'in_progress'], ['5', ['3']], ['6', ['3', '4']], ['7', ['5', '6']]]

describe('layoutDag', () => {
  test('chain: one row', () => {
    expect(draw([['1', [], 'completed'], ['2', ['1'], 'in_progress'], ['3', ['2']]])).toEqual(['[✓ 1]──▸[● 2]──▸[○ 3]'])
  })

  test('diamond: fan-out then fan-in', () => {
    expect(draw([['1', []], ['2', ['1']], ['3', ['1']], ['4', ['2', '3']]])).toEqual(['[◇ 1]─┬▸[○ 2]─┬▸[○ 4]', '      └▸[○ 3]─┘'])
  })

  test('fan-in: two parents join one child', () => {
    expect(draw([['1', []], ['2', []], ['3', ['1', '2']]])).toEqual(['[◇ 1]─┬▸[○ 3]', '[◇ 2]─┘'])
  })

  test('fan-out: one parent, three children', () => {
    expect(draw([['1', []], ['2', ['1']], ['3', ['1']], ['4', ['1']]])).toEqual(['[◇ 1]─┬▸[○ 2]', '      ├▸[○ 3]', '      └▸[○ 4]'])
  })

  test('the showcase board draws, leaving the unlinked done tasks to the list', () => {
    const d = draw(SHOWCASE)!
    expect(d).toHaveLength(2)
    expect(d.join('\n')).toContain('[● 3]')
    expect(d.join('\n')).toContain('[○ 7]')
    expect(d.join('\n')).not.toContain('[✓')
    expect(d).toEqual(['[● 3]─┬▸[○ 5]─┬▸[○ 7]', '[● 4]─┴▸[○ 6]─┘'])
  })

  test('a skip edge is routed through a free lane, not dropped', () => {
    const d = draw([['1', []], ['2', ['1']], ['3', ['1', '2']]])!
    expect(d).toHaveLength(2)
    expect(d[0]).toContain('[◇ 1]')
    expect(d[0]).toContain('[○ 2]')
    expect(d[0]).toContain('[○ 3]')
    // the lane under 2 carries the 1 -> 3 edge: a bare line, no node
    expect(d[1]).toMatch(/^ +└─+┘?|^ +└/)
    expect(d[1]).not.toContain('[')
  })

  test('crossing edges are drawn with a cross', () => {
    const d = draw([['1', []], ['2', []], ['3', ['2']], ['4', ['1']], ['5', ['3', '4']]], 80, 6)!
    expect(d.join('\n')).toMatch(/[┼]|[┬┴]/)
  })

  test('ready uses the ready glyph, running the running glyph', () => {
    expect(draw([['1', [], 'completed'], ['2', ['1']]])).toEqual(['[✓ 1]──▸[◇ 2]'])
  })

  test('cycle: null, and it terminates', () => {
    expect(draw([['1', ['2']], ['2', ['1']]])).toBeNull()
    expect(draw([['1', ['1']]])).toBeNull()
  })

  test('missing id: the undeclared-on-board edge is not drawn, nothing is invented', () => {
    expect(draw([['1', ['9']], ['2', ['1']]])).toEqual(['[○ 1]──▸[○ 2]'])
    expect(draw([['1', ['9']]])).toBeNull()
  })

  test('two separate chains do not get joined', () => {
    expect(draw([['1', []], ['2', ['1']], ['3', []], ['4', ['3']]])).toEqual(['[◇ 1]──▸[○ 2]', '[◇ 3]──▸[○ 4]'])
  })

  test('12 linked tasks draw; 13 fall back to the list', () => {
    const chain = (n: number) => Array.from({ length: n }, (_, i): Spec => [String(i + 1), i === 0 ? [] : [String(i)]])
    expect(draw(chain(12), 200)).not.toBeNull()
    expect(draw(chain(13), 200)).toBeNull()
  })

  test('rows: more than maxRows is null', () => {
    const wide = Array.from({ length: 8 }, (_, i): Spec => [String(i + 1), i === 0 ? [] : ['1']])
    expect(draw(wide, 200, 4)).toBeNull()
    expect(draw(wide, 200, 8)).toHaveLength(7)
  })

  test('long ids are shortened to fit the node', () => {
    const d = draw([['abcdefgh', []], ['2', ['abcdefgh']]])!
    expect(d[0]).toContain('[◇ abc…]')
  })

  test('titles appear when the width allows and every line stays inside it', () => {
    const specs = SHOWCASE
    for (const width of [58, 98]) {
      const d = layoutDag(rows(specs, 'task'), { width, maxRows: 6 })
      if (d === null) continue
      for (const l of d.lines) expect(displayWidth(l.map(s => s.text).join(''))).toBeLessThanOrEqual(width)
    }
    const wide = layoutDag(rows(specs, 'task'), { width: 98, maxRows: 6 })!
    expect(wide.lines.flat().some(s => s.title && s.text.includes('task 3'))).toBe(true)
    const narrow = layoutDag(rows(specs, 'task'), { width: 38, maxRows: 6 })
    expect(narrow === null || narrow.lines.flat().every(s => !s.title)).toBe(true)
  })

  test('width: a narrow room draws nothing', () => {
    expect(draw([['1', []], ['2', ['1']]], 10)).toBeNull()
  })

  test('deterministic: the same board draws the same', () => {
    expect(draw(SHOWCASE)).toEqual(draw([...SHOWCASE]))
  })
})
