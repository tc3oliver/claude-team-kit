import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync as read, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'

import type { Ctx } from '../src/cli/context.ts'
import { ctkPaths, resolveDevice } from '../src/core/paths.ts'

/** A stand-in for `claude`: records argv to $STUB_LOG and keeps a fake plugin registry under <config>/plugins. */
export const STUB_CLAUDE = `#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
const args = process.argv.slice(2)
fs.appendFileSync(process.env.STUB_LOG, JSON.stringify(args) + '\\n')
if (args[0] === '--version') { console.log((process.env.STUB_VERSION || '2.1.294') + ' (Claude Code)'); process.exit(0) }
const cfg = process.env.CLAUDE_CONFIG_DIR
// like the real binary, any plugin command creates <config>/.claude.json
if (!fs.existsSync(path.join(cfg, '.claude.json'))) fs.writeFileSync(path.join(cfg, '.claude.json'), '{}')
const dir = path.join(cfg, 'plugins')
fs.mkdirSync(dir, { recursive: true })
const stateFile = path.join(dir, 'stub-state.json')
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { marketplaces: [], plugins: [] }
const settingsFile = path.join(cfg, 'settings.json')
const readSettings = () => (fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : {})
const save = (settings) => {
  fs.writeFileSync(stateFile, JSON.stringify(state))
  fs.writeFileSync(path.join(dir, 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: state.plugins }, null, 2))
  fs.writeFileSync(path.join(dir, 'known_marketplaces.json'), JSON.stringify(state.marketplaces, null, 2))
  if (settings) fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2))
}
const fail = (m) => { console.error(m); process.exit(1) }
if (process.env.STUB_FAIL && args.join(' ').includes(process.env.STUB_FAIL)) fail('stub: forced failure')
const [, sub, a, b] = args
if (args[0] !== 'plugin') fail('stub: unsupported ' + args.join(' '))
if (sub === 'marketplace') {
  const [, , verb, arg] = args
  if (verb === 'list') console.log(JSON.stringify(state.marketplaces))
  else if (verb === 'add') {
    const name = JSON.parse(fs.readFileSync(path.join(arg, '.claude-plugin', 'marketplace.json'), 'utf8')).name
    state.marketplaces = state.marketplaces.filter((m) => m.name !== name).concat({ name, source: 'directory', path: arg, installLocation: arg })
    const s = readSettings(); s.extraKnownMarketplaces = { ...(s.extraKnownMarketplaces || {}), [name]: { source: { source: 'directory', path: arg } } }
    save(s); console.log(JSON.stringify({ outcome: 'ok' }))
  } else if (verb === 'remove') {
    state.marketplaces = state.marketplaces.filter((m) => m.name !== arg)
    // like the real binary: removing a marketplace uninstalls its plugins and their saved options
    const gone = state.plugins.filter((p) => p.id.endsWith('@' + arg)).map((p) => p.id)
    state.plugins = state.plugins.filter((p) => !gone.includes(p.id))
    const s = readSettings(); if (s.extraKnownMarketplaces) delete s.extraKnownMarketplaces[arg]
    for (const id of gone) { if (s.enabledPlugins) delete s.enabledPlugins[id]; if (s.pluginConfigs) delete s.pluginConfigs[id] }
    save(s); console.log(JSON.stringify({ outcome: 'ok' }))
  } else if (verb === 'update') console.log(JSON.stringify({ outcome: 'ok' }))
  else fail('stub: unsupported marketplace ' + verb)
} else if (sub === 'list') console.log(JSON.stringify(state.plugins))
else if (['install', 'uninstall', 'enable', 'disable', 'update'].includes(sub)) {
  const id = a
  const mk = state.marketplaces.find((m) => id.endsWith('@' + m.name))
  if (sub === 'install') {
    if (!mk) fail('stub: marketplace not found')
    const version = JSON.parse(fs.readFileSync(path.join(mk.path, 'plugins', 'ctk', '.claude-plugin', 'plugin.json'), 'utf8')).version
    state.plugins = state.plugins.filter((p) => p.id !== id).concat({ id, version, enabled: true, scope: 'user' })
    const s = readSettings(); s.enabledPlugins = { ...(s.enabledPlugins || {}), [id]: true }; save(s)
  } else if (sub === 'uninstall') {
    state.plugins = state.plugins.filter((p) => p.id !== id)
    // like the real binary: the plugin's whole pluginConfigs entry goes with it
    const s = readSettings(); if (s.enabledPlugins) delete s.enabledPlugins[id]; if (s.pluginConfigs) delete s.pluginConfigs[id]; save(s)
  } else if (sub === 'disable') {
    state.plugins = state.plugins.map((p) => (p.id === id ? { ...p, enabled: false } : p))
    const s = readSettings(); s.enabledPlugins = { ...(s.enabledPlugins || {}), [id]: false }; save(s)
  } else if (sub === 'enable') {
    state.plugins = state.plugins.map((p) => (p.id === id ? { ...p, enabled: true } : p))
    const s = readSettings(); s.enabledPlugins = { ...(s.enabledPlugins || {}), [id]: true }; save(s)
  } else if (sub === 'update') {
    const p = state.plugins.find((x) => x.id === id)
    if (p && process.env.STUB_UPDATE_ENABLES) p.enabled = true
    if (p && mk) p.version = JSON.parse(fs.readFileSync(path.join(mk.path, 'plugins', 'ctk', '.claude-plugin', 'plugin.json'), 'utf8')).version
    save(null)
  }
  console.log(JSON.stringify({ outcome: 'ok' }))
} else fail('stub: unsupported plugin ' + sub)
`

