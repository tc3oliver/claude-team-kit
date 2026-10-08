import { deepEqual, flatten, fromPointer, isObject, pointerDelete, pointerGet, pointerSet, toPointer, type Json, type JsonObject } from '../../core/jsonx.ts'
import { loadDeviceLayer, loadUserLayer, saveDeviceLayer, saveUserLayer } from '../../core/profilestore.ts'
import { parseLayer, ProfileError, resolveEffective, type Profile, type ProfileLayer } from '../../core/schema.ts'
import { applyProfile } from '../../install/apply.ts'
import { EXIT, type Ctx } from '../context.ts'
import { failure, type Report } from '../report.ts'

export type ConfigFlags = { deviceLayer: boolean; noApply: boolean }

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])

/** "3" -> 3, "true" -> true, "haiku" -> "haiku". Quote to force a string: '"3"'. */
const parseValue = (raw: string): Json => {
  try {
    return JSON.parse(raw) as Json
  } catch {
    return raw
  }
}

/** get|set|list|unset on the user layer, or the device layer with --device-layer; set/unset re-apply the profile. */
export const runConfig = async (ctx: Ctx, args: string[], flags: ConfigFlags): Promise<Report> => {
  const [action, path, ...rest] = args
  const layerName = flags.deviceLayer ? `device layer (${ctx.device})` : 'user layer'
  const layer = (flags.deviceLayer ? loadDeviceLayer(ctx.paths, ctx.device) : loadUserLayer(ctx.paths)) ?? {}
  const doc = layer as JsonObject

  if (action === 'list') {
    const flat = flatten(doc)
    delete flat['/schemaVersion']
    const lines = Object.entries(flat).map(([p, v]) => `${fromPointer(p).join('.')} = ${JSON.stringify(v)}`)
    return { code: EXIT.ok, data: { layer: layerName, values: flat }, lines: lines.length ? lines : [`(${layerName} is empty; defaults apply)`] }
  }
  if (!['get', 'set', 'unset'].includes(action ?? '') || !path) return failure('usage: ctk config get|set|list|unset <dotted.path> [value] [--device-layer] [--no-apply]')
  const segs = path.split('.')
  if (segs.some(s => s === '' || FORBIDDEN.has(s))) return failure(`invalid path "${path}"`)
  const ptr = toPointer(segs)

  if (action === 'get') {
    const v = pointerGet(doc, ptr)
    if (v === undefined) return { code: EXIT.error, data: { path, set: false }, lines: [`${path} is not set in the ${layerName}`] }
    return { code: EXIT.ok, data: { path, value: v }, lines: [isObject(v) ? JSON.stringify(v) : typeof v === 'string' ? v : JSON.stringify(v)] }
  }

  const next = structuredClone(doc)
  if (action === 'set') {
    if (rest.length !== 1) return failure('usage: ctk config set <dotted.path> <value>')
    try {
      pointerSet(next, ptr, parseValue(rest[0] as string))
    } catch (e) {
      return failure(e instanceof Error ? e.message : String(e))
    }
  } else if (!pointerDelete(next, ptr)) {
    return { code: EXIT.ok, data: { path, changed: false }, lines: [`${path} was not set in the ${layerName}`] }
  }
  let checked: ProfileLayer
  let effective: Profile
  try {
    checked = parseLayer(next, path)
    // The combined profile must stay valid, not just this layer.
    effective = resolveEffective(flags.deviceLayer ? loadUserLayer(ctx.paths) : checked, flags.deviceLayer ? checked : loadDeviceLayer(ctx.paths, ctx.device))
  } catch (e) {
    if (e instanceof ProfileError) return failure(e.message)
    throw e
  }
  const changed = !deepEqual(doc, next)
  const lines = [changed ? `${ctx.dryRun ? 'would set' : 'updated'} ${path} in the ${layerName}` : `${path} already has that value in the ${layerName}`]
  const data: Record<string, unknown> = { path, changed, layer: layerName }
  if (changed && !ctx.dryRun) {
    if (flags.deviceLayer) saveDeviceLayer(ctx.paths, ctx.device, checked)
    else saveUserLayer(ctx.paths, checked)
  }
  if (flags.noApply) return { code: EXIT.ok, data, lines }
  const r = await applyProfile(ctx, effective, { op: 'config' })
  for (const s of r.skipped) lines.push(`  note: ${s}`)
  for (const c of r.conflicts) lines.push(`  conflict: ${c.pointer}: ${c.reason}`)
  return { code: r.conflicts.length > 0 ? EXIT.attention : EXIT.ok, data: { ...data, applied: r.changed, conflicts: r.conflicts, skipped: r.skipped }, lines }
}
