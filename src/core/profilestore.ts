import { existsSync } from 'node:fs'

import { readJsonIfExists, writeJsonAtomic } from './fsx.ts'
import type { CtkPaths } from './paths.ts'
import { parseLayer, resolveEffective, PROFILE_SCHEMA_VERSION, type Profile, type ProfileLayer } from './schema.ts'

// Callers construct ProfileLayer values through parseLayer/resolveEffective already; validation lives
// on the LOAD path, where untrusted on-disk data enters. Save writes the typed layer as-is.

/** User layer: <config>/ctk/profile.json. Synced through the profile repo. */
export const loadUserLayer = (p: CtkPaths): ProfileLayer | null => {
  const raw = readJsonIfExists(p.profile)
  return raw === null ? null : parseLayer(raw, p.profile)
}

export const saveUserLayer = (p: CtkPaths, layer: ProfileLayer): void => {
  writeJsonAtomic(p.profile, { ...layer, schemaVersion: PROFILE_SCHEMA_VERSION })
}

/** Device layer: <config>/ctk/devices/<device>.json. Never synced. */
export const loadDeviceLayer = (p: CtkPaths, device: string): ProfileLayer | null => {
  const file = p.deviceFile(device)
  if (!existsSync(file)) return null
  return parseLayer(readJsonIfExists(file), file)
}

export const saveDeviceLayer = (p: CtkPaths, device: string, layer: ProfileLayer): void => {
  writeJsonAtomic(p.deviceFile(device), { ...layer, schemaVersion: PROFILE_SCHEMA_VERSION })
}

/** CTK Defaults -> User Profile -> Device Overrides. */
export const loadEffective = (p: CtkPaths, device: string): Profile =>
  resolveEffective(loadUserLayer(p), loadDeviceLayer(p, device))
