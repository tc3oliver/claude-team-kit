// Pure three-way merge over flattened maps (profile pointers "/team/maxWorkers",
// skill files "skills/<name>/<relpath>" -> content hash). A key missing from a map is absent.

import { deepEqual, type Json } from '../core/jsonx.ts'

export type Flat = Record<string, Json>
export type Conflict = { key: string; base?: Json; ours?: Json; theirs?: Json }
export type MergeResult = {
  merged: Flat
  conflicts: Conflict[]
  /** Keys whose merged value is the other side's and differs from ours: what to change locally. */
  applied: string[]
}

const has = (m: Flat, k: string) => Object.hasOwn(m, k)
const same = (a: Flat, b: Flat, k: string) => (has(a, k) ? has(b, k) && deepEqual(a[k], b[k]) : !has(b, k))

export const merge3 = (base: Flat, ours: Flat, theirs: Flat): MergeResult => {
  const merged: Flat = {}
  const conflicts: Conflict[] = []
  const applied: string[] = []
  const keys = [...new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])].sort()
  for (const k of keys) {
    let from: Flat
    if (same(ours, theirs, k)) from = ours
    else if (same(ours, base, k)) {
      from = theirs
      applied.push(k)
    } else if (same(theirs, base, k)) from = ours
    else {
      from = ours
      const c: Conflict = { key: k }
      if (has(base, k)) c.base = base[k]
      if (has(ours, k)) c.ours = ours[k]
      if (has(theirs, k)) c.theirs = theirs[k]
      conflicts.push(c)
    }
    if (has(from, k)) merged[k] = from[k] as Json
  }
  return { merged, conflicts, applied }
}
