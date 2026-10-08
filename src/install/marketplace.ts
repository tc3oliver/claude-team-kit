import { existsSync, realpathSync } from 'node:fs'

import type { Ctx } from '../cli/context.ts'
import { listMarketplaces, pluginCommands } from '../core/claude.ts'
import { findEntry, type Ledger, type PluginEntry } from '../core/ledger.ts'
import { MARKETPLACE_NAME, PLUGIN_ID } from '../core/paths.ts'
import type { Txn } from './txn.ts'

const real = (p: string): string => {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/**
 * add       not registered
 * present   registered at this package's marketplace
 * repoint   registered elsewhere, and either CTK added it or that path no longer exists: safe to move
 * conflict  registered elsewhere by someone else and the old path still exists
 */
export type MarketplaceStep = 'add' | 'present' | 'repoint' | 'conflict'

export const planMarketplace = async (ctx: Ctx, source: string, ledger: Ledger): Promise<{ step: MarketplaceStep; registeredAt: string | null }> => {
  const mk = (await listMarketplaces(ctx)).find(m => m.name === MARKETPLACE_NAME)
  if (!mk) return { step: 'add', registeredAt: null }
  if (mk.path !== null && real(mk.path) === real(source)) return { step: 'present', registeredAt: mk.path }
  const addedByCtk = findEntry(ledger.entries, 'plugin')?.marketplaceAddedByCtk === true
  const gone = mk.path !== null && !existsSync(mk.path)
  return { step: addedByCtk || gone ? 'repoint' : 'conflict', registeredAt: mk.path }
}

export const conflictHelp = (registeredAt: string | null): string =>
  `marketplace ${MARKETPLACE_NAME} is registered at ${registeredAt ?? 'another source'}, which still exists and was not added by CTK; ` +
  `to move it run "claude plugin marketplace remove ${MARKETPLACE_NAME}" (this also uninstalls ${PLUGIN_ID}) and then "ctk install" from the checkout you want to keep`

export const describeStep = (step: MarketplaceStep, source: string, registeredAt: string | null): string =>
  step === 'add'
    ? `add ${source}`
    : step === 'present'
      ? 'already registered'
      : step === 'repoint'
        ? `re-point from ${registeredAt ?? 'its old source'} to ${source} (Claude removes the plugin with the marketplace, so it is reinstalled)`
        : `CONFLICT, registered at ${registeredAt ?? 'another source'}`

/** Move the registration: removing the marketplace also uninstalls its plugin, so the caller reinstalls it. */
export const repointMarketplace = async (ctx: Ctx, source: string): Promise<void> => {
  await pluginCommands.marketplaceRemove(ctx)
  await pluginCommands.marketplaceAdd(ctx, source)
}

/** Record what this run added in the ledger's plugin entry (flags only ever turn on) and, when it added something, the change. */
export const recordPluginEntry = (t: Txn, added: boolean, installed: boolean): void => {
  const prev = findEntry(t.ledger.entries, 'plugin')
  const next: PluginEntry = {
    kind: 'plugin',
    marketplaceAddedByCtk: (prev?.marketplaceAddedByCtk ?? false) || added,
    pluginInstalledByCtk: (prev?.pluginInstalledByCtk ?? false) || installed,
  }
  if (prev && prev.marketplaceAddedByCtk === next.marketplaceAddedByCtk && prev.pluginInstalledByCtk === next.pluginInstalledByCtk) return
  t.ledger.entries = [...t.ledger.entries.filter(e => e !== prev), next]
  if (added || installed) t.changes.push({ kind: 'plugin', before: prev ?? null, after: next })
}
