import { execFile, type ExecFileException } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { extname, join } from 'node:path'

import type { Ctx } from '../cli/context.ts'
import { isObject } from './jsonx.ts'
import { MARKETPLACE_NAME, PLUGIN_ID } from './paths.ts'

/** First Claude Code release with plugin mods (function hooks). */
export const MODS_MIN_VERSION = '2.1.287'

export type Run = { code: number; stdout: string; stderr: string; missing: boolean }

export const parseVersion = (s: string): [number, number, number] | null => {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(s)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** true when `version` >= `min`; unparseable -> false. */
export const versionAtLeast = (version: string, min: string): boolean => {
  const a = parseVersion(version)
  const b = parseVersion(min)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if ((a[i] as number) !== (b[i] as number)) return (a[i] as number) > (b[i] as number)
  }
  return true
}

export const isWsl = (): boolean => {
  if (process.platform !== 'linux') return false
  try {
    return /microsoft/i.test(readFileSync('/proc/version', 'utf8'))
  } catch {
    return false
  }
}

const spawnOnce = (file: string, args: string[], env: NodeJS.ProcessEnv, cwd: string, shell: boolean): Promise<Run> =>
  new Promise(resolve => {
    execFile(file, args, { env, cwd, shell, timeout: 120_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const e = err as (ExecFileException & { code?: number | string }) | null
      if (e && e.code === 'ENOENT') return resolve({ code: 127, stdout: '', stderr: String(e.message), missing: true })
      resolve({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, stdout: String(stdout), stderr: String(stderr), missing: false })
    })
  })

/**
 * The single place that spawns `claude`. Always an argv array; the child sees CLAUDE_CONFIG_DIR=<configDir>.
 * `.js/.mjs` binaries (test stubs) run under this node. On Windows a bare `claude` is tried as claude.exe,
 * then as claude.cmd, which can only run through a shell and so gets quoted arguments.
 */
export const runClaude = async (ctx: Ctx, args: string[]): Promise<Run> => {
  const env = { ...ctx.env, CLAUDE_CONFIG_DIR: ctx.configDir }
  const bin = ctx.claudeBin ?? 'claude'
  if (['.js', '.mjs', '.cjs'].includes(extname(bin))) return spawnOnce(process.execPath, [bin, ...args], env, ctx.cwd, false)
  if (process.platform !== 'win32') return spawnOnce(bin, args, env, ctx.cwd, false)
  if (/\.cmd$|\.bat$/i.test(bin)) return spawnOnce(`"${bin}"`, args.map(quoteWin), env, ctx.cwd, true)
  if (extname(bin) !== '') return spawnOnce(bin, args, env, ctx.cwd, false)
  const exe = await spawnOnce(`${bin}.exe`, args, env, ctx.cwd, false)
  return exe.missing ? spawnOnce(`"${bin}.cmd"`, args.map(quoteWin), env, ctx.cwd, true) : exe
}

const quoteWin = (a: string): string => {
  if (a.includes('"')) throw new Error(`refusing to pass an argument containing a double quote to claude.cmd: ${a}`)
  return `"${a}"`
}

/** `claude --version` -> "2.1.294", or null when claude is missing or prints no version. */
export const claudeVersion = async (ctx: Ctx): Promise<string | null> => {
  const r = await runClaude(ctx, ['--version'])
  if (r.code !== 0) return null
  const v = parseVersion(r.stdout)
  return v ? v.join('.') : null
}

export type MarketplaceInfo = { name: string; path: string | null }
/** `errors` are Claude's own load errors for the plugin, e.g. "Marketplace ctk-kit failed to load: cache-miss". */
export type PluginInfo = { id: string; version: string | null; enabled: boolean; errors: string[] }

const jsonArray = async (ctx: Ctx, args: string[]): Promise<Record<string, unknown>[]> => {
  const r = await runClaude(ctx, args)
  if (r.code !== 0) throw new Error(`claude ${args.join(' ')} failed (exit ${r.code}): ${(r.stderr || r.stdout).trim().slice(0, 300)}`)
  let parsed: unknown
  try {
    parsed = JSON.parse(r.stdout)
  } catch {
    throw new Error(`claude ${args.join(' ')} did not print JSON`)
  }
  if (!Array.isArray(parsed)) throw new Error(`claude ${args.join(' ')} did not print a JSON array`)
  return parsed.filter(isObject)
}

export const listMarketplaces = async (ctx: Ctx): Promise<MarketplaceInfo[]> =>
  (await jsonArray(ctx, ['plugin', 'marketplace', 'list', '--json'])).map(m => ({
    name: String(m.name),
    path: typeof m.path === 'string' ? m.path : typeof m.installLocation === 'string' ? m.installLocation : null,
  }))

export const listPlugins = async (ctx: Ctx): Promise<PluginInfo[]> =>
  (await jsonArray(ctx, ['plugin', 'list', '--json'])).map(p => ({
    id: String(p.id),
    version: typeof p.version === 'string' ? p.version : null,
    enabled: p.enabled === true,
    errors: Array.isArray(p.errors) ? p.errors.map(String) : [],
  }))

/** Run a mutating `claude plugin ...` command; throws with claude's own message on failure. */
export const claudePlugin = async (ctx: Ctx, args: string[]): Promise<void> => {
  const r = await runClaude(ctx, ['plugin', ...args, '--json'])
  if (r.code !== 0) throw new Error(`claude plugin ${args.join(' ')} failed (exit ${r.code}): ${(r.stderr || r.stdout).trim().slice(0, 400)}`)
}

export const pluginCommands = {
  marketplaceAdd: (ctx: Ctx, source: string) => claudePlugin(ctx, ['marketplace', 'add', source]),
  marketplaceRemove: (ctx: Ctx) => claudePlugin(ctx, ['marketplace', 'remove', MARKETPLACE_NAME]),
  marketplaceUpdate: (ctx: Ctx) => claudePlugin(ctx, ['marketplace', 'update', MARKETPLACE_NAME]),
  install: (ctx: Ctx) => claudePlugin(ctx, ['install', PLUGIN_ID, '--scope', 'user']),
  uninstall: (ctx: Ctx) => claudePlugin(ctx, ['uninstall', PLUGIN_ID, '--scope', 'user']),
  enable: (ctx: Ctx) => claudePlugin(ctx, ['enable', PLUGIN_ID, '--scope', 'user']),
  update: (ctx: Ctx) => claudePlugin(ctx, ['update', PLUGIN_ID, '--scope', 'user']),
}

/** Claude's own plugin registry files, which `claude plugin` rewrites and install/uninstall back up. */
export const registryFiles = (configDir: string): string[] => [
  join(configDir, 'plugins', 'installed_plugins.json'),
  join(configDir, 'plugins', 'known_marketplaces.json'),
]
