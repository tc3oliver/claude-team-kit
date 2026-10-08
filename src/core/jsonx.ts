// JSON helpers keyed by RFC 6901 pointers ("/team/maxWorkers"). A pointer is one
// stable string per leaf, which the ledger, the profile merge and conflict reports share.

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json }
export type JsonObject = { [k: string]: Json }

export const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v)

const esc = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1')
const unesc = (s: string) => s.replace(/~1/g, '/').replace(/~0/g, '~')

export const toPointer = (segs: string[]): string => segs.map(s => `/${esc(s)}`).join('')
export const fromPointer = (ptr: string): string[] => (ptr === '' ? [] : ptr.slice(1).split('/').map(unesc))

export const deepEqual = (a: unknown, b: unknown): boolean => JSON.stringify(canon(a)) === JSON.stringify(canon(b))

/** Key-sorted copy, so equality ignores object key order. */
export const canon = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(canon)
  if (isObject(v)) return Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])]))
  return v
}

export const pointerGet = (root: unknown, ptr: string): Json | undefined => {
  let cur: unknown = root
  for (const seg of fromPointer(ptr)) {
    if (!isObject(cur) || !Object.hasOwn(cur, seg)) return undefined
    cur = cur[seg]
  }
  return cur as Json
}

/** Set a value, creating intermediate objects. Refuses to descend through a non-object. */
export const pointerSet = (root: JsonObject, ptr: string, value: Json): void => {
  const segs = fromPointer(ptr)
  if (segs.length === 0) throw new Error('cannot set the document root')
  let cur: JsonObject = root
  for (const seg of segs.slice(0, -1)) {
    const next = Object.hasOwn(cur, seg) ? cur[seg] : undefined
    if (next === undefined) {
      const created: JsonObject = {}
      cur[seg] = created
      cur = created
    } else if (isObject(next)) cur = next
    else throw new Error(`cannot set ${ptr}: ${seg} is not an object`)
  }
  cur[segs[segs.length - 1] as string] = value
}

/** Delete a leaf and any parent objects it leaves empty. Returns whether something was removed. */
export const pointerDelete = (root: JsonObject, ptr: string): boolean => {
  const segs = fromPointer(ptr)
  const trail: JsonObject[] = [root]
  let cur: JsonObject = root
  for (const seg of segs.slice(0, -1)) {
    const next = Object.hasOwn(cur, seg) ? cur[seg] : undefined
    if (!isObject(next)) return false
    cur = next
    trail.push(cur)
  }
  const last = segs[segs.length - 1] as string
  if (!Object.hasOwn(cur, last)) return false
  delete cur[last]
  for (let i = trail.length - 1; i > 0; i--) {
    if (Object.keys(trail[i] as JsonObject).length > 0) break
    delete (trail[i - 1] as JsonObject)[segs[i - 1] as string]
  }
  return true
}

/** Leaves of an object as pointer -> value. Arrays and scalars are leaves; empty objects are leaves too. */
export const flatten = (v: unknown, prefix: string[] = [], out: Record<string, Json> = {}): Record<string, Json> => {
  if (isObject(v) && Object.keys(v).length > 0) {
    for (const k of Object.keys(v).sort()) flatten(v[k], [...prefix, k], out)
  } else if (prefix.length > 0) out[toPointer(prefix)] = v as Json
  return out
}

export const unflatten = (flat: Record<string, Json>): JsonObject => {
  const out: JsonObject = {}
  for (const ptr of Object.keys(flat).sort()) pointerSet(out, ptr, flat[ptr] as Json)
  return out
}

/** Right-biased deep merge of plain objects; arrays and scalars replace. Inputs are not mutated. */
export const deepMerge = (...layers: Array<JsonObject | null | undefined>): JsonObject => {
  const out: JsonObject = {}
  for (const layer of layers) {
    if (!layer) continue
    for (const [k, v] of Object.entries(layer)) {
      const cur = out[k]
      out[k] = isObject(v) && isObject(cur) ? deepMerge(cur, v) : (structuredClone(v) as Json)
    }
  }
  return out
}
