import { accessSync, constants, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import type { Ctx } from '../cli/context.ts'
import { failure, type Report } from '../cli/report.ts'
import {
  claudeProblem,
  probeClaude,
  isWsl,
  listPlugins,
  MODS_MIN_VERSION,
  pluginCommands,
  registryFiles,
  versionAtLeast,
} from '../core/claude.ts'
import { deepMerge, type JsonObject } from '../core/jsonx.ts'
import { loadLedger, newLedger } from '../core/ledger.ts'
import { MARKETPLACE_NAME, marketplaceDir, packageRoot, PLUGIN_ID } from '../core/paths.ts'
import { loadDeviceLayer, loadUserLayer, saveDeviceLayer } from '../core/profilestore.ts'
import { resolveEffective, type Profile } from '../core/schema.ts'
import { readSettings } from '../core/settings.ts'
import { conflictHelp, describeStep, planMarketplace, recordPluginEntry, repointMarketplace, restoreDisabled } from './marketplace.ts'
import { applySettings, noteAbsentContainers, desiredEntries, planSettings, type ApplyResult } from './apply.ts'
import { copyStatusline, planStatuslineCopy } from './statusline.ts'
import { beginTxn, ensureBackup, syncLedger } from './txn.ts'

export type InstallFlags = { statusline: boolean; enableTeams: boolean }

/** `--no-statusline` / `--no-enable-teams` are stored in the device layer so later syncs keep honouring them. */
const effectiveWithFlags = (ctx: Ctx, flags: InstallFlags): Profile => {
  const user = loadUserLayer(ctx.paths)
  const device = loadDeviceLayer(ctx.paths, ctx.device)
  const current = resolveEffective(user, device)
  const patch: JsonObject = {}
  if (!flags.statusline && current.hud.statusLine !== 'off') patch.hud = { statusLine: 'off' }
  if (!flags.enableTeams && current.claude.enableAgentTeams) patch.claude = { enableAgentTeams: false }
  if (Object.keys(patch).length === 0) return current
  const merged = deepMerge(device as JsonObject | null, patch)
  if (!ctx.dryRun) saveDeviceLayer(ctx.paths, ctx.device, merged)
  return resolveEffective(user, merged)
}

/** Names the files a complete ctk package carries; null when all are there. */
export const packageProblem = (root: string): string | null => {
  const missing = [join('.claude-plugin', 'marketplace.json'), join('plugins', 'ctk', '.claude-plugin', 'plugin.json')].filter(rel => !existsSync(join(root, rel)))
  return missing.length === 0
    ? null
    : `the ctk package at ${root} is incomplete (missing ${missing.join(', ')}); get a complete copy (clone the repository, then run "npm ci && npm run build") and run ctk from there.`
}

/** Fail early, naming the path, when CTK cannot write to the Claude config dir. */
export const assertWritable = (dir: string): void => {
  try {
    mkdirSync(dir, { recursive: true })
    accessSync(dir, constants.W_OK)
  } catch (e) {
    throw new Error(`the Claude config dir ${dir} is not writable (${(e as NodeJS.ErrnoException).code ?? 'error'}); fix its permissions or pick another with --config-dir.`)
  }
}

export const NEXT_STEPS = ['Restart Claude Code (or run /reload-plugins).', 'Try: /ctk:team <goal>   (status: /ctk-stats)', 'Undo any time: ctk uninstall']

/** A plugin the user disabled is not usable yet: say how to enable it instead of suggesting /ctk:team. */
const nextStepsDisabled = [NEXT_STEPS[0] as string, `The ctk plugin is disabled; enable it with: claude plugin enable ${PLUGIN_ID}`, NEXT_STEPS[2] as string]

export const runInstall = async (ctx: Ctx, flags: InstallFlags, root = packageRoot()): Promise<Report> => {
  const lines: string[] = []
  const incomplete = packageProblem(root)
  if (incomplete) return failure(incomplete)
  const probe = await probeClaude(ctx)
  if (probe.version === null) return failure(claudeProblem(probe))
  const version = probe.version
  const source = marketplaceDir(root)
  if (!ctx.dryRun) assertWritable(ctx.configDir)
  const mods = versionAtLeast(version, MODS_MIN_VERSION)
  const settingsFile = readSettings(ctx.paths.settings) // refuses invalid JSON before anything changes

  const effective = effectiveWithFlags(ctx, flags)
  const ledger = loadLedger(ctx) ?? newLedger(ctx)
  const { step: marketplaceStep, registeredAt, native } = await planMarketplace(ctx, source, ledger)
  const plugin = (await listPlugins(ctx)).find(p => p.id === PLUGIN_ID)
  // A plugin the user disabled stays disabled: CTK does not flip it back on behind their back.
  // Re-pointing the marketplace uninstalls the plugin with it, so it is installed again afterwards.
  const pluginStep = !plugin || marketplaceStep === 'repoint' ? 'install' : plugin.enabled ? 'present' : 'disabled'
  const statuslineStep = effective.hud.statusLine === 'auto' ? planStatuslineCopy(root, ctx.paths.statusline, ledger) : 'off'

  const scriptThere = statuslineStep === 'copy' || statuslineStep === 'unchanged' || statuslineStep === 'edited'
  const { desired, skipped: desiredSkipped } = desiredEntries(ctx, effective, { assumeStatuslineFile: scriptThere })
  const plan = planSettings(settingsFile.data, ledger.entries, desired, p => pluginStep === 'install' && p.startsWith(`/pluginConfigs/${PLUGIN_ID}/options/`))

  const platform = `${process.platform}${isWsl() ? ' (WSL)' : ''}`
  lines.push(`${ctx.dryRun ? 'plan' : 'install'}: ${platform}, Claude Code ${version}, config ${ctx.configDir}`)
  if (!mods) lines.push(`Claude Code ${version} is older than ${MODS_MIN_VERSION}, the first release with plugin mods: the team cap, the team band and stats recording stay inactive until you upgrade (needs >= ${MODS_MIN_VERSION}); skills, agents and the status line still install.`)
  lines.push(`  marketplace ${MARKETPLACE_NAME}: ${describeStep(marketplaceStep, source, registeredAt, native)}`)
  const pluginLabel =
    pluginStep === 'disabled'
      ? 'installed but disabled, left disabled'
      : pluginStep === 'install'
        ? plugin && !plugin.enabled
          ? 'reinstall, then disable it again (it was disabled)'
          : 'install'
        : 'already installed'
  lines.push(`  plugin ${PLUGIN_ID}: ${pluginLabel}`)
  lines.push(`  status line script: ${{ copy: 'copy', unchanged: 'up to date', edited: 'edited by you, left unchanged', off: 'not managed (hud.statusLine=off)', unavailable: 'packaged script not found, skipped' }[statuslineStep]}`)
  lines.push(`  settings.json: ${plan.changes.length === 0 ? 'no key changes' : `${plan.changes.length} key(s): ${plan.changes.map(c => (c.kind === 'settings-key' ? c.pointer : '')).join(', ')}`}`)

  const data: Record<string, unknown> = {
    dryRun: ctx.dryRun,
    platform,
    claudeVersion: version,
    mods,
    steps: { marketplace: marketplaceStep, plugin: pluginStep, statusline: statuslineStep, settingsKeys: plan.changes.length },
  }
  if (marketplaceStep === 'conflict') {
    const reason = conflictHelp(registeredAt)
    lines.push(`conflict: ${reason}`)
    return { code: 2, data: { ...data, conflicts: [{ pointer: `marketplace:${MARKETPLACE_NAME}`, reason }] }, lines }
  }

  let apply: ApplyResult
  if (ctx.dryRun) {
    apply = { changed: plan.changes.length > 0, conflicts: plan.conflicts, skipped: [...desiredSkipped, ...plan.skipped] }
  } else {
    const t = beginTxn(ctx, ledger, 'install')
    const ledgerBefore = () => JSON.stringify([ledger.entries, ledger.containersAbsentBefore])
    const before = ledgerBefore()
    let added = false
    let installed = false
    let ok = false
    const needsWork = marketplaceStep !== 'present' || pluginStep === 'install' || statuslineStep === 'copy' || plan.changes.length > 0
    try {
      if (needsWork) {
        ensureBackup(t, [ctx.paths.settings, ...registryFiles(ctx.configDir), ctx.paths.statusline])
        // `claude plugin` creates these in settings.json; uninstall removes them again only if they were not there before.
        noteAbsentContainers(ledger, settingsFile.data, ['/enabledPlugins', '/extraKnownMarketplaces'])
      }
      if (marketplaceStep === 'add') {
        await pluginCommands.marketplaceAdd(ctx, source)
        added = true
      } else if (marketplaceStep === 'repoint') {
        await repointMarketplace(ctx, source)
        added = true
      }
      if (pluginStep === 'install') {
        await pluginCommands.install(ctx)
        installed = true
      }
      if (plugin && !plugin.enabled) await restoreDisabled(ctx, true)
      if (statuslineStep === 'copy') copyStatusline(t, root)
      apply = applySettings(t, effective, { op: 'install', assumeStatuslineFile: false, pluginReinstalled: installed })
      ok = true
    } finally {
      // Even when a later step failed, what CTK already added must be in the ledger so uninstall can remove it.
      if (ok || added || installed) recordPluginEntry(t, added, installed)
      if (t.changes.length > 0 || ledgerBefore() !== before) syncLedger(t)
    }
  }

  const conflicts = [...apply.conflicts]
  if (statuslineStep === 'edited') conflicts.push({ pointer: ctx.paths.statusline, reason: 'edited since CTK wrote it; not overwritten (restore it or delete it, then re-run "ctk install")' })
  const skipped = [...apply.skipped]
  const changedAnything = marketplaceStep !== 'present' || pluginStep === 'install' || statuslineStep === 'copy' || apply.changed
  if (!ctx.dryRun) lines.push(changedAnything ? 'installed.' : 'already installed; nothing to change.')
  for (const s of skipped) lines.push(`  note: ${s}`)
  for (const c of conflicts) lines.push(`  conflict: ${c.pointer}: ${c.reason}`)
  if (conflicts.length > 0) lines.push('conflicting keys were left untouched; make them match your profile (see "ctk config list") or remove them, then re-run "ctk install".')
  const leftDisabled = pluginStep === 'disabled' || (marketplaceStep === 'repoint' && plugin !== undefined && !plugin.enabled)
  const nextSteps = leftDisabled ? nextStepsDisabled : NEXT_STEPS
  if (!ctx.dryRun) lines.push(...nextSteps)
  return { code: conflicts.length > 0 ? 2 : 0, data: { ...data, changed: changedAnything, conflicts, skipped, ...(ctx.dryRun ? {} : { nextSteps }) }, lines }
}
