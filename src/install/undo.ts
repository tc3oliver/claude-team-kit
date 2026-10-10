import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { basename, dirname, join, sep } from 'node:path'

import type { Ctx } from '../cli/context.ts'
import { listMarketplaces, listPlugins, pluginCommands, registryFiles } from '../core/claude.ts'
import { createBackup, readJsonIfExists, sha256, writeFileAtomic, type BackupManifest } from '../core/fsx.ts'
import { pointerGet, pointerSet, toPointer, type Json, type JsonObject } from '../core/jsonx.ts'
import { loadLedger, priorEq, saveLedger, type EntryChange, type FileEntry, type Ledger, type LedgerEntry } from '../core/ledger.ts'
import { MARKETPLACE_NAME, PLUGIN_ID } from '../core/paths.ts'
import { loadDeviceLayer, loadUserLayer } from '../core/profilestore.ts'
import { readSettings, writeSettings } from '../core/settings.ts'
import { deleteLeaf, profilePathFor, pruneContainers } from './apply.ts'

/** `reverted` is everything put back to its earlier state; `removed` is the part of it that was deleted (nothing earlier to restore). */
export type UndoReport = { reverted: string[]; removed: string[]; conflicts: { key: string; reason: string }[]; notes: string[] }

const entryKey = (e: LedgerEntry): string => (e.kind === 'settings-key' ? e.pointer : e.kind === 'file' ? e.path : 'plugin')

/** Put `entry` (or nothing) in the ledger in place of whatever sits under the same key. */
const setEntry = (ledger: Ledger, kind: LedgerEntry['kind'], key: string, entry: LedgerEntry | null): void => {
  const i = ledger.entries.findIndex(e => e.kind === kind && (kind === 'plugin' || entryKey(e) === key))
  if (i >= 0) entry ? ledger.entries.splice(i, 1, entry) : ledger.entries.splice(i, 1)
  else if (entry) ledger.entries.push(entry)
}

/** The hash of a file; null = absent. */
const currentHash = (path: string): string | null => (existsSync(path) ? sha256(readFileSync(path)) : null)

/** Is `p` strictly inside `dir`? Compares whole path segments, so `/x/ctk-other` is not inside `/x/ctk`. */
export const isInside = (dir: string, p: string): boolean => p.startsWith(dir.endsWith(sep) ? dir : dir + sep)

/**
 * Reverse changes (given newest first). Every step is checked against the live state: a value that is
 * no longer what CTK left is the user's, so it is kept and reported, and CTK stops tracking it.
 * settings.json is written before any `claude plugin` call because claude rewrites it too.
 */
