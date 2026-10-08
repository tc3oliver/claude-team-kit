import { existsSync, readFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The Claude Code config dir: --config-dir, then $CLAUDE_CONFIG_DIR, then ~/.claude. */
export const resolveConfigDir = (opt?: string, env: NodeJS.ProcessEnv = process.env): string => {
  const raw = opt ?? env.CLAUDE_CONFIG_DIR
  if (raw && raw.trim() !== '') return resolve(raw.startsWith('~') ? join(homedir(), raw.slice(1)) : raw)
  return join(homedir(), '.claude')
}

/** Everything CTK owns lives under <config>/ctk. Nothing else is created outside Claude's own files. */
export const ctkPaths = (configDir: string) => {
  const ctk = join(configDir, 'ctk')
  return {
    configDir,
    /** Claude Code's user settings file. CTK edits only the keys it records in the ledger. */
    settings: join(configDir, 'settings.json'),
    ctk,
    /** Install ledger: what CTK changed and the values it replaced. */
    ledger: join(ctk, 'ledger.json'),
    /** User layer of the profile, as last applied on this device. */
    profile: join(ctk, 'profile.json'),
    devicesDir: join(ctk, 'devices'),
    deviceFile: (device: string) => join(ctk, 'devices', `${device}.json`),
    syncDir: join(ctk, 'sync'),
    /** Last-synced snapshot: the common ancestor for three-way merges. */
    syncBase: join(ctk, 'sync', 'base.json'),
    syncConflicts: join(ctk, 'sync', 'conflicts.json'),
    syncRepo: join(ctk, 'sync', 'repo'),
    syncConfig: join(ctk, 'sync', 'config.json'),
    backupsDir: join(ctk, 'backups'),
    binDir: join(ctk, 'bin'),
    statusline: join(ctk, 'bin', 'ctk-statusline.mjs'),
    statsDir: join(ctk, 'stats'),
    skillsDir: join(configDir, 'skills'),
  }
}
export type CtkPaths = ReturnType<typeof ctkPaths>

/** Device name for device-local overrides: --device, then the sanitized hostname. */
export const resolveDevice = (opt?: string): string => {
  const raw = opt ?? hostname() ?? 'device'
  const s = raw.toLowerCase().replace(/\.local$/, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return s === '' ? 'device' : s.slice(0, 48)
}

/** Profile names become file names inside the profile repo. */
export const isValidProfileName = (s: string): boolean => /^[a-z0-9][a-z0-9_-]{0,47}$/.test(s)

/** Settings commands run through Git Bash on Windows, which eats backslashes. */
export const toPosix = (p: string): string => p.replace(/\\/g, '/')

/** Root of the installed package (the directory holding package.json with name claude-team-kit). */
export const packageRoot = (): string => {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i++) {
    const pkg = join(dir, 'package.json')
    if (existsSync(pkg)) {
      try {
        if ((JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string }).name === 'claude-team-kit') return dir
      } catch {
        // keep walking
      }
    }
    dir = dirname(dir)
  }
  throw new Error('ctk: cannot locate the claude-team-kit package root')
}

export const pluginSourceDir = (root = packageRoot()): string => join(root, 'plugins', 'ctk')
export const marketplaceDir = (root = packageRoot()): string => root

export const PLUGIN_NAME = 'ctk'
export const MARKETPLACE_NAME = 'ctk-kit'
export const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`
