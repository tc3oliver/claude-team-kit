import { existsSync } from 'node:fs'

import type { Ctx } from '../cli/context.ts'
import {
  findEntry,
  loadLedger,
  newLedger,
  type EntryChange,
  type Ledger,
  type LedgerEntry,
  type Prior,
  type SettingsKeyEntry,
} from '../core/ledger.ts'
import { deepEqual, pointerDelete, pointerGet, pointerSet, toPointer, type Json, type JsonObject } from '../core/jsonx.ts'
import { PLUGIN_ID } from '../core/paths.ts'
import { PORTABLE_SETTINGS_KEYS, profileToPluginOptions, type Profile } from '../core/schema.ts'
import { readSettings, writeSettings } from '../core/settings.ts'
import { isCtkStatusLine, statuslineSetting } from './statusline.ts'
import { beginTxn, ensureBackup, syncLedger, type Txn } from './txn.ts'

export { materializeSkills } from './skills.ts'

export type ApplyResult = { changed: boolean; conflicts: { pointer: string; reason: string }[]; skipped: string[] }

export type ApplyOpts = {
  op?: string
  /** Plan as if the statusline script were already installed (dry-run before the copy). */
  assumeStatuslineFile?: boolean
}

/**
 * soft = a user value already there is kept without a conflict (statusLine, env flag): CTK only
 * fills these when absent. Everything else CTK manages is strict: a different user value is a conflict.
 */
export type Desired = { pointer: string; value: Json; soft: boolean }

