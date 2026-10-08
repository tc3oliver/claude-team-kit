import { existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

import type { Ctx } from '../cli/context.ts'
import { failure, type Report } from '../cli/report.ts'
import {
  claudeVersion,
  isWsl,
  listMarketplaces,
  listPlugins,
  MODS_MIN_VERSION,
  pluginCommands,
  registryFiles,
  versionAtLeast,
} from '../core/claude.ts'
import { deepMerge, type JsonObject } from '../core/jsonx.ts'
import { findEntry, loadLedger, newLedger, type PluginEntry } from '../core/ledger.ts'
import { MARKETPLACE_NAME, marketplaceDir, packageRoot, PLUGIN_ID } from '../core/paths.ts'
import { loadDeviceLayer, loadUserLayer, saveDeviceLayer } from '../core/profilestore.ts'
import { resolveEffective, type Profile } from '../core/schema.ts'
import { readSettings } from '../core/settings.ts'
import { applySettings, desiredEntries, planSettings, type ApplyResult } from './apply.ts'
import { copyStatusline, planStatuslineCopy } from './statusline.ts'
import { beginTxn, ensureBackup, syncLedger } from './txn.ts'

export type InstallFlags = { statusline: boolean; enableTeams: boolean }

const samePath = (a: string | null, b: string): boolean => {
  if (a === null) return false
  const real = (p: string) => {
    try {
      return realpathSync(p)
    } catch {
      return p
    }
  }
  return real(a) === real(b)
}

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

export const runInstall = async (ctx: Ctx, flags: InstallFlags, root = packageRoot()): Promise<Report> => {
  const lines: string[] = []
  const version = await claudeVersion(ctx)
  if (version === null) return failure('cannot run "claude --version"; install Claude Code first (https://code.claude.com)')
  const source = marketplaceDir(root)
  if (!existsSync(join(source, '.claude-plugin', 'marketplace.json'))) return failure(`no marketplace found at ${source}`)
  const mods = versionAtLeast(version, MODS_MIN_VERSION)
  const settingsFile = readSettings(ctx.paths.settings) // refuses invalid JSON before anything changes

  const effective = effectiveWithFlags(ctx, flags)
  const marketplace = (await listMarketplaces(ctx)).find(m => m.name === MARKETPLACE_NAME)
  const plugin = (await listPlugins(ctx)).find(p => p.id === PLUGIN_ID)
  const marketplaceStep = !marketplace ? 'add' : samePath(marketplace.path, source) ? 'present' : 'conflict'
  const pluginStep = !plugin ? 'install' : plugin.enabled ? 'present' : 'enable'
  const statuslineStep = effective.hud.statusLine === 'auto' ? planStatuslineCopy(root, ctx.paths.statusline) : 'off'

  const existing = loadLedger(ctx)
  const ledger = existing ?? newLedger(ctx)
  const { desired, skipped: desiredSkipped } = desiredEntries(ctx, effective, { assumeStatuslineFile: statuslineStep === 'copy' || statuslineStep === 'unchanged' })
  const plan = planSettings(settingsFile.data, ledger.entries, desired)

  const platform = `${process.platform}${isWsl() ? ' (WSL)' : ''}`
  lines.push(`${ctx.dryRun ? 'plan' : 'install'}: ${platform}, Claude Code ${version}, config ${ctx.configDir}`)
  if (!mods) lines.push(`mods need Claude Code >= ${MODS_MIN_VERSION}: skills, agents and the status line install, the team cap and band stay inactive until you upgrade`)
  lines.push(`  marketplace ${MARKETPLACE_NAME}: ${marketplaceStep === 'add' ? `add ${source}` : marketplaceStep === 'present' ? 'already registered' : `CONFLICT, registered at ${marketplace?.path ?? '?'}`}`)
  lines.push(`  plugin ${PLUGIN_ID}: ${pluginStep === 'install' ? 'install' : pluginStep === 'enable' ? 'enable' : 'already installed'}`)
  lines.push(`  status line script: ${{ copy: 'copy', unchanged: 'up to date', off: 'not managed (hud.statusLine=off)', unavailable: 'packaged script not found, skipped' }[statuslineStep]}`)
  lines.push(`  settings.json: ${plan.changes.length === 0 ? 'no key changes' : `${plan.changes.length} key(s): ${plan.changes.map(c => (c.kind === 'settings-key' ? c.pointer : '')).join(', ')}`}`)

  const data: Record<string, unknown> = {
    dryRun: ctx.dryRun,
    platform,
    claudeVersion: version,
    mods,
    steps: { marketplace: marketplaceStep, plugin: pluginStep, statusline: statuslineStep, settingsKeys: plan.changes.length },
  }
  if (marketplaceStep === 'conflict') {
    lines.push(`error: marketplace ${MARKETPLACE_NAME} is already registered from a different path; run "claude plugin marketplace remove ${MARKETPLACE_NAME}" first, or use that checkout's ctk`)
    return { code: 2, data: { ...data, conflicts: [{ pointer: `marketplace:${MARKETPLACE_NAME}`, reason: 'registered from a different path' }] }, lines }
  }

  let apply: ApplyResult
  if (ctx.dryRun) {
    apply = { changed: plan.changes.length > 0, conflicts: plan.conflicts, skipped: [...desiredSkipped, ...plan.skipped] }
  } else {
    const t = beginTxn(ctx, ledger, 'install')
    const entriesBefore = JSON.stringify(ledger.entries)
    let added = false
    let installed = false
    let ok = false
    const needsWork = marketplaceStep !== 'present' || pluginStep !== 'present' || statuslineStep === 'copy' || plan.changes.length > 0
    try {
      if (needsWork) ensureBackup(t, [ctx.paths.settings, ...registryFiles(ctx.configDir), ctx.paths.statusline])
      if (marketplaceStep === 'add') {
        await pluginCommands.marketplaceAdd(ctx, source)
        added = true
      }
      if (pluginStep === 'install') {
        await pluginCommands.install(ctx)
        installed = true
      } else if (pluginStep === 'enable') await pluginCommands.enable(ctx)
      if (statuslineStep === 'copy') copyStatusline(t, root)
      apply = applySettings(t, effective, { op: 'install', assumeStatuslineFile: false })
      ok = true
    } finally {
      // Even when a later step failed, what CTK already added must be in the ledger so uninstall can remove it.
      if (ok || added || installed) {
        const prev = findEntry(ledger.entries, 'plugin')
        const next: PluginEntry = {
          kind: 'plugin',
          marketplaceAddedByCtk: (prev?.marketplaceAddedByCtk ?? false) || added,
          pluginInstalledByCtk: (prev?.pluginInstalledByCtk ?? false) || installed,
        }
        if (!prev || prev.marketplaceAddedByCtk !== next.marketplaceAddedByCtk || prev.pluginInstalledByCtk !== next.pluginInstalledByCtk) {
          ledger.entries = [...ledger.entries.filter(e => e !== prev), next]
          if (added || installed) t.changes.push({ kind: 'plugin', before: prev ?? null, after: next })
        }
      }
      if (t.changes.length > 0 || JSON.stringify(ledger.entries) !== entriesBefore) syncLedger(t)
    }
  }

  const changedAnything = marketplaceStep !== 'present' || pluginStep !== 'present' || statuslineStep === 'copy' || apply.changed
  if (!ctx.dryRun) lines.push(changedAnything ? 'done. Restart Claude Code (or run /reload-plugins) to load the plugin.' : 'already installed; nothing to change.')
  for (const s of apply.skipped) lines.push(`  note: ${s}`)
  for (const c of apply.conflicts) lines.push(`  conflict: ${c.pointer}: ${c.reason}`)
  if (apply.conflicts.length > 0) lines.push('conflicting keys were left untouched; make them match your profile (see "ctk config list") or remove them, then re-run "ctk install".')
  return { code: apply.conflicts.length > 0 ? 2 : 0, data: { ...data, changed: changedAnything, conflicts: apply.conflicts, skipped: apply.skipped }, lines }
}
