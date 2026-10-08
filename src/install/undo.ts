import { existsSync, lstatSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import type { Ctx } from '../cli/context.ts'
import { listMarketplaces, listPlugins, pluginCommands, registryFiles } from '../core/claude.ts'
import { createBackup, readJsonIfExists, sha256, writeFileAtomic, type BackupManifest } from '../core/fsx.ts'
import { deepEqual, pointerDelete, pointerGet, pointerSet, type Json } from '../core/jsonx.ts'
import { loadLedger, saveLedger, type EntryChange, type Ledger, type LedgerEntry, type Prior } from '../core/ledger.ts'
import { MARKETPLACE_NAME, PLUGIN_ID } from '../core/paths.ts'
import { readSettings, writeSettings } from '../core/settings.ts'
import { treeHash } from './skills.ts'

export type UndoReport = { reverted: string[]; conflicts: { key: string; reason: string }[]; notes: string[] }

const priorEq = (cur: Json | undefined, p: Prior): boolean => ('absent' in p ? cur === undefined : cur !== undefined && deepEqual(cur, p.value))

const entryKey = (e: LedgerEntry): string => (e.kind === 'settings-key' ? e.pointer : e.kind === 'file' ? e.path : 'plugin')

/** Put `entry` (or nothing) in the ledger in place of whatever sits under the same key. */
const setEntry = (ledger: Ledger, kind: LedgerEntry['kind'], key: string, entry: LedgerEntry | null): void => {
  const i = ledger.entries.findIndex(e => e.kind === kind && (kind === 'plugin' || entryKey(e) === key))
  if (i >= 0) entry ? ledger.entries.splice(i, 1, entry) : ledger.entries.splice(i, 1)
  else if (entry) ledger.entries.push(entry)
}

/** The hash of a file, or of a managed skill directory. null = absent. */
const currentHash = (path: string): string | null => {
  if (!existsSync(path)) return null
  return lstatSync(path).isDirectory() ? treeHash(path) : sha256(readFileSync(path))
}

/**
 * Reverse changes (given newest first). Every step is checked against the live state: a value that is
 * no longer what CTK left is the user's, so it is kept and reported, and CTK stops tracking it.
 * settings.json is written before any `claude plugin` call because claude rewrites it too.
 */
export const undoChanges = async (ctx: Ctx, ledger: Ledger, changes: EntryChange[], backup: BackupManifest | null): Promise<UndoReport> => {
  const rep: UndoReport = { reverted: [], conflicts: [], notes: [] }
  const live = !ctx.dryRun

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
        if ('absent' in c.valueBefore) pointerDelete(data, c.pointer)
        else pointerSet(data, c.pointer, structuredClone(c.valueBefore.value))
        modified = true
        rep.reverted.push(c.pointer)
        if (live) setEntry(ledger, 'settings-key', c.pointer, c.before)
      } else {
        rep.conflicts.push({ key: c.pointer, reason: 'changed since CTK wrote it; left as is' })
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
      rep.conflicts.push({ key: c.path, reason: 'modified since CTK wrote it; left as is' })
      if (live) setEntry(ledger, 'file', c.path, null)
    } else if (c.after.priorSha256 === null && c.before === null) {
      rep.reverted.push(c.path)
      if (live) {
        rmSync(c.path, { recursive: true, force: true })
        setEntry(ledger, 'file', c.path, null)
      }
    } else {
      const saved = backup?.entries.find(e => e.path === c.path && e.existed && e.sha256 === c.after?.priorSha256)
      if (!saved?.backup || !existsSync(saved.backup)) {
        rep.conflicts.push({ key: c.path, reason: 'previous content has no backup copy; left as is' })
        if (live) setEntry(ledger, 'file', c.path, null)
      } else {
        rep.reverted.push(c.path)
        if (live) {
          writeFileAtomic(c.path, readFileSync(saved.backup))
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
        if (live) await pluginCommands.uninstall(ctx)
      }
      if (dropMarketplace && (await listMarketplaces(ctx)).some(m => m.name === MARKETPLACE_NAME)) {
        rep.reverted.push(`marketplace ${MARKETPLACE_NAME}`)
        if (live) await pluginCommands.marketplaceRemove(ctx)
      }
      if (live) setEntry(ledger, 'plugin', 'plugin', c.before)
    } catch (e) {
      rep.conflicts.push({ key: 'plugin', reason: e instanceof Error ? e.message : String(e) })
    }
  }
  return rep
}