const TEAMS_ENV = toPointer(['env', 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'])
const STATUSLINE = toPointer(['statusLine'])

export const desiredEntries = (ctx: Ctx, p: Profile, opts: ApplyOpts = {}): { desired: Desired[]; skipped: string[] } => {
  const desired: Desired[] = []
  const skipped: string[] = []
  for (const [k, v] of Object.entries(profileToPluginOptions(p))) {
    desired.push({ pointer: toPointer(['pluginConfigs', PLUGIN_ID, 'options', k]), value: v, soft: false })
  }
  for (const key of PORTABLE_SETTINGS_KEYS) {
    const v = p.portable.settings[key]
    if (v !== undefined) desired.push({ pointer: toPointer([key]), value: v, soft: false })
  }
  if (p.claude.enableAgentTeams) desired.push({ pointer: TEAMS_ENV, value: '1', soft: true })
  if (p.hud.statusLine === 'auto') {
    if (existsSync(ctx.paths.statusline) || opts.assumeStatuslineFile) {
      desired.push({ pointer: STATUSLINE, value: statuslineSetting(ctx.paths.statusline), soft: true })
    } else skipped.push('statusLine: the status line script is not installed yet (run "ctk install")')
  }
  return { desired, skipped }
}

export type Plan = { data: JsonObject; entries: LedgerEntry[]; changes: EntryChange[]; conflicts: ApplyResult['conflicts']; skipped: string[] }

const priorOf = (cur: Json | undefined): Prior => (cur === undefined ? { absent: true } : { value: cur })

/** Pure: what the ownership rules do to `settings` given the ledger. Nothing is written. */
export const planSettings = (settings: JsonObject, ledgerEntries: LedgerEntry[], desired: Desired[]): Plan => {
  const data = structuredClone(settings)
  const entries = [...ledgerEntries]
  const changes: EntryChange[] = []
  const conflicts: Plan['conflicts'] = []
  const skipped: string[] = []

  const putEntry = (old: SettingsKeyEntry | undefined, next: SettingsKeyEntry | null) => {
    const i = old ? entries.indexOf(old) : -1
    if (i >= 0) next ? entries.splice(i, 1, next) : entries.splice(i, 1)
    else if (next) entries.push(next)
  }
  const writeValue = (pointer: string, value: Json): string | null => {
    try {
      pointerSet(data, pointer, structuredClone(value))
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }
  const keep = (d: Desired, cur: Json | undefined): void => {
    if (!d.soft) return void conflicts.push({ pointer: d.pointer, reason: 'a different value is set that CTK did not write; left unchanged' })
    skipped.push(
      d.pointer === STATUSLINE
        ? isCtkStatusLine(cur)
          ? 'statusLine: a CTK status line with another path is set; left unchanged'
          : 'statusLine: your own status line is kept; the HUD runs via the mod band only'
        : `${d.pointer}: already set to a different value; left unchanged`,
    )
  }

  for (const d of desired) {
    const cur = pointerGet(data, d.pointer)
    const e = findEntry(entries, 'settings-key', d.pointer)
    const record = (valueBefore: Prior, next: SettingsKeyEntry): void => {
      const err = writeValue(d.pointer, d.value)
      if (err !== null) return void conflicts.push({ pointer: d.pointer, reason: err })
      putEntry(e, next)
      changes.push({ kind: 'settings-key', pointer: d.pointer, before: e ?? null, after: next, valueBefore, valueAfter: { value: d.value } })
    }
    if (e?.owned) {
      if (cur !== undefined && deepEqual(cur, d.value)) {
        if (!deepEqual(cur, e.written)) putEntry(e, { ...e, written: d.value })
      } else if (cur === undefined || deepEqual(cur, e.written)) {
        record(priorOf(cur), { ...e, written: d.value })
      } else {
        // The user edited a key CTK wrote: it is theirs now.
        putEntry(e, { ...e, owned: false })
        keep(d, cur)
      }
    } else if (cur === undefined) {
      record({ absent: true }, { kind: 'settings-key', pointer: d.pointer, prior: { absent: true }, written: d.value, owned: true })
    } else if (deepEqual(cur, d.value)) {
      if (!e) putEntry(undefined, { kind: 'settings-key', pointer: d.pointer, prior: { value: cur }, written: d.value, owned: false })
    } else keep(d, cur)
  }

  // Keys CTK owns that the profile no longer asks for go back to what they held before.
  const wanted = new Set(desired.map(d => d.pointer))
  for (const e of ledgerEntries) {
    if (e.kind !== 'settings-key' || wanted.has(e.pointer)) continue
    const cur = pointerGet(data, e.pointer)
    if (e.owned && cur !== undefined && deepEqual(cur, e.written)) {
      if ('absent' in e.prior) pointerDelete(data, e.pointer)
      else pointerSet(data, e.pointer, structuredClone(e.prior.value))
      changes.push({ kind: 'settings-key', pointer: e.pointer, before: e, after: null, valueBefore: { value: e.written }, valueAfter: e.prior })
    } else if (e.owned && cur !== undefined) skipped.push(`${e.pointer}: changed since CTK wrote it; no longer managed`)
    putEntry(e, null)
  }
  return { data, entries, changes, conflicts, skipped }
}

/** Apply inside an open transaction: backs up and writes settings.json only if a key changes. */
export const applySettings = (t: Txn, effective: Profile, opts: ApplyOpts = {}): ApplyResult => {
  const { ctx } = t
  const file = readSettings(ctx.paths.settings)
  const { desired, skipped } = desiredEntries(ctx, effective, opts)
  const plan = planSettings(file.data, t.ledger.entries, desired)
  const settingsChanged = plan.changes.length > 0
  const changed = settingsChanged || !deepEqual(plan.entries, t.ledger.entries)
  if (!ctx.dryRun && changed) {
    if (settingsChanged) {
      ensureBackup(t, [ctx.paths.settings])
      t.changes.push(...plan.changes)
      t.ledger.entries = plan.entries
      syncLedger(t) // record the intent first: a crash after the write must not orphan CTK's keys
      writeSettings(ctx.paths.settings, file, plan.data)
    } else t.ledger.entries = plan.entries
  }
  return { changed, conflicts: plan.conflicts, skipped: [...skipped, ...plan.skipped] }
}

/**
 * Entry point for sync and config: apply the effective profile to settings.json under the ownership
 * rules, in one backed-up transaction. No-op (no write, no backup, no transaction) when nothing differs.
 */
export const applyProfile = async (ctx: Ctx, effective: Profile, opts: ApplyOpts = {}): Promise<ApplyResult> => {
  const ledger = loadLedger(ctx) ?? newLedger(ctx)
  const t = beginTxn(ctx, ledger, opts.op ?? 'apply')
  const result = applySettings(t, effective, opts)
  if (!ctx.dryRun && result.changed) syncLedger(t)
  return result
}
