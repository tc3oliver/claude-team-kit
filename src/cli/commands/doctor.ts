import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { claudeVersion, isWsl, listMarketplaces, listPlugins, MODS_MIN_VERSION, versionAtLeast } from '../../core/claude.ts'
import { readJsonIfExists, verifyBackup, type BackupManifest } from '../../core/fsx.ts'
import { deepEqual, isObject, pointerGet } from '../../core/jsonx.ts'
import { loadLedger } from '../../core/ledger.ts'
import { MARKETPLACE_NAME, PLUGIN_ID } from '../../core/paths.ts'
import { loadEffective } from '../../core/profilestore.ts'
import { readSettings, type SettingsFile } from '../../core/settings.ts'
import { isCtkStatusLine } from '../../install/statusline.ts'
import { MANAGED_MARKER } from '../../sync/files.ts'
import { EXIT, type Ctx } from '../context.ts'
import type { Report } from '../report.ts'

export type Check = { id: string; status: 'pass' | 'warn' | 'fail'; message: string; fix?: string }

const TEAMS_ENV = 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export const runDoctor = async (ctx: Ctx): Promise<Report> => {
  const checks: Check[] = []
  // Existence only (the file holds credentials and is never read), and checked first: any `claude`
  // subprocess below creates <config>/.claude.json itself.
  const home = homedir()
  const onboarded = [join(ctx.configDir, '.claude.json'), ...(ctx.configDir === join(home, '.claude') ? [join(home, '.claude.json')] : [])].some(existsSync)
  const add = (id: string, status: Check['status'], message: string, fix?: string) => void checks.push({ id, status, message, ...(fix ? { fix } : {}) })

  const nodeMajor = Number(process.versions.node.split('.')[0])
  nodeMajor >= 20 ? add('node', 'pass', `Node ${process.versions.node}`) : add('node', 'fail', `Node ${process.versions.node} is too old`, 'install Node >= 20 (mise use node@lts)')

  const version = await claudeVersion(ctx)
  if (version === null) add('claude', 'fail', 'cannot run "claude --version"', 'install Claude Code and make sure "claude" is on PATH')
  else add('claude', 'pass', `Claude Code ${version}`)
  if (version !== null) {
    versionAtLeast(version, MODS_MIN_VERSION)
      ? add('mods', 'pass', `mods supported (>= ${MODS_MIN_VERSION})`)
      : add('mods', 'warn', `Claude Code ${version} predates mods (>= ${MODS_MIN_VERSION}): team cap and band are inactive`, 'update Claude Code, then run "ctk update"')
  }
  add('wsl', 'pass', isWsl() ? 'running under WSL' : `platform ${process.platform}`)
  if (isWsl() && ctx.configDir.startsWith('/mnt/')) add('wsl-config', 'warn', 'config dir is on the Windows filesystem under WSL', 'keep CLAUDE_CONFIG_DIR on the Linux filesystem')

  let settings: SettingsFile | null = null
  if (!existsSync(ctx.configDir)) add('config-dir', 'warn', `${ctx.configDir} does not exist`, 'start Claude Code once, then run "ctk install"')
  else {
    try {
      settings = readSettings(ctx.paths.settings)
      add('settings', 'pass', settings.exists ? 'settings.json parses' : 'no settings.json yet')
    } catch (e) {
      add('settings', 'fail', errMsg(e), 'repair settings.json by hand; ctk will not touch it until it parses')
    }
  }

  try {
    const plugin = (await listPlugins(ctx)).find(p => p.id === PLUGIN_ID)
    const loadFix = 'run "ctk install" from the checkout you want to keep'
    if (!plugin) add('plugin', 'fail', `${PLUGIN_ID} is not installed`, 'run "ctk install"')
    else if (plugin.errors.length > 0) add('plugin', 'fail', `${PLUGIN_ID} failed to load: ${plugin.errors.join('; ')}`, loadFix)
    else if (!plugin.enabled) add('plugin', 'warn', `${PLUGIN_ID} is installed but disabled`, `run "claude plugin enable ${PLUGIN_ID}"`)
    else add('plugin', 'pass', `${PLUGIN_ID} ${plugin.version ?? ''} installed and enabled`.replace('  ', ' '))
    const mk = (await listMarketplaces(ctx)).find(m => m.name === MARKETPLACE_NAME)
    const loadError = plugin?.errors.find(e => e.includes(`Marketplace ${MARKETPLACE_NAME}`))
    if (!mk) add('marketplace', 'fail', `marketplace ${MARKETPLACE_NAME} is not registered`, 'run "ctk install"')
    else if (mk.path !== null && !existsSync(mk.path)) add('marketplace', 'fail', `marketplace ${MARKETPLACE_NAME} is registered at ${mk.path}, which does not exist`, loadFix)
    else if (loadError) add('marketplace', 'fail', loadError, loadFix)
    else add('marketplace', 'pass', `marketplace ${MARKETPLACE_NAME} registered`)
  } catch (e) {
    add('plugin', 'warn', `could not query Claude Code: ${errMsg(e).slice(0, 160)}`)
  }

  let teamsWanted = true
  let wantedSkills: string[] | null = null
  try {
    const effective = loadEffective(ctx.paths, ctx.device)
    teamsWanted = effective.claude.enableAgentTeams
    wantedSkills = effective.skills
    add('profile', 'pass', 'profile layers valid')
  } catch (e) {
    add('profile', 'fail', errMsg(e), 'fix the profile with "ctk config"')
  }
  if (settings) {
    const env = pointerGet(settings.data, '/env')
    const on = (isObject(env) && env[TEAMS_ENV] !== undefined) || ctx.env[TEAMS_ENV] !== undefined
    on
      ? add('agent-teams', 'pass', 'agent teams flag set')
      : teamsWanted
        ? add('agent-teams', 'warn', 'agent teams flag not set', 'run "ctk install" (sets env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS in settings.json)')
        : add('agent-teams', 'pass', 'agent teams flag off (profile)')
    const sl = pointerGet(settings.data, '/statusLine')
    if (sl === undefined) add('statusline', 'warn', 'no status line configured', 'run "ctk install"')
    else if (!isCtkStatusLine(sl)) add('statusline', 'pass', 'your own status line is kept; the HUD runs via the mod band only')
    else if (existsSync(ctx.paths.statusline)) add('statusline', 'pass', 'CTK status line active')
    else add('statusline', 'fail', 'CTK status line configured but the script is missing', 'run "ctk update"')
  }

  if (onboarded) add('onboarding', 'pass', 'Claude Code has been started once')
  else add('onboarding', 'warn', 'Claude Code not started yet (no .claude.json)', 'run "claude" once and log in')

  try {
    const ledger = loadLedger(ctx)
    if (!ledger) add('ledger', 'warn', 'no ledger: ctk has not installed anything here', 'run "ctk install"')
    else if (settings) {
      const owned = ledger.entries.filter(e => e.kind === 'settings-key' && e.owned)
      const cur = (e: (typeof owned)[number]) => (e.kind === 'settings-key' ? pointerGet(settings.data, e.pointer) : undefined)
      const missing = owned.filter(e => cur(e) === undefined)
      const drift = owned.filter(e => e.kind === 'settings-key' && cur(e) !== undefined && !deepEqual(cur(e), e.written))
      drift.length + missing.length === 0
        ? add('ledger', 'pass', `ledger matches settings.json (${ledger.entries.length} entries, ${ledger.transactions.length} transactions)`)
        : add('ledger', 'warn', `${drift.length} key(s) edited and ${missing.length} removed since ctk wrote them`, 'run "ctk install" to see the conflicts, or "ctk rollback"')
    }
  } catch (e) {
    add('ledger', 'fail', errMsg(e), 'move ctk/ledger.json aside and run "ctk install"')
  }

  if (wantedSkills !== null) {
    // Skills that "ctk sync" writes carry the sync marker; compare them with the profile's skill list.
    const managed = existsSync(ctx.paths.skillsDir)
      ? readdirSync(ctx.paths.skillsDir).filter(n => {
          try {
            return statSync(join(ctx.paths.skillsDir, n)).isDirectory() && existsSync(join(ctx.paths.skillsDir, n, MANAGED_MARKER))
          } catch {
            return false
          }
        })
      : []
    const missing = wantedSkills.filter(n => !managed.includes(n))
    const extra = managed.filter(n => !wantedSkills.includes(n))
    if (missing.length + extra.length === 0) add('skills', 'pass', managed.length === 0 ? 'no synced skills' : `${managed.length} synced skill(s) match the profile`)
    else {
      const parts = [...(missing.length ? [`not installed: ${missing.join(', ')}`] : []), ...(extra.length ? [`not in the profile: ${extra.join(', ')}`] : [])]
      add('skills', 'warn', `synced skills differ from the profile (${parts.join('; ')})`, 'run "ctk sync" to reconcile')
    }
  }

  const problems: string[] = []
  let backups = 0
  if (existsSync(ctx.paths.backupsDir)) {
    for (const id of readdirSync(ctx.paths.backupsDir)) {
      let manifest: BackupManifest | null = null
      try {
        manifest = readJsonIfExists<BackupManifest>(join(ctx.paths.backupsDir, id, 'manifest.json'))
      } catch (e) {
        problems.push(`${id}: ${errMsg(e)}`)
      }
      if (!manifest) continue
      backups++
      problems.push(...verifyBackup(manifest).problems)
    }
  }
  problems.length === 0
    ? add('backups', 'pass', backups === 0 ? 'no backups yet' : `${backups} backup(s) restorable`)
    : add('backups', 'fail', `${problems.length} backup problem(s): ${problems[0]}`, 'keep the backups directory intact; do not edit it')

  const code = checks.some(c => c.status === 'fail') ? EXIT.error : checks.some(c => c.status === 'warn') ? EXIT.attention : EXIT.ok
  const mark = { pass: 'ok  ', warn: 'warn', fail: 'FAIL' } as const
  const lines = checks.flatMap(c => [`[${mark[c.status]}] ${c.id}: ${c.message}`, ...(c.fix && c.status !== 'pass' ? [`       fix: ${c.fix}`] : [])])
  lines.push(code === EXIT.ok ? 'all checks passed' : code === EXIT.attention ? 'passed with warnings' : 'some checks failed')
  return { code, data: { checks }, lines }
}
