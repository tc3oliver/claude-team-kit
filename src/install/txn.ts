import { randomBytes } from 'node:crypto'

import type { Ctx } from '../cli/context.ts'
import { createBackup } from '../core/fsx.ts'
import { saveLedger, type EntryChange, type Ledger, type Tx } from '../core/ledger.ts'

/** One backed-up, ledger-recorded operation. Nothing is written until a step needs to write. */
export type Txn = { ctx: Ctx; ledger: Ledger; op: string; changes: EntryChange[]; backupId: string | null; tx: Tx | null }

export const beginTxn = (ctx: Ctx, ledger: Ledger, op: string): Txn => ({ ctx, ledger, op, changes: [], backupId: null, tx: null })

/** Back up `files` once per transaction, before the first mutation. */
export const ensureBackup = (t: Txn, files: string[]): void => {
  if (t.backupId !== null) return
  t.backupId = createBackup(t.ctx.paths.backupsDir, t.op, files).id
}

/** Persist the ledger with the transaction so far. Called before a risky write and again at the end. */
export const syncLedger = (t: Txn): void => {
  if (t.changes.length > 0) {
    if (t.tx === null) {
      t.tx = { id: `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`, op: t.op, at: new Date().toISOString(), backupId: t.backupId, entryChanges: t.changes }
      t.ledger.transactions.push(t.tx)
    }
    t.tx.backupId = t.backupId
    t.tx.entryChanges = t.changes
  }
  saveLedger(t.ctx, t.ledger)
}
