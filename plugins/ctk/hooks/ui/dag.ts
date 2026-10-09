import { displayWidth, truncateToWidth } from '../../shared/hudline.ts'
import type { TaskRow } from '../mission.ts'
import { padCells } from './text.ts'
import { GLYPH } from './theme.ts'
import type { Status } from './theme.ts'

// A layered dependency graph drawn only from the edges the model declared (blockedBy). Pure and
// deterministic: column = longest declared path, row = barycenter of the parents with the id as the
// tie-break, edges routed in the gaps between columns. It returns null whenever it cannot draw the
// board faithfully, so a caller falls back to the plain list instead of showing an undeclared link.

export type Seg = { text: string; status?: Status; title?: boolean }

export type Dag = { lines: Seg[][] }

/** The glyph status of a task row: ready and blocked are the board's own derived flags. */
export const taskStatus = (t: TaskRow): Status =>
  t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'running' : t.ready ? 'ready' : 'pending'

const ID_MAX = 4
const MAX_NODES = 12
const MAX_TRACKS = 3
const TITLE_TRIES = [14, 10, 6, 0]

const nat = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true })

const U = 1
const D = 2
const L = 4
const R = 8
// Index = U | D | L | R bits. A lone stub is drawn as the line it belongs to.
const CHAR = [' ', '│', '│', '│', '─', '┘', '┐', '┤', '─', '└', '┌', '├', '─', '┴', '┬', '┼']

type Node = { id: string; layer: number; row: number; task?: TaskRow; parents: string[] }
type Group = { p: Node; kids: Node[]; lo: number; hi: number; track: number }

/**
 * Gives each group with a vertical run a track (0..k-1) so that runs on one track never overlap and a
 * parent's horizontal never runs into a child of another group on its own row. Null when k tracks do not suffice.
 */
const assignTracks = (gs: Group[], k: number, apart: [Group, Group][]): boolean => {
  const go = (i: number): boolean => {
    if (i === gs.length) return true
    const g = gs[i]!
    for (let t = 0; t < k; t++) {
      g.track = t
      const clash = gs.slice(0, i).some(o => o.track === t && o.lo <= g.hi && g.lo <= o.hi)
      const order = apart.some(([a, b]) => (a === g && gs.indexOf(b) < i && !(t < b.track)) || (b === g && gs.indexOf(a) < i && !(a.track < t)))
      if (!clash && !order && go(i + 1)) return true
    }
    return false
  }
  return go(0)
}

/**
 * Lays tasks out as a layered graph. Tasks with no declared edge are left out (the list shows them).
 * Null when: there is no edge, a cycle exists, more than 12 tasks are linked, the routing needs more
 * than 3 tracks in one gap, or the drawing needs more than `maxRows` rows or `width` cells.
 */
