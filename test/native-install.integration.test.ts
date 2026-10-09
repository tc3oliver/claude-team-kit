import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { listPlugins, runClaude } from '../src/core/claude.ts'
import { loadLedger } from '../src/core/ledger.ts'
import { runInstall } from '../src/install/install.ts'
import { makeEnv, readJson } from './helpers.ts'

const ROOT = join(import.meta.dirname, '..')
const hasClaude = spawnSync('claude', ['--version'], { stdio: 'ignore' }).status === 0

/**
 * The native flow with the real binary and no ctk CLI. The users' flow is `claude plugin marketplace add
 * tc3oliver/claude-team-kit`; this test uses the repo directory as the source instead (no network). The github
 * source was checked by hand: settings.json gets `extraKnownMarketplaces.ctk-kit.source = { source: "github",
 * repo: "tc3oliver/claude-team-kit" }` and `plugin marketplace list --json` reports no `path` for it.
 * Scratch config dir, no model calls.
 */
test('real claude: native install works on its own, then `ctk install` adopts it without reinstalling', { skip: hasClaude ? false : 'claude not on PATH' }, async t => {
  const e = makeEnv(t)
  const ctx = { ...e.ctx }
  delete ctx.claudeBin
  const claude = async (...args: string[]) => {
    const r = await runClaude(ctx, args)
    assert.equal(r.code, 0, `claude ${args.join(' ')}: ${r.stderr || r.stdout}`)
    return r.stdout
  }

  await claude('plugin', 'marketplace', 'add', ROOT, '--json')
  await claude('plugin', 'install', 'ctk@ctk-kit', '--json')

  const plugin = (await listPlugins(ctx)).find(p => p.id === 'ctk@ctk-kit')
  assert.ok(plugin?.enabled, 'enabled')
  assert.deepEqual(plugin.errors, [])

  const details = await claude('plugin', 'details', 'ctk@ctk-kit')
  assert.equal(/Skills \((\d+)\)/.exec(details)?.[1], '4')
  assert.equal(/Agents \((\d+)\)/.exec(details)?.[1], '5')
  const alwaysOn = Number(/Always-on:\s+~(\d+) tok/.exec(details)?.[1])
  assert.ok(alwaysOn > 0 && alwaysOn < 500, `always-on context is ${alwaysOn} tokens`)

  // The mod loads with its defaults although nothing is configured: /ctk-stats needs no login and no model call.
  const stats = await claude('-p', '/ctk-stats')
  assert.match(stats, /\(cap 5\)/)

  const pluginsDir = join(ctx.configDir, 'plugins')
  const registry = () => ({ installed: readFileSync(join(pluginsDir, 'installed_plugins.json'), 'utf8'), known: readFileSync(join(pluginsDir, 'known_marketplaces.json'), 'utf8') })
  const registryBefore = registry()
  const marketplaceBefore = readJson(ctx.paths.settings).extraKnownMarketplaces

  const r = await runInstall(ctx, { statusline: true, enableTeams: true })
  assert.equal(r.code, 0, r.lines.join('\n'))
  assert.deepEqual(r.data.steps, { marketplace: 'present', plugin: 'present', statusline: 'copy', settingsKeys: 12 })
  assert.deepEqual(registry(), registryBefore, 'the plugin was adopted, not reinstalled')
  assert.deepEqual(readJson(ctx.paths.settings).extraKnownMarketplaces, marketplaceBefore, 'the marketplace entry is untouched')
  assert.deepEqual(loadLedger(ctx)?.entries.find(x => x.kind === 'plugin'), { kind: 'plugin', marketplaceAddedByCtk: false, pluginInstalledByCtk: false })
  assert.equal(readJson(ctx.paths.settings).pluginConfigs['ctk@ctk-kit'].options.maxWorkers, 5)
})
