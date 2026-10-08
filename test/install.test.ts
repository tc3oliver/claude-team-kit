import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { loadLedger } from '../src/core/ledger.ts'
import { loadDeviceLayer, saveUserLayer } from '../src/core/profilestore.ts'
import { runInstall } from '../src/install/install.ts'
import { makeEnv, mutating, readJson, snapshot, writeJson } from './helpers.ts'

const flags = { statusline: true, enableTeams: true }
const OPT = '/pluginConfigs/ctk@ctk-kit/options'

test('install writes plugin, statusline, owned keys and a ledger; keeps other settings', async t => {
  const e = makeEnv(t)
  writeJson(e.ctx.paths.settings, {
    theme: 'dark',
    enabledPlugins: { 'other@market': true },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] },
    permissions: { allow: ['Bash(ls)'] },
  })
  const r = await runInstall(e.ctx, flags, e.root)
  assert.equal(r.code, 0, r.lines.join('\n'))
  const s = readJson(e.ctx.paths.settings)
  assert.deepEqual(Object.keys(s).slice(0, 4), ['theme', 'enabledPlugins', 'hooks', 'permissions'])
  assert.equal(s.theme, 'dark')
  assert.deepEqual(s.hooks, { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] })
  assert.deepEqual(s.permissions, { allow: ['Bash(ls)'] })
  assert.equal(s.enabledPlugins['other@market'], true)
  assert.equal(s.enabledPlugins['ctk@ctk-kit'], true)
  assert.equal(s.pluginConfigs['ctk@ctk-kit'].options.maxWorkers, 3)
  assert.equal(s.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, '1')
  assert.match(s.statusLine.command, /^".*node[^"]*" ".*\/ctk\/bin\/ctk-statusline\.mjs"$/)
  assert.equal(readFileSync(e.ctx.paths.statusline, 'utf8'), '// statusline v1\n')
  const ledger = loadLedger(e.ctx)
  assert.ok(ledger)
  assert.equal(ledger.transactions.length, 1)
  assert.deepEqual(ledger.entries.find(x => x.kind === 'plugin'), { kind: 'plugin', marketplaceAddedByCtk: true, pluginInstalledByCtk: true })
  assert.deepEqual(mutating(e.log()).map(c => c.slice(0, 3).join(' ')), ['plugin marketplace add', 'plugin install ctk@ctk-kit'])
})

test('second install changes no file, creates no backup or transaction, runs no mutating claude call', async t => {
  const e = makeEnv(t)
  assert.equal((await runInstall(e.ctx, flags, e.root)).code, 0)
  const before = snapshot(e.ctx.configDir)
  const calls = e.log().length
  const r = await runInstall(e.ctx, flags, e.root)
  assert.equal(r.code, 0)
  assert.deepEqual(snapshot(e.ctx.configDir), before)
  assert.equal(loadLedger(e.ctx)?.transactions.length, 1)
  assert.equal(readdirSync(e.ctx.paths.backupsDir).length, 1)
  assert.deepEqual(mutating(e.log().slice(calls)), [])
  assert.match(r.lines.join('\n'), /nothing to change/)
})

test('dry-run writes nothing and calls no mutating claude command', async t => {
  const e = makeEnv(t, { dryRun: true })
  writeJson(e.ctx.paths.settings, { theme: 'dark' })
  const before = snapshot(e.ctx.configDir)
  const r = await runInstall(e.ctx, flags, e.root)
  assert.equal(r.code, 0)
  assert.deepEqual(snapshot(e.ctx.configDir), before)
  assert.deepEqual(mutating(e.log()), [])
  assert.match(r.lines.join('\n'), /plan:/)
  assert.match(r.lines.join('\n'), /marketplace ctk-kit: add/)
})

test('a different user value is a conflict: left untouched, exit 2, everything else still installs', async t => {
  const e = makeEnv(t)
  saveUserLayer(e.ctx.paths, { portable: { settings: { model: 'opus' } } })
  writeJson(e.ctx.paths.settings, { model: 'sonnet', pluginConfigs: { 'ctk@ctk-kit': { options: { maxWorkers: 9 } } } })
  const r = await runInstall(e.ctx, flags, e.root)
  assert.equal(r.code, 2, r.lines.join('\n'))
  const s = readJson(e.ctx.paths.settings)
  assert.equal(s.model, 'sonnet')
  assert.equal(s.pluginConfigs['ctk@ctk-kit'].options.maxWorkers, 9)
  assert.equal(s.pluginConfigs['ctk@ctk-kit'].options.hudBand, true)
  const conflicts = (r.data.conflicts as { pointer: string }[]).map(c => c.pointer).sort()
  assert.deepEqual(conflicts, ['/model', `${OPT}/maxWorkers`])
  const ledger = loadLedger(e.ctx)
  assert.ok(!ledger?.entries.some(x => x.kind === 'settings-key' && x.owned && (x.pointer === '/model' || x.pointer === `${OPT}/maxWorkers`)))
  // repeating keeps reporting the conflict
  assert.equal((await runInstall(e.ctx, flags, e.root)).code, 2)
})