export const undoChanges = async (
  ctx: Ctx,
  ledger: Ledger,
  changes: EntryChange[],
  backup: BackupManifest | null,
  opBackupId: string | null = null,
): Promise<UndoReport> => {
  const rep: UndoReport = { reverted: [], removed: [], conflicts: [], notes: [] }
  const live = !ctx.dryRun

  // `claude plugin uninstall` deletes the plugin's whole pluginConfigs entry, so a user-edited option
  // cannot be "left in place" when CTK is the one uninstalling the plugin: report it as removed instead.
  const uninstallsPlugin = changes.some(c => c.kind === 'plugin' && c.after?.pluginInstalledByCtk && !c.before?.pluginInstalledByCtk)
  const pluginPresent = uninstallsPlugin && (await listPlugins(ctx).catch(() => [])).some(p => p.id === PLUGIN_ID)
  const optionsPrefix = `/pluginConfigs/${PLUGIN_ID}/`
  const deferred: { pointer: string; value: Json }[] = []

  const settingsChanges = changes.filter(c => c.kind === 'settings-key')
  if (settingsChanges.length > 0) {
    const file = readSettings(ctx.paths.settings)
    const data = structuredClone(file.data)
    let modified = false
    for (const c of settingsChanges) {
      const cur = pointerGet(data, c.pointer)
      if (priorEq(cur, c.valueBefore)) {
        if (live) setEntry(ledger, 'settings-key', c.pointer, c.before)
      } else if (priorEq(cur, c.valueAfter)) {
        if ('absent' in c.valueBefore) {
          deleteLeaf(data, c.pointer)
          rep.removed.push(c.pointer)
        } else pointerSet(data, c.pointer, structuredClone(c.valueBefore.value))
        modified = true
        rep.reverted.push(c.pointer)
        if (live) setEntry(ledger, 'settings-key', c.pointer, c.before)
      } else {
        if (pluginPresent && c.pointer.startsWith(optionsPrefix) && cur !== undefined) deferred.push({ pointer: c.pointer, value: cur })
        else rep.conflicts.push({ key: c.pointer, reason: 'changed since CTK wrote it; left as is' })
        const e = ledger.entries.find(x => x.kind === 'settings-key' && x.pointer === c.pointer)
        if (live && e?.kind === 'settings-key') setEntry(ledger, 'settings-key', c.pointer, { ...e, owned: false })
      }
    }
    if (live && modified) writeSettings(ctx.paths.settings, file, data)
  }

  for (const c of changes) {
    if (c.kind !== 'file') continue
    const cur = currentHash(c.path)
    if (c.after === null) {
      rep.notes.push(`${c.path}: was removed by CTK; its previous content is not restorable here`)
    } else if (cur === null) {
      if (live) setEntry(ledger, 'file', c.path, c.before)
    } else if (cur !== c.after.sha256) {
      if (c.after.priorSha256 !== null && cur === c.after.priorSha256) {
        // The file already holds exactly what this undo would restore (a crashed rollback re-run, or the
        // user put it back): adopt that state instead of reporting a conflict, so a rerun converges to
        // the same ledger a clean run would have written.
        if (live) setEntry(ledger, 'file', c.path, c.before)
      } else {
        rep.conflicts.push({ key: c.path, reason: 'modified since CTK wrote it; left as is' })
        if (live) setEntry(ledger, 'file', c.path, null)
      }
    } else if (c.after.priorSha256 === null && c.before === null) {
      rep.reverted.push(c.path)
      rep.removed.push(c.path)
      if (live) {
        rmSync(c.path, { recursive: true, force: true })
        setEntry(ledger, 'file', c.path, null)
      }
    } else {
      const saved = backup?.entries.find(e => e.path === c.path && e.existed && e.sha256 === c.after?.priorSha256)
      const bytes = saved?.backup && existsSync(saved.backup) ? readFileSync(saved.backup) : null
      if (!saved || bytes === null) {
        rep.conflicts.push({ key: c.path, reason: 'previous content has no backup copy; left as is' })
        if (live) setEntry(ledger, 'file', c.path, null)
      } else if (sha256(bytes) !== saved.sha256) {
        // The manifest sha was recorded from the exact bytes createBackup wrote, so a mismatch means the
        // copy was altered afterwards. Never write it over a live user file: refuse and release the entry.
        rep.conflicts.push({ key: c.path, reason: 'backup copy failed its integrity check; left as is' })
        if (live) setEntry(ledger, 'file', c.path, null)
      } else {
        rep.reverted.push(c.path)
        if (live) {
          writeFileAtomic(c.path, bytes)
          setEntry(ledger, 'file', c.path, c.before)
        }
      }
    }
  }

  for (const c of changes) {
    if (c.kind !== 'plugin' || c.after === null) continue
    const dropPlugin = c.after.pluginInstalledByCtk && !c.before?.pluginInstalledByCtk
    const dropMarketplace = c.after.marketplaceAddedByCtk && !c.before?.marketplaceAddedByCtk
    try {
      if (dropPlugin && (await listPlugins(ctx)).some(p => p.id === PLUGIN_ID)) {
        rep.reverted.push('plugin ctk@ctk-kit')
        rep.removed.push('plugin ctk@ctk-kit')
        if (live) await pluginCommands.uninstall(ctx)
      }
      if (dropMarketplace && (await listMarketplaces(ctx)).some(m => m.name === MARKETPLACE_NAME)) {
        rep.reverted.push(`marketplace ${MARKETPLACE_NAME}`)
        rep.removed.push(`marketplace ${MARKETPLACE_NAME}`)
        if (live) await pluginCommands.marketplaceRemove(ctx)
      }
      if (live) setEntry(ledger, 'plugin', 'plugin', c.before)
    } catch (e) {
      rep.conflicts.push({ key: 'plugin', reason: e instanceof Error ? e.message : String(e) })
    }
  }

  if (deferred.length > 0) {
    const remaining = live ? readSettings(ctx.paths.settings).data : null
    for (const d of deferred) {
      const value = JSON.stringify(d.value)
      if (remaining === null) rep.notes.push(`${d.pointer}: will be removed with the plugin by Claude Code (your value ${value} is kept in the backup taken first)`)
      else if (pointerGet(remaining, d.pointer) !== undefined) rep.conflicts.push({ key: d.pointer, reason: 'changed since CTK wrote it; left as is' })
      else rep.notes.push(`${d.pointer}: removed with the plugin by Claude Code (your value ${value} is kept in backup ${opBackupId ?? '?'})`)
    }
  }

  // Containers that only exist because of CTK (recorded absent before its first write) go once they are empty.
  if (live && ledger.containersAbsentBefore.length > 0) {
    const file = readSettings(ctx.paths.settings)
    const data = structuredClone(file.data)
    const removed = pruneContainers(data, ledger.containersAbsentBefore)
    if (removed.length > 0) {
      writeSettings(ctx.paths.settings, file, data)
      ledger.containersAbsentBefore = ledger.containersAbsentBefore.filter(p => !removed.includes(p))
    }
  }
  return rep
}

