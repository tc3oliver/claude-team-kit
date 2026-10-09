import { displayWidth } from '../../shared/hudline.ts'
import type { TaskRow } from '../mission.ts'
import { GLYPH } from './theme.ts'
import type { Status } from './theme.ts'

// A mini dependency graph drawn only from the edges the model declared (blockedBy / blocks).
// Pure and deterministic. It returns null whenever it cannot draw every edge faithfully, so a
// caller falls back to the plain list instead of showing a link that was never declared.

export type Seg = { text: string; status?: Status }

export type Dag = { lines: Seg[][] }

/** The glyph status of a task row: ready and blocked are the board's own derived flags. */
export const taskStatus = (t: TaskRow): Status =>
  t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'running' : t.ready ? 'ready' : 'pending'

const ID_MAX = 4
const GUTTER = 3

const trunk = (up: boolean, down: boolean, l: boolean, r: boolean): string => {
  if (up && down) return l && r ? '┼' : r ? '├' : l ? '┤' : '│'
  if (down) return l && r ? '┬' : r ? '┌' : l ? '┐' : '│'
  if (up) return l && r ? '┴' : r ? '└' : l ? '┘' : '│'
  return l || r ? '─' : ' '
}

/**
 * Lays tasks out in columns by longest dependency path. Null when: there is no edge, a cycle exists,
 * an edge skips a column, one link would be ambiguous (a trunk that is not fully connected, or two
 * trunks that overlap), an id is wider than 4 cells, or it needs more than `maxRows` rows or `width` cells.
 */
export const layoutDag = (tasks: TaskRow[], opts: { width: number; maxRows: number; ambiguous?: 1 | 2 }): Dag | null => {
  const amb = opts.ambiguous ?? 1
  const ids = new Set(tasks.map(t => t.id))
  // An id the board has not seen has no node: its edge is not drawn.
  const parents = new Map(tasks.map(t => [t.id, t.blockedBy.filter(b => ids.has(b))]))
  const edges = [...parents].reduce((n, [, p]) => n + p.length, 0)
  if (edges === 0 || tasks.some(t => displayWidth(t.id, amb) > ID_MAX)) return null

  const layer = new Map<string, number>()
  let left = tasks.length
  for (let progress = true; progress && left > 0; ) {
    progress = false
    for (const t of tasks) {
      const ps = parents.get(t.id)!
      if (layer.has(t.id) || !ps.every(p => layer.has(p))) continue
      layer.set(t.id, ps.length === 0 ? 0 : Math.max(...ps.map(p => layer.get(p)!)) + 1)
      left--
      progress = true
    }
  }
  if (left > 0) return null // cycle (a self-edge too)
  for (const t of tasks) if (parents.get(t.id)!.some(p => layer.get(t.id)! - layer.get(p)! !== 1)) return null

  const layers = Math.max(...layer.values()) + 1
  const idw = Math.max(...tasks.map(t => displayWidth(t.id, amb)))
  const nodeW = idw + 4 // `[✓ 03]`
  if (layers * nodeW + (layers - 1) * GUTTER > opts.width) return null

  // Rows: a column starts at its parents' mean row and moves down past rows already taken.
  const rowOf = new Map<string, number>()
  const taken: Set<number>[] = Array.from({ length: layers }, () => new Set())
  for (let l = 0; l < layers; l++) {
    for (const t of tasks.filter(x => layer.get(x.id) === l)) {
      const ps = parents.get(t.id)!
      let r = ps.length === 0 ? 0 : Math.floor(ps.reduce((s, p) => s + rowOf.get(p)!, 0) / ps.length)
      while (taken[l]!.has(r)) r++
      taken[l]!.add(r)
      rowOf.set(t.id, r)
    }
  }
  const rowCount = Math.max(...rowOf.values()) + 1
  if (rowCount > opts.maxRows) return null

  // Each gutter: group edges into trunks (connected parents + children); a trunk must be fully
  // connected and trunks must not share a row, or the drawing would imply links nobody declared.
  const gutters: string[][] = []
  for (let l = 0; l < layers - 1; l++) {
    const group = new Map<string, string>()
    const find = (x: string): string => (group.get(x) === x ? x : (group.set(x, find(group.get(x)!)), group.get(x)!))
    const es = tasks.filter(t => layer.get(t.id) === l + 1).flatMap(t => parents.get(t.id)!.map(p => [p, t.id] as const))
    for (const [p, c] of es) {
      for (const n of [p, c]) if (!group.has(n)) group.set(n, n)
      group.set(find(p), find(c))
    }
    const trunks = new Map<string, { p: Set<number>; c: Set<number>; n: number }>()
    for (const [p, c] of es) {
      const g = trunks.get(find(p)) ?? { p: new Set(), c: new Set(), n: 0 }
      g.p.add(rowOf.get(p)!)
      g.c.add(rowOf.get(c)!)
      g.n++
      trunks.set(find(p), g)
    }
    const used = new Set<number>()
    const col = Array.from({ length: rowCount }, () => '   ')
    for (const g of trunks.values()) {
      if (g.n !== g.p.size * g.c.size) return null
      const rows = [...g.p, ...g.c]
      const lo = Math.min(...rows)
      const hi = Math.max(...rows)
      for (let r = lo; r <= hi; r++) {
        if (used.has(r)) return null
        used.add(r)
        const lft = g.p.has(r)
        const rgt = g.c.has(r)
        col[r] = `${lft ? '─' : ' '}${trunk(r > lo, r < hi, lft, rgt)}${rgt ? '─' : ' '}`
      }
    }
    gutters.push(col)
  }

  const at = (l: number, r: number): TaskRow | undefined => tasks.find(t => layer.get(t.id) === l && rowOf.get(t.id) === r)
  const lines: Seg[][] = []
  for (let r = 0; r < rowCount; r++) {
    const segs: Seg[] = []
    for (let l = 0; l < layers; l++) {
      const t = at(l, r)
      if (t === undefined) segs.push({ text: ' '.repeat(nodeW) })
      else {
        const st = taskStatus(t)
        segs.push({ text: `[${GLYPH[st]} ${t.id.padStart(idw)}]`, status: st })
      }
      if (l < layers - 1) segs.push({ text: gutters[l]![r]! })
    }
    while (segs.length > 0 && segs[segs.length - 1]!.status === undefined && segs[segs.length - 1]!.text.trim() === '') segs.pop()
    lines.push(segs)
  }
  return { lines }
}