export type Env = { dir: string; ctx: Ctx; root: string; out: string[]; err: string[]; log: () => string[][]; stub: string }

/** A temp config dir, a fake package root with a marketplace, and a stub claude. Removed after the test. */
export const makeEnv = (t: TestContext, over: Partial<Ctx> = {}, stubEnv: Record<string, string> = {}): Env => {
  const dir = mkdtempSync(join(tmpdir(), 'ctk-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const configDir = join(dir, 'cfg')
  mkdirSync(configDir, { recursive: true })
  const root = join(dir, 'pkg')
  const w = (rel: string, text: string) => {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), text)
  }
  w('package.json', JSON.stringify({ name: 'claude-team-kit', version: '0.1.0' }))
  w('.claude-plugin/marketplace.json', JSON.stringify({ name: 'ctk-kit', owner: { name: 't' }, plugins: [{ name: 'ctk', source: './plugins/ctk' }] }))
  w('plugins/ctk/.claude-plugin/plugin.json', JSON.stringify({ name: 'ctk', version: '0.1.0' }))
  w('plugins/ctk/statusline/ctk-statusline.mjs', '// statusline v1\n')
  const stub = join(dir, 'claude-stub.mjs')
  writeFileSync(stub, STUB_CLAUDE)
  chmodSync(stub, 0o755)
  const logFile = join(dir, 'stub.log')
  writeFileSync(logFile, '')
  const out: string[] = []
  const err: string[] = []
  const ctx: Ctx = {
    configDir,
    paths: ctkPaths(configDir),
    device: resolveDevice('testdev'),
    profile: 'default',
    dryRun: false,
    json: false,
    yes: false,
    env: { ...process.env, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: undefined, CLAUDE_CONFIG_DIR: undefined, STUB_LOG: logFile, ...stubEnv },
    cwd: dir,
    out: l => out.push(l),
    err: l => err.push(l),
    claudeBin: stub,
    ...over,
  }
  return { dir, ctx, root, out, err, stub, log: () => read(logFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as string[]) }
}

/** path -> sha256 + mtime for every file under dir (recursive). */
export const snapshot = (dir: string): Record<string, string> => {
  const out: Record<string, string> = {}
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name !== '.claude.json') out[p.slice(dir.length)] = `${createHash('sha256').update(read(p)).digest('hex')}@${statSync(p).mtimeMs}`
    }
  }
  walk(dir)
  return out
}

export const readJson = (p: string): any => JSON.parse(read(p, 'utf8'))
export const writeJson = (p: string, v: unknown): void => {
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, JSON.stringify(v, null, 2) + '\n')
}

/** The mutating claude calls (everything except version/list queries). */
export const mutating = (calls: string[][]): string[][] =>
  calls.filter(c => c[0] === 'plugin' && !(c[1] === 'list' || (c[1] === 'marketplace' && c[2] === 'list')))