const readManifest = (ctx: Ctx, id: string | null): BackupManifest | null =>
  id === null ? null : readJsonIfExists<BackupManifest>(join(ctx.paths.backupsDir, id, 'manifest.json'))

/** Every backup copy the ledger's transactions took, merged for undoChanges' restore lookup. */
const ledgerBackups = (ctx: Ctx, ledger: Ledger): BackupManifest | null => {
  const entries = ledger.transactions.flatMap(tx => readManifest(ctx, tx.backupId)?.entries ?? [])
  return entries.length === 0 ? null : { id: 'ledger-backups', op: 'uninstall', createdAt: new Date().toISOString(), entries }
}

/** The files every mutating operation backs up before touching: settings, Claude's plugin registry, the status line script. */
export const backupSet = (ctx: Ctx): string[] => [ctx.paths.settings, ...registryFiles(ctx.configDir), ctx.paths.statusline]

/** Rolled-back profile keys that a profile layer still sets: the next update or config run would re-apply them. */
const stillSetNotes = (ctx: Ctx, changes: EntryChange[], reverted: string[]): string[] => {
  let layers: (JsonObject | null)[]
  try {
    layers = [loadUserLayer(ctx.paths), loadDeviceLayer(ctx.paths, ctx.device)] as (JsonObject | null)[]
  } catch {
    return []
  }
  const paths = new Set<string>()
  for (const c of changes) {
    const path = c.kind === 'settings-key' && reverted.includes(c.pointer) ? profilePathFor(c.pointer) : null
    if (path && layers.some(l => l && pointerGet(l, toPointer(path.split('.'))) !== undefined)) paths.add(path)
  }
  return [...paths].map(p => `profile layer still sets ${p}; run \`ctk config unset ${p}\` or the next update/config will re-apply it`)
}

export type UndoResult = { code: number; undone: string[]; report: UndoReport }

/**
 * Test seam for the crash-window tests: called at each rollback step so a test can throw where a
 * crash would hit ('beforeTx' = before any revert; 'afterFiles' = files reverted, ledger not yet
 * saved; 'saveLedger' = about to persist this tx's commit point). Never set by production code.
 */
export const rollbackSeam: { fault?: (stage: 'beforeTx' | 'afterFiles' | 'saveLedger', i: number) => void } = {}