export const layoutDag = (tasks: TaskRow[], opts: { width: number; maxRows: number; ambiguous?: 1 | 2 }): Dag | null => {
  const amb = opts.ambiguous ?? 1
  const ids = new Set(tasks.map(t => t.id))
  // An id the board has not seen has no node: its edge is not drawn.
  const parentsOf = new Map(tasks.map(t => [t.id, [...new Set(t.blockedBy.filter(b => ids.has(b)))]]))
  const linked = new Set<string>()
  for (const [c, ps] of parentsOf) {
    if (ps.length > 0) linked.add(c)
    for (const p of ps) linked.add(p)
  }
  if (linked.size === 0 || linked.size > MAX_NODES) return null

  const layer = new Map<string, number>()
  let left = tasks.length
  for (let progress = true; progress && left > 0; ) {
    progress = false
    for (const t of tasks) {
      const ps = parentsOf.get(t.id)!
      if (layer.has(t.id) || !ps.every(p => layer.has(p))) continue
      layer.set(t.id, ps.length === 0 ? 0 : Math.max(...ps.map(p => layer.get(p)!)) + 1)
      left--
      progress = true
    }
  }
  if (left > 0) return null // cycle (a self-edge too)

  // Real nodes, plus one pass-through node per parent and column for an edge that spans columns.
  const nodes = new Map<string, Node>()
  for (const t of tasks) if (linked.has(t.id)) nodes.set(t.id, { id: t.id, layer: layer.get(t.id)!, row: 0, task: t, parents: [] })
  const through = (p: string, l: number): string => `${p}\0${l}`
  for (const c of [...nodes.values()].filter(n => n.layer > 0)) {
    for (const p of parentsOf.get(c.id)!) {
      const pl = layer.get(p)!
      for (let l = pl + 1; l < c.layer; l++) if (!nodes.has(through(p, l))) nodes.set(through(p, l), { id: through(p, l), layer: l, row: 0, parents: [l === pl + 1 ? p : through(p, l - 1)] })
      c.parents.push(c.layer - pl === 1 ? p : through(p, c.layer - 1))
    }
  }
  const layers = Math.max(...[...nodes.values()].map(n => n.layer)) + 1

  // Rows: sources by id; later columns by the mean row of their parents, never two on one row.
  const cols: Node[][] = Array.from({ length: layers }, (_, l) => [...nodes.values()].filter(n => n.layer === l))
  cols[0]!.sort((a, b) => nat(a.id, b.id))
  cols[0]!.forEach((n, i) => (n.row = i))
  for (let l = 1; l < layers; l++) {
    const bary = (n: Node): number => Math.floor(n.parents.reduce((s, p) => s + nodes.get(p)!.row, 0) / n.parents.length)
    cols[l]!.sort((a, b) => bary(a) - bary(b) || Number(a.task === undefined) - Number(b.task === undefined) || nat(a.id, b.id))
    let prev = -1
    for (const n of cols[l]!) prev = n.row = Math.max(bary(n), prev + 1)
  }
  const rowCount = Math.max(...[...nodes.values()].map(n => n.row)) + 1
  if (rowCount > opts.maxRows) return null

  // Gaps: one group per parent (its children share a trunk), then tracks.
  const gaps: { groups: Group[]; width: number }[] = []
  const incoming = new Map<string, Group[]>()
  for (let l = 0; l < layers - 1; l++) {
    const groups: Group[] = []
    for (const p of cols[l]!) {
      const kids = cols[l + 1]!.filter(c => c.parents.includes(p.id))
      if (kids.length === 0) continue
      const rs = [p.row, ...kids.map(k => k.row)]
      const g: Group = { p, kids, lo: Math.min(...rs), hi: Math.max(...rs), track: -1 }
      groups.push(g)
      for (const k of kids) incoming.set(k.id, [...(incoming.get(k.id) ?? []), g])
    }
    const bent = groups.filter(g => g.lo < g.hi)
    const apart: [Group, Group][] = []
    for (const g of bent) {
      const c = cols[l + 1]!.find(k => k.row === g.p.row)
      for (const o of c === undefined ? [] : incoming.get(c.id)!) if (o !== g && !g.kids.includes(c!) && o.lo < o.hi) apart.push([g, o])
    }
    let k = bent.length === 0 ? 0 : 1
    while (k <= MAX_TRACKS && !assignTracks(bent, k, apart)) k++
    if (k > MAX_TRACKS) return null
    gaps.push({ groups, width: Math.max(k, 1) + 2 })
  }

  const gapText = gaps.map(({ groups, width }) => {
    const cell = Array.from({ length: rowCount }, () => new Array<number>(width).fill(0))
    const line = (r: number, from: number, to: number) => {
      for (let i = from; i < to; i++) cell[r]![i]! |= L | R
    }
    for (const g of groups) {
      if (g.lo === g.hi) {
        line(g.lo, 0, width)
        continue
      }
      const x = 1 + g.track
      for (let r = g.lo; r <= g.hi; r++) cell[r]![x]! |= (r > g.lo ? U : 0) | (r < g.hi ? D : 0)
      line(g.p.row, 0, x)
      cell[g.p.row]![x]! |= L
      for (const k of g.kids) {
        line(k.row, x + 1, width)
        cell[k.row]![x]! |= R
      }
    }
    return cell.map(bits => bits.map(b => CHAR[b]!).join(''))
  })
  // The arrow goes on the last cell of a gap row that ends in a real task.
  gaps.forEach(({ groups, width }, l) => {
    for (const g of groups)
      for (const k of g.kids) {
        const s = gapText[l]![k.row]!
        if (k.task !== undefined && s[width - 1] === '─') gapText[l]![k.row] = `${s.slice(0, width - 1)}▸`
      }
  })

  const idw = Math.min(ID_MAX, Math.max(...[...nodes.values()].filter(n => n.task).map(n => displayWidth(n.id, amb))))
  const nodeW = idw + 4 // `[✓ 03]`
  const longest = Math.max(...[...nodes.values()].map(n => (n.task === undefined ? 0 : displayWidth(n.task.subject, amb))))
  for (const titleW of new Set(TITLE_TRIES.map(w => Math.min(w, longest)))) {
    const colW = nodeW + (titleW > 0 ? 1 + titleW : 0)
    const lines: Seg[][] = []
    for (let r = 0; r < rowCount; r++) {
      const segs: Seg[] = []
      for (let l = 0; l < layers; l++) {
        const n = cols[l]!.find(x => x.row === r)
        if (n === undefined) segs.push({ text: ' '.repeat(colW) })
        else if (n.task === undefined) segs.push({ text: '─'.repeat(colW) })
        else {
          const st = taskStatus(n.task)
          segs.push({ text: `[${GLYPH[st]} ${truncateToWidth(n.id, idw, amb).padStart(idw)}]`, status: st })
          if (titleW > 0) segs.push({ text: ` ${padCells(truncateToWidth(n.task.subject, titleW, amb), titleW, amb)}`, title: true })
        }
        if (l < layers - 1) segs.push({ text: gapText[l]![r]! })
      }
      while (segs.length > 0 && segs[segs.length - 1]!.status === undefined && segs[segs.length - 1]!.text.trim() === '') segs.pop()
      const last = segs[segs.length - 1]
      if (last !== undefined) last.text = last.text.trimEnd()
      lines.push(segs)
    }
    if (lines.every(l => displayWidth(l.map(s => s.text).join(''), amb) <= opts.width)) return { lines }
  }
  return null
}
