import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Ctx } from '../cli/context.ts'
import { failure, type Report } from '../cli/report.ts'
import { claudeProblem, listPlugins, probeClaude, pluginCommands } from '../core/claude.ts'
import { loadLedger, newLedger } from '../core/ledger.ts'
import { MARKETPLACE_NAME, PLUGIN_ID, marketplaceDir, packageRoot, pluginSourceDir } from '../core/paths.ts'
import { loadEffective } from '../core/profilestore.ts'
import { readSettings } from '../core/settings.ts'
import { applySettings, desiredEntries, planSettings } from './apply.ts'
import { assertWritable, packageProblem } from './install.ts'
import { backupSet } from './undo.ts'
import { conflictHelp, describeStep, planMarketplace, recordPluginEntry, repointMarketplace, restoreDisabled } from './marketplace.ts'
import { copyStatusline, planStatuslineCopy } from './statusline.ts'
import { beginTxn, ensureBackup, syncLedger } from './txn.ts'

const NPM_HINT = 'To upgrade ctk itself, pull the latest checkout and rebuild (git pull && npm ci && npm run build), then run "ctk update" again.'

/** Refresh the marketplace and plugin, re-copy the status line script if it changed, re-apply the profile. */
export const runUpdate = async (ctx: Ctx, root = packageRoot()): Promise<Report> => {
  const incomplete = packageProblem(root)
  if (incomplete) return failure(incomplete)
  const probe = await probeClaude(ctx)
  if (probe.version === null) return failure(claudeProblem(probe))
  if (!ctx.dryRun) assertWritable(ctx.configDir)
  const settingsFile = readSettings(ctx.paths.settings)
  const plugin = (await listPlugins(ctx)).find(p => p.id === PLUGIN_ID)
  if (!plugin) return failure(`${PLUGIN_ID} is not installed; run "ctk install"`)

  const packaged = (JSON.parse(readFileSync(join(pluginSourceDir(root), '.claude-plugin', 'plugin.json'), 'utf8')) as { version?: string }).version ?? null
  const effective = loadEffective(ctx.paths, ctx.device)
  const ledger = loadLedger(ctx) ?? newLedger(ctx)
  const source = marketplaceDir(root)
  const { step: marketplaceStep, registeredAt, native } = await planMarketplace(ctx, source, ledger)
  if (marketplaceStep === 'conflict') {
    const reason = conflictHelp(registeredAt)
    return { code: 2, data: { steps: { marketplace: marketplaceStep }, conflicts: [{ pointer: `marketplace:${MARKETPLACE_NAME}`, reason }] }, lines: [`conflict: ${reason}`] }
  }
  // Re-pointing removes the marketplace and, with it, the plugin: it is installed again afterwards.
  // A native (github) install updates through Claude Code itself, so CTK leaves the plugin alone.
  const pluginStep = marketplaceStep === 'repoint' ? 'reinstall' : native ? 'native' : plugin.version !== packaged ? 'update' : 'current'
  const statuslineStep = effective.hud.statusLine === 'auto' ? planStatuslineCopy(root, ctx.paths.statusline, ledger) : 'off'
  const { desired } = desiredEntries(ctx, effective, { assumeStatuslineFile: statuslineStep === 'copy' || statuslineStep === 'unchanged' || statuslineStep === 'edited' })
  const plan = planSettings(settingsFile.data, ledger.entries, desired, p => pluginStep === 'reinstall' && p.startsWith(`/pluginConfigs/${PLUGIN_ID}/options/`))

  const lines = [
    `${ctx.dryRun ? 'plan' : 'update'}:`,
    `  marketplace ${MARKETPLACE_NAME}: ${describeStep(marketplaceStep, source, registeredAt, native)}`,
    `  plugin ${PLUGIN_ID}: ${pluginStep === 'native' ? `${plugin.version ?? '?'}, installed natively: update it with /plugin update ${PLUGIN_ID}` : pluginStep === 'reinstall' ? 'reinstall' : pluginStep === 'update' ? `${plugin.version ?? '?'} -> ${packaged ?? '?'}` : `up to date (${plugin.version ?? '?'})`}`,
    `  status line script: ${statuslineStep === 'copy' ? 'refresh' : statuslineStep === 'unchanged' ? 'up to date' : statuslineStep === 'edited' ? 'edited by you, left unchanged' : 'not managed'}`,
    `  settings.json: ${plan.changes.length === 0 ? 'no key changes' : `${plan.changes.length} key(s)`}`,
  ]
  const editedScript = statuslineStep === 'edited' ? [{ pointer: ctx.paths.statusline, reason: 'edited since CTK wrote it; not overwritten (restore it or delete it, then re-run "ctk update")' }] : []
  const data: Record<string, unknown> = { dryRun: ctx.dryRun, steps: { marketplace: marketplaceStep, plugin: pluginStep, statusline: statuslineStep, settingsKeys: plan.changes.length } }
  if (ctx.dryRun) {
    const conflicts = [...plan.conflicts, ...editedScript]
    return { code: conflicts.length > 0 ? 2 : 0, data: { ...data, conflicts }, lines: [...lines, ...conflicts.map(c => `  conflict: ${c.pointer}: ${c.reason}`), NPM_HINT] }
  }

  const t = beginTxn(ctx, ledger, 'update')
  const entriesBefore = JSON.stringify(ledger.entries)
  let result
  let added = false
  let installed = false
  try {
    if (marketplaceStep !== 'present' || pluginStep === 'update' || statuslineStep === 'copy' || plan.changes.length > 0) {
      ensureBackup(t, backupSet(ctx))
    }
    if (marketplaceStep === 'repoint') {
      await repointMarketplace(ctx, source)
      added = true
      await pluginCommands.install(ctx)
      installed = true
    } else {
      if (marketplaceStep === 'add') {
        await pluginCommands.marketplaceAdd(ctx, source)
        added = true
      }
      if (pluginStep === 'update') {
        await pluginCommands.marketplaceUpdate(ctx)
        await pluginCommands.update(ctx)
      }
    }
    await restoreDisabled(ctx, !plugin.enabled)
    if (statuslineStep === 'copy') copyStatusline(t, root)
    result = applySettings(t, effective, { op: 'update', pluginReinstalled: installed })
  } finally {
    if (added || installed) recordPluginEntry(t, added, installed)
    if (t.changes.length > 0 || JSON.stringify(ledger.entries) !== entriesBefore) syncLedger(t)
  }
  const changed = pluginStep === 'update' || pluginStep === 'reinstall' || statuslineStep === 'copy' || result.changed
  lines.push(changed ? 'done. Restart Claude Code (or run /reload-plugins) to load the update.' : 'already up to date; nothing to change.')
  for (const s of result.skipped) lines.push(`  note: ${s}`)
  const conflicts = [...result.conflicts, ...editedScript]
  for (const c of conflicts) lines.push(`  conflict: ${c.pointer}: ${c.reason}`)
  lines.push(NPM_HINT)
  return { code: conflicts.length > 0 ? 2 : 0, data: { ...data, changed, conflicts, skipped: result.skipped }, lines }
}