/** Undo the latest undoable transaction, or (with `to`) that transaction and every later one. */
export const rollback = async (ctx: Ctx, to?: string): Promise<UndoResult & { error?: string }> => {
  const none: UndoReport = { reverted: [], removed: [], conflicts: [], notes: [] }
  readSettings(ctx.paths.settings) // refuse early if it is not valid JSON
  const ledger = loadLedger(ctx)
  const open = ledger?.transactions.filter(t => !t.undoneAt) ?? []
  if (!ledger || open.length === 0) return { code: 0, undone: [], report: { ...none, notes: ['nothing to roll back'] } }
  let targets = [open[open.length - 1] as (typeof open)[number]]
  if (to !== undefined) {
    const i = ledger.transactions.findIndex(t => t.id === to)
    const tx = ledger.transactions[i]
    if (!tx) return { code: 1, undone: [], report: none, error: `no transaction ${to}` }
    if (tx.undoneAt) return { code: 1, undone: [], report: none, error: `transaction ${to} was already rolled back` }
    targets = ledger.transactions.slice(i).filter(t => !t.undoneAt).reverse()
  }
  const opBackupId = ctx.dryRun ? null : createBackup(ctx.paths.backupsDir, 'rollback', backupSet(ctx)).id
  const report: UndoReport = { reverted: [], removed: [], conflicts: [], notes: [] }
  // The ledger save is the commit point, and it happens per transaction. The remaining crash window is
  // "tx files reverted, that tx's save not yet durable" — a rerun then replays the tx, which is safe
  // because undoChanges re-checks live state before every write: a settings key is reverted only while
  // it still equals what CTK wrote (an already-reverted key equals valueBefore and is a no-op), a file
  // is rewritten only while its hash still equals CTK's (an already-restored file equals priorSha256
  // and is adopted), and anything the user changed in between becomes a conflict, never an overwrite.
  // A saveLedger that throws mid-write is the same window: writeFileAtomic renames, so the old ledger
  // survives intact and the tx simply stays open.
  for (let i = 0; i < targets.length; i++) {
    const tx = targets[i] as (typeof targets)[number]
    rollbackSeam.fault?.('beforeTx', i)
    const r = await undoChanges(ctx, ledger, [...tx.entryChanges].reverse(), readManifest(ctx, tx.backupId), opBackupId)
    report.reverted.push(...r.reverted)
    report.removed.push(...r.removed)
    report.conflicts.push(...r.conflicts)
    report.notes.push(...r.notes)
    if (!ctx.dryRun) {
      rollbackSeam.fault?.('afterFiles', i)
      tx.undoneAt = new Date().toISOString()
      rollbackSeam.fault?.('saveLedger', i)
      saveLedger(ctx, ledger)
    }
  }
  report.notes.push(...stillSetNotes(ctx, targets.flatMap(tx => tx.entryChanges), report.reverted))
  return { code: report.conflicts.length > 0 ? 2 : 0, undone: targets.map(t => t.id), report }
}

/** What uninstall leaves in <config>/ctk: backups are never deleted; devices/ and sync/ hold the user's own state. */
const KEEP_IN_CTK = ['backups', 'devices', 'sync']

/** Remove everything else under <config>/ctk. Only direct children of the verified ctk dir are removed. Returns what stayed. */
const wipeCtkDir = (ctx: Ctx): string[] => {
  const dir = ctx.paths.ctk
  if (basename(dir) !== 'ctk' || dirname(dir) !== ctx.configDir) throw new Error(`refusing to clean unexpected directory ${dir}`)
  if (!existsSync(dir)) return []
  for (const name of readdirSync(dir)) if (!KEEP_IN_CTK.includes(name)) rmSync(join(dir, name), { recursive: true, force: true })
  return KEEP_IN_CTK.filter(n => n !== 'backups' && existsSync(join(dir, n))).map(n => join(dir, n))
}

const NATIVE_REMOVAL = `Remove it in Claude Code with: /plugin uninstall ${PLUGIN_ID} (and /plugin marketplace remove ${MARKETPLACE_NAME})`

