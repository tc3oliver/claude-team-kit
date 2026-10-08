import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

import type { Ctx } from '../cli/context.ts'
import { JsonParseError, readJsonIfExists, writeJsonAtomic } from './fsx.ts'
import type { Json } from './jsonx.ts'
import { packageRoot } from './paths.ts'

export const LEDGER_SCHEMA_VERSION = 1

const json = z.custom<Json>(v => v !== undefined)
const prior = z.union([z.strictObject({ absent: z.literal(true) }), z.strictObject({ value: json })])
export type Prior = z.infer<typeof prior>

const settingsKeyEntry = z.strictObject({
  kind: z.literal('settings-key'),
  pointer: z.string(),
  /** What the key held before CTK wrote it. */
  prior,
  /** The value CTK wrote. Removal is only safe while the key still holds this. */
  written: json,
  /** false = the key already held the desired value (or the user took it over): never removed by CTK. */
  owned: z.boolean(),
})
const fileEntry = z.strictObject({
  kind: z.literal('file'),
  /** A file, or a managed skill directory (sha256 is then a hash of the whole tree). */
  path: z.string(),
  sha256: z.string(),
  priorSha256: z.string().nullable(),
})
const pluginEntry = z.strictObject({
  kind: z.literal('plugin'),
  marketplaceAddedByCtk: z.boolean(),
  pluginInstalledByCtk: z.boolean(),
})
const ledgerEntry = z.discriminatedUnion('kind', [settingsKeyEntry, fileEntry, pluginEntry])

/** One reversible step of a transaction. Undo requires the live state to still equal `after`. */
const entryChange = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('settings-key'),
    pointer: z.string(),
    before: settingsKeyEntry.nullable(),
    after: settingsKeyEntry.nullable(),
    valueBefore: prior,
    valueAfter: prior,
  }),
  z.strictObject({ kind: z.literal('file'), path: z.string(), before: fileEntry.nullable(), after: fileEntry.nullable() }),
  z.strictObject({ kind: z.literal('plugin'), before: pluginEntry.nullable(), after: pluginEntry.nullable() }),
])

const tx = z.strictObject({
  id: z.string(),
  op: z.string(),
  at: z.string(),
  backupId: z.string().nullable(),
  entryChanges: z.array(entryChange),
  /** Set once rolled back; the transaction is then not undoable again. */
  undoneAt: z.string().optional(),
})

const ledgerSchema = z.strictObject({
  schemaVersion: z.literal(LEDGER_SCHEMA_VERSION),
  ctkVersion: z.string(),
  configDir: z.string(),
  entries: z.array(ledgerEntry),
  transactions: z.array(tx),
})

export type SettingsKeyEntry = z.infer<typeof settingsKeyEntry>
export type FileEntry = z.infer<typeof fileEntry>
export type PluginEntry = z.infer<typeof pluginEntry>
export type LedgerEntry = z.infer<typeof ledgerEntry>
export type EntryChange = z.infer<typeof entryChange>
export type Tx = z.infer<typeof tx>
export type Ledger = z.infer<typeof ledgerSchema>

export const ctkVersion = (): string => {
  try {
    return (JSON.parse(readFileSync(join(packageRoot(), 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export const newLedger = (ctx: Ctx): Ledger => ({
  schemaVersion: LEDGER_SCHEMA_VERSION,
  ctkVersion: ctkVersion(),
  configDir: ctx.configDir,
  entries: [],
  transactions: [],
})

/** Missing ledger -> null. A ledger that does not parse or validate throws: it is never silently replaced. */
export const loadLedger = (ctx: Ctx): Ledger | null => {
  const raw = readJsonIfExists(ctx.paths.ledger)
  if (raw === null) return null
  const r = ledgerSchema.safeParse(raw)
  if (!r.success) {
    const why = r.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
    throw new JsonParseError(ctx.paths.ledger, new Error(`invalid ledger: ${why}`))
  }
  return r.data
}

export const saveLedger = (ctx: Ctx, ledger: Ledger): void => {
  writeJsonAtomic(ctx.paths.ledger, { ...ledger, ctkVersion: ctkVersion(), configDir: ctx.configDir })
}

export const ledgerExists = (ctx: Ctx): boolean => existsSync(ctx.paths.ledger)

export const findEntry = <K extends LedgerEntry['kind']>(
  entries: LedgerEntry[],
  kind: K,
  key?: string,
): Extract<LedgerEntry, { kind: K }> | undefined =>
  entries.find(e => {
    if (e.kind !== kind) return false
    if (e.kind === 'settings-key') return e.pointer === key
    if (e.kind === 'file') return e.path === key
    return true
  }) as Extract<LedgerEntry, { kind: K }> | undefined
