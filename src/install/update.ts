import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Ctx } from '../cli/context.ts'
import { failure, type Report } from '../cli/report.ts'
import { claudeVersion, listPlugins, pluginCommands, registryFiles } from '../core/claude.ts'
import { loadLedger, newLedger } from '../core/ledger.ts'
import { PLUGIN_ID, packageRoot, pluginSourceDir } from '../core/paths.ts'
import { loadEffective } from '../core/profilestore.ts'
import { readSettings } from '../core/settings.ts'
import { applySettings, desiredEntries, planSettings } from './apply.ts'
import { copyStatusline, planStatuslineCopy } from './statusline.ts'
import { beginTxn, ensureBackup, syncLedger } from './txn.ts'

const NPM_HINT = 'To upgrade ctk itself run "npm install -g claude-team-kit@latest", then "ctk update" again.'

/** Refresh the marketplace and plugin, re-copy the status line script if it changed, re-apply the profile. */
export const runUpdate = async (ctx: Ctx, root = packageRoot()): Promise<Report> => {
  if ((await claudeVersion(ctx)) === null) return failure('cannot run "claude --version"; install Claude Code first')
  const settingsFile = readSettings(ctx.paths.settings)
  const plugin = (await listPlugins(ctx)).find(p => p.id === PLUGIN_ID)
  if (!plugin) return failure(`${PLUGIN_ID} is not installed; run "ctk install"`)

  const packaged = (JSON.parse(readFileSync(join(pluginSourceDir(root), '.claude-plugin', 'plugin.json'), 'utf8')) as { version?: string }).version ?? null
  const pluginStep = plugin.version !== packaged ? 'update' : 'current'
  const effective = loadEffective(ctx.paths, ctx.device)
  const statuslineStep = effective.hud.statusLine === 'auto' ? planStatuslineCopy(root, ctx.paths.statusline) : 'off'
  const ledger = loadLedger(ctx) ?? newLedger(ctx)
  const { desired } = desiredEntries(ctx, effective, { assumeStatuslineFile: statuslineStep === 'copy' || statuslineStep === 'unchanged' })
  const plan = planSettings(settingsFile.data, ledger.entries, desired)

  const lines = [
    `${ctx.dryRun ? 'plan' : 'update'}:`,
    `  plugin ${PLUGIN_ID}: ${pluginStep === 'update' ? `${plugin.version ?? '?'} -> ${packaged ?? '?'}` : `up to date (${plugin.version ?? '?'})`}`,
    `  status line script: ${statuslineStep === 'copy' ? 'refresh' : statuslineStep === 'unchanged' ? 'up to date' : 'not managed'}`,
    `  settings.json: ${plan.changes.length === 0 ? 'no key changes' : `${plan.changes.length} key(s)`}`,
  ]
  const data: Record<string, unknown> = { dryRun: ctx.dryRun, steps: { plugin: pluginStep, statusline: statuslineStep, settingsKeys: plan.changes.length } }
  if (ctx.dryRun) return { code: plan.conflicts.length > 0 ? 2 : 0, data: { ...data, conflicts: plan.conflicts }, lines: [...lines, NPM_HINT] }

  const t = beginTxn(ctx, ledger, 'update')
  const entriesBefore = JSON.stringify(ledger.entries)
  let result
  try {
    if (pluginStep === 'update' || statuslineStep === 'copy' || plan.changes.length > 0) {
      ensureBackup(t, [ctx.paths.settings, ...registryFiles(ctx.configDir), ctx.paths.statusline])
    }
    if (pluginStep === 'update') {
      await pluginCommands.marketplaceUpdate(ctx)
      await pluginCommands.update(ctx)
    }
    if (statuslineStep === 'copy') copyStatusline(t, root)
    result = applySettings(t, effective, { op: 'update' })
  } finally {
    if (t.changes.length > 0 || JSON.stringify(ledger.entries) !== entriesBefore) syncLedger(t)
  }
  const changed = pluginStep === 'update' || statuslineStep === 'copy' || result.changed
  lines.push(changed ? 'done. Restart Claude Code (or run /reload-plugins) to load the update.' : 'already up to date; nothing to change.')
  for (const s of result.skipped) lines.push(`  note: ${s}`)
  for (const c of result.conflicts) lines.push(`  conflict: ${c.pointer}: ${c.reason}`)
  lines.push(NPM_HINT)
  return { code: result.conflicts.length > 0 ? 2 : 0, data: { ...data, changed, conflicts: result.conflicts, skipped: result.skipped }, lines }
}