/** Nothing in the ledger: say so, how a native install is removed, and the one leftover that removal does not clean up. */
const noLedgerNotes = (ctx: Ctx): string[] => {
  const stats = ctx.paths.statsDir
  const remove = process.platform === 'win32' ? `rmdir /s /q "${stats}"` : `rm -rf '${stats.replace(/'/g, `'\\''`)}'`
  return [
    'no ledger: ctk owns nothing here and changed nothing',
    `if you installed the plugin natively, ${NATIVE_REMOVAL.charAt(0).toLowerCase()}${NATIVE_REMOVAL.slice(1)}`,
    existsSync(stats)
      ? `the mod's per-session counters in ${stats} stay behind after a native uninstall; delete them with: ${remove}`
      : `no stats directory at ${stats} (the mod writes its per-session counters there; a native uninstall would leave them behind)`,
  ]
}

/** nothing = no ledger, ctk owns nothing; removed = done; incomplete = a step failed or conflicts remain (ledger kept); planned = dry-run. */
export type UninstallStatus = 'nothing' | 'removed' | 'incomplete' | 'planned'

export const uninstall = async (ctx: Ctx): Promise<UndoResult & { removedDir: boolean; status: UninstallStatus }> => {
  readSettings(ctx.paths.settings)
  const ledger = loadLedger(ctx)
  if (!ledger) {
    return { code: 0, undone: [], removedDir: false, status: 'nothing', report: { reverted: [], removed: [], conflicts: [], notes: noLedgerNotes(ctx) } }
  }
  const changes: EntryChange[] = []
  const inCtkDir: FileEntry[] = []
  const adopted: string[] = []
  for (const e of [...ledger.entries].reverse()) {
    if (e.kind === 'settings-key' && e.owned) {
      changes.push({ kind: 'settings-key', pointer: e.pointer, before: null, after: e, valueBefore: e.prior, valueAfter: { value: e.written } })
    } else if (e.kind === 'file' && isInside(ctx.paths.ctk, e.path)) {
      inCtkDir.push(e)
    } else if (e.kind === 'file') {
      // Real entry, not a forced delete: restore from backup when a prior copy exists, delete only
      // when CTK created the file (priorSha256 null and nothing before it).
      changes.push({ kind: 'file', path: e.path, before: null, after: e })
    } else if (e.kind === 'plugin') {
      changes.push({ kind: 'plugin', before: null, after: e }) // only what CTK installed or registered is removed
      if (!e.pluginInstalledByCtk) adopted.push(`left plugin ${PLUGIN_ID} installed: ctk did not install it. ${NATIVE_REMOVAL}`)
    }
  }
  const opBackupId = ctx.dryRun ? null : createBackup(ctx.paths.backupsDir, 'uninstall', [...backupSet(ctx), ctx.paths.ledger, ctx.paths.profile]).id
  const report = await undoChanges(ctx, ledger, changes, ledgerBackups(ctx, ledger), opBackupId)
  report.notes.push(...adopted)
  // Scripts inside the ctk dir go with it, but only if they are still exactly what CTK wrote.
  for (const e of inCtkDir) {
    const cur = currentHash(e.path)
    if (cur !== null && cur !== e.sha256) report.conflicts.push({ key: e.path, reason: 'edited since CTK wrote it; kept' })
  }
  if (ctx.dryRun) return { code: report.conflicts.length > 0 ? 2 : 0, undone: [], report, removedDir: false, status: 'planned' }
  if (report.conflicts.length > 0) {
    // Keep the ledger so a re-run can finish what failed or was left for the user to resolve.
    saveLedger(ctx, ledger)
    report.notes.push(`${ctx.paths.ctk} was kept (ledger included); resolve the conflicts above and run "ctk uninstall" again`)
    return { code: 2, undone: [], report, removedDir: false, status: 'incomplete' }
  }
  for (const kept of wipeCtkDir(ctx)) report.notes.push(`kept ${kept} (your device overrides / sync clone); delete it by hand if you no longer need it`)
  return { code: 0, undone: [], report, removedDir: true, status: 'removed' }
}