test('a user-edited key that CTK owns is left alone and reported', async t => {
  const e = makeEnv(t)
  assert.equal((await runInstall(e.ctx, flags, e.root)).code, 0)
  const s = readJson(e.ctx.paths.settings)
  s.pluginConfigs['ctk@ctk-kit'].options.maxWorkers = 7
  writeJson(e.ctx.paths.settings, s)
  const r = await runInstall(e.ctx, flags, e.root)
  assert.equal(r.code, 2)
  assert.equal(readJson(e.ctx.paths.settings).pluginConfigs['ctk@ctk-kit'].options.maxWorkers, 7)
})

test('invalid settings.json is never overwritten and nothing is installed', async t => {
  const e = makeEnv(t)
  writeFileSync(e.ctx.paths.settings, '{ "theme": ')
  const before = snapshot(e.ctx.configDir)
  await assert.rejects(runInstall(e.ctx, flags, e.root), /not valid JSON/)
  assert.deepEqual(snapshot(e.ctx.configDir), before)
  assert.deepEqual(mutating(e.log()), [])
})

test('a user statusLine is never replaced; the report says the HUD runs via the band', async t => {
  const e = makeEnv(t)
  const mine = { type: 'command', command: 'my-status' }
  writeJson(e.ctx.paths.settings, { statusLine: mine, env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '0' } })
  const r = await runInstall(e.ctx, flags, e.root)
  assert.equal(r.code, 0)
  const s = readJson(e.ctx.paths.settings)
  assert.deepEqual(s.statusLine, mine)
  assert.equal(s.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, '0')
  assert.match(r.lines.join('\n'), /mod band only/)
})

test('--no-statusline and --no-enable-teams are honoured and remembered in the device layer', async t => {
  const e = makeEnv(t)
  const r = await runInstall(e.ctx, { statusline: false, enableTeams: false }, e.root)
  assert.equal(r.code, 0)
  const s = readJson(e.ctx.paths.settings)
  assert.equal(s.statusLine, undefined)
  assert.equal(s.env, undefined)
  assert.ok(!existsSync(e.ctx.paths.statusline))
  assert.deepEqual(loadDeviceLayer(e.ctx.paths, e.ctx.device), { schemaVersion: 1, hud: { statusLine: 'off' }, claude: { enableAgentTeams: false } })
  const again = snapshot(e.ctx.configDir)
  assert.equal((await runInstall(e.ctx, { statusline: false, enableTeams: false }, e.root)).code, 0)
  assert.deepEqual(snapshot(e.ctx.configDir), again)
})

test('a marketplace registered from another path is a conflict and nothing changes', async t => {
  const e = makeEnv(t)
  writeJson(join(e.ctx.configDir, 'plugins', 'stub-state.json'), { marketplaces: [{ name: 'ctk-kit', source: 'directory', path: join(e.dir, 'elsewhere'), installLocation: '' }], plugins: [] })
  const r = await runInstall(e.ctx, flags, e.root)
  assert.equal(r.code, 2)
  assert.deepEqual(mutating(e.log()), [])
  assert.ok(!existsSync(e.ctx.paths.ledger))
})

test('pre-existing marketplace and plugin are not marked as installed by ctk', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  const { rmSync } = await import('node:fs')
  rmSync(e.ctx.paths.ctk, { recursive: true, force: true })
  assert.equal((await runInstall(e.ctx, flags, e.root)).code, 0)
  assert.deepEqual(loadLedger(e.ctx)?.entries.find(x => x.kind === 'plugin'), { kind: 'plugin', marketplaceAddedByCtk: false, pluginInstalledByCtk: false })
})

test('a claude failure mid-install is reported and the partial work is ledgered', async t => {
  const e = makeEnv(t, {}, { STUB_FAIL: 'install ctk@ctk-kit' })
  await assert.rejects(runInstall(e.ctx, flags, e.root), /forced failure/)
  const ledger = loadLedger(e.ctx)
  assert.ok(ledger)
  assert.deepEqual(ledger.entries.find(x => x.kind === 'plugin'), { kind: 'plugin', marketplaceAddedByCtk: true, pluginInstalledByCtk: false })
  assert.equal(ledger.transactions.length, 1)
})