const readManifest = (ctx: Ctx, id: string | null): BackupManifest | null =>
  id === null ? null : readJsonIfExists<BackupManifest>(join(ctx.paths.backupsDir, id, 'manifest.json'))

const backupSet = (ctx: Ctx): string[] => [ctx.paths.settings, ...registryFiles(ctx.configDir), ctx.paths.statusline]

export type UndoResult = { code: number; undone: string[]; report: UndoReport }

/** Undo the latest undoable transaction, or (with `to`) that transaction and every later one. */
export const rollback = async (ctx: Ctx, to?: string): Promise<UndoResult & { error?: string }> => {
  const none: UndoReport = { reverted: [], conflicts: [], notes: [] }
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
  if (!ctx.dryRun) createBackup(ctx.paths.backupsDir, 'rollback', backupSet(ctx))
  const report: UndoReport = { reverted: [], conflicts: [], notes: [] }
  for (const tx of targets) {
    const r = await undoChanges(ctx, ledger, [...tx.entryChanges].reverse(), readManifest(ctx, tx.backupId))
    report.reverted.push(...r.reverted)
    report.conflicts.push(...r.conflicts)
    report.notes.push(...r.notes)
    if (!ctx.dryRun) tx.undoneAt = new Date().toISOString()
  }
  if (!ctx.dryRun) saveLedger(ctx, ledger)
  return { code: report.conflicts.length > 0 ? 2 : 0, undone: targets.map(t => t.id), report }
}

/** Remove everything under <config>/ctk except backups/. Only direct children of the verified ctk dir are removed. */
const wipeCtkDir = (ctx: Ctx): void => {
  const dir = ctx.paths.ctk
  if (basename(dir) !== 'ctk' || dirname(dir) !== ctx.configDir) throw new Error(`refusing to clean unexpected directory ${dir}`)
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) if (name !== 'backups') rmSync(join(dir, name), { recursive: true, force: true })
}

export const uninstall = async (ctx: Ctx): Promise<UndoResult & { removedDir: boolean }> => {
  readSettings(ctx.paths.settings)
  const ledger = loadLedger(ctx)
  if (!ledger) {
    return { code: 0, undone: [], removedDir: false, report: { reverted: [], conflicts: [], notes: ['no ledger: CTK owns nothing here'] } }
  }
  const changes: EntryChange[] = []
  for (const e of [...ledger.entries].reverse()) {
    if (e.kind === 'settings-key' && e.owned) {
      changes.push({ kind: 'settings-key', pointer: e.pointer, before: null, after: e, valueBefore: e.prior, valueAfter: { value: e.written } })
    } else if (e.kind === 'file' && !e.path.startsWith(ctx.paths.ctk)) {
      changes.push({ kind: 'file', path: e.path, before: null, after: { ...e, priorSha256: null } })
    } else if (e.kind === 'plugin') {
      changes.push({ kind: 'plugin', before: null, after: { ...e, pluginInstalledByCtk: true } })
    }
  }
  if (!ctx.dryRun) createBackup(ctx.paths.backupsDir, 'uninstall', [...backupSet(ctx), ctx.paths.ledger, ctx.paths.profile])
  const report = await undoChanges(ctx, ledger, changes, null)
  if (!ctx.dryRun) wipeCtkDir(ctx)
  return { code: report.conflicts.length > 0 ? 2 : 0, undone: [], report, removedDir: !ctx.dryRun }
}
