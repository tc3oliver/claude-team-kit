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
import { deepEqual, fromPointer, pointerDelete, pointerGet, pointerSet, toPointer, type Json, type JsonObject } from '../core/jsonx.ts'
import { PLUGIN_ID } from '../core/paths.ts'
import { PORTABLE_SETTINGS_KEYS, profileToPluginOptions, type Profile } from '../core/schema.ts'
import { readSettings, writeSettings } from '../core/settings.ts'
import { isCtkStatusLine, statuslineSetting } from './statusline.ts'
import { beginTxn, ensureBackup, syncLedger, type Txn } from './txn.ts'

export type ApplyResult = { changed: boolean; conflicts: { pointer: string; reason: string }[]; skipped: string[] }

export type ApplyOpts = {
  op?: string
  /** Plan as if the statusline script were already installed (dry-run before the copy). */
  assumeStatuslineFile?: boolean
  /** The plugin was (re)installed in this run: Claude deletes its pluginConfigs entry on uninstall, so absent options are re-added. */
  pluginReinstalled?: boolean
}

/**
 * soft = a user value already there is kept without a conflict (statusLine, env flag): CTK only
 * fills these when absent. Everything else CTK manages is strict: a different user value is a conflict.
 */
export type Desired = { pointer: string; value: Json; soft: boolean }

const TEAMS_ENV = toPointer(['env', 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'])
const STATUSLINE = toPointer(['statusLine'])

const OPTION_PROFILE_PATHS: Record<string, string> = {
  maxWorkers: 'team.maxWorkers',
  explorerModel: 'routing.explorer.model',
  implementerModel: 'routing.implementer.model',
  reviewerModel: 'routing.reviewer.model',
  highRiskModel: 'routing.highRisk.model',
  hudBand: 'hud.band',
  recordStats: 'stats.record',
}

/** The dotted profile path that produces a settings.json pointer, or null when the pointer is not profile-driven. */
export const profilePathFor = (pointer: string): string | null => {
  if (pointer === TEAMS_ENV) return 'claude.enableAgentTeams'
  if (pointer === STATUSLINE) return 'hud.statusLine'
  const opt = fromPointer(pointer)
  if (opt.length === 4 && opt[0] === 'pluginConfigs' && opt[1] === PLUGIN_ID && opt[2] === 'options') return OPTION_PROFILE_PATHS[opt[3] as string] ?? null
  const key = fromPointer(pointer)
  return key.length === 1 && (PORTABLE_SETTINGS_KEYS as readonly string[]).includes(key[0] as string) ? `portable.settings.${key[0]}` : null
}

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
      try {
        desired.push({ pointer: STATUSLINE, value: statuslineSetting(ctx.paths.statusline), soft: true })
      } catch (e) {
        skipped.push(`statusLine: ${e instanceof Error ? e.message : String(e)}`)
      }
    } else skipped.push('statusLine: the status line script is not installed yet (run "ctk install")')
  }
  return { desired, skipped }
}

export type Plan = { data: JsonObject; entries: LedgerEntry[]; changes: EntryChange[]; conflicts: ApplyResult['conflicts']; skipped: string[] }

const clean = (e: SettingsKeyEntry): SettingsKeyEntry => {
  const next = { ...e }
  delete next.pending
  return next
}

const priorEq = (cur: Json | undefined, p: Prior): boolean => ('absent' in p ? cur === undefined : cur !== undefined && deepEqual(cur, p.value))

const priorOf = (cur: Json | undefined): Prior => (cur === undefined ? { absent: true } : { value: cur })

/** Pure: what the ownership rules do to `settings` given the ledger. Nothing is written. */
export const planSettings = (
  settings: JsonObject,
  ledgerEntries: LedgerEntry[],
  desired: Desired[],
  /** Pointers whose absence is expected rather than a user's deletion. */
  readd: (pointer: string) => boolean = () => false,
): Plan => {
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
    if (e?.pending !== undefined && priorEq(cur, e.pending)) {
      // A crashed write: the ledger was saved but settings.json still holds the state before it. Finish it.
      record(priorOf(cur), clean({ ...e, owned: true, written: d.value }))
    } else if (e && cur === undefined && !readd(d.pointer)) {
      // Deletions: a key CTK wrote (or adopted) and the user then removed stays removed. It is recorded
      // as theirs (owned:false) and reported as a note, not a conflict (exit 0).
      if (e.owned || e.pending !== undefined) putEntry(e, clean({ ...e, owned: false }))
      skipped.push(`${d.pointer}: removed by you since CTK wrote it; not re-added (uninstall and install again to have CTK manage it)`)
    } else if (e?.owned) {
      if (cur === undefined) record({ absent: true }, clean({ ...e, written: d.value }))
      else if (deepEqual(cur, d.value)) {
        if (!deepEqual(cur, e.written) || e.pending !== undefined) putEntry(e, clean({ ...e, written: d.value }))
      } else if (deepEqual(cur, e.written)) record(priorOf(cur), clean({ ...e, written: d.value }))
      else {
        // The user edited a key CTK wrote: it is theirs now.
        putEntry(e, clean({ ...e, owned: false }))
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
    if (e.pending !== undefined && priorEq(cur, e.pending)) {
      // a revert that already went through before a crash: nothing left to do
    } else if (e.owned && cur !== undefined && deepEqual(cur, e.written)) {
      if ('absent' in e.prior) pointerDelete(data, e.pointer)
      else pointerSet(data, e.pointer, structuredClone(e.prior.value))
      changes.push({ kind: 'settings-key', pointer: e.pointer, before: e, after: null, valueBefore: { value: e.written }, valueAfter: e.prior })
    } else if (e.owned && cur !== undefined) skipped.push(`${e.pointer}: changed since CTK wrote it; no longer managed`)
    putEntry(e, null)
  }
  return { data, entries, changes, conflicts, skipped }
}

const readdPredicate = (opts: ApplyOpts) => (pointer: string): boolean =>
  opts.pluginReinstalled === true && pointer.startsWith(`/pluginConfigs/${PLUGIN_ID}/options/`)

/** Apply inside an open transaction: backs up and writes settings.json only if a key changes. */
export const applySettings = (t: Txn, effective: Profile, opts: ApplyOpts = {}): ApplyResult => {
  const { ctx } = t
  const file = readSettings(ctx.paths.settings)
  const { desired, skipped } = desiredEntries(ctx, effective, opts)
  const plan = planSettings(file.data, t.ledger.entries, desired, readdPredicate(opts))
  const settingsChanged = plan.changes.length > 0
  const changed = settingsChanged || !deepEqual(plan.entries, t.ledger.entries)
  if (!ctx.dryRun && changed) {
    if (settingsChanged) {
      ensureBackup(t, [ctx.paths.settings])
      t.changes.push(...plan.changes)
      // Record the intent first, marking each touched entry with the state settings.json is still in, so a
      // crash before the write is finished by the next run instead of mistaken for the user's edit.
      const inFlight = new Map(plan.changes.map(c => [c.kind === 'settings-key' ? c.pointer : '', c]))
      t.ledger.entries = plan.entries.map(e => {
        const c = e.kind === 'settings-key' ? inFlight.get(e.pointer) : undefined
        return c?.kind === 'settings-key' ? { ...e, pending: c.valueBefore } : e
      })
      for (const c of plan.changes) {
        if (c.kind === 'settings-key' && c.after === null && c.before) t.ledger.entries.push({ ...c.before, pending: c.valueAfter })
      }
      syncLedger(t)
      writeSettings(ctx.paths.settings, file, plan.data)
      t.ledger.entries = plan.entries
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
