import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { runConfig } from '../src/cli/commands/config.ts'
import { loadLedger, saveLedger } from '../src/core/ledger.ts'
import { saveUserLayer } from '../src/core/profilestore.ts'
import { runInstall } from '../src/install/install.ts'
import { rollback, uninstall } from '../src/install/undo.ts'
import { makeEnv, mutating, readJson, snapshot, writeJson } from './helpers.ts'

const flags = { statusline: true, enableTeams: true }
const cfgFlags = { deviceLayer: false, noApply: false }
const registry = (e: ReturnType<typeof makeEnv>) => readJson(join(e.ctx.configDir, 'plugins', 'stub-state.json'))

test('uninstall restores settings, removes plugin/marketplace/ctk dir, keeps backups and foreign keys', async t => {
  const e = makeEnv(t)
  saveUserLayer(e.ctx.paths, { portable: { settings: { model: 'opus' } } })
  writeJson(e.ctx.paths.settings, { theme: 'dark', env: { OTHER: '1' }, enabledPlugins: { 'other@market': true }, hooks: { Stop: [] } })
  await runInstall(e.ctx, flags, e.root)
  assert.equal(readJson(e.ctx.paths.settings).model, 'opus')
  const r = await uninstall(e.ctx)
  assert.equal(r.code, 0, JSON.stringify(r.report))
  const s = readJson(e.ctx.paths.settings)
  assert.equal(s.theme, 'dark')
  assert.deepEqual(s.env, { OTHER: '1' })
  assert.deepEqual(s.hooks, { Stop: [] })
  assert.equal(s.enabledPlugins['other@market'], true)
  for (const k of ['model', 'pluginConfigs', 'statusLine']) assert.equal(s[k], undefined, k)
  assert.deepEqual(registry(e).plugins, [])
  assert.deepEqual(registry(e).marketplaces, [])
  assert.deepEqual(readdirSync(e.ctx.paths.ctk), ['backups'])
  assert.ok(readdirSync(e.ctx.paths.backupsDir).length >= 2)
})

test('uninstall leaves a marketplace it did not add, and keys the user edited after install', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root) // registers the marketplace
  const { rmSync } = await import('node:fs')
  rmSync(e.ctx.paths.ctk, { recursive: true, force: true })
  const fresh = readJson(e.ctx.paths.settings)
  for (const k of ['pluginConfigs', 'env', 'statusLine']) delete fresh[k]
  writeJson(e.ctx.paths.settings, fresh)
  assert.equal((await runInstall(e.ctx, flags, e.root)).code, 0) // plugin and marketplace pre-exist: ctk owns the keys only
  assert.deepEqual(loadLedger(e.ctx)?.entries.find(x => x.kind === 'plugin'), { kind: 'plugin', marketplaceAddedByCtk: false, pluginInstalledByCtk: false })
  const s = readJson(e.ctx.paths.settings)
  s.pluginConfigs['ctk@ctk-kit'].options.maxWorkers = 8
  writeJson(e.ctx.paths.settings, s)
  const r = await uninstall(e.ctx)
  assert.equal(r.code, 2)
  assert.deepEqual(r.report.conflicts.map(c => c.key), ['/pluginConfigs/ctk@ctk-kit/options/maxWorkers'])
  const after = readJson(e.ctx.paths.settings)
  assert.deepEqual(after.pluginConfigs, { 'ctk@ctk-kit': { options: { maxWorkers: 8 } } })
  assert.equal(after.statusLine, undefined)
  assert.equal(registry(e).marketplaces.length, 1)
})

test('uninstall --dry-run writes nothing', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  const before = snapshot(e.ctx.configDir)
  const calls = e.log().length
  const r = await uninstall({ ...e.ctx, dryRun: true })
  assert.equal(r.code, 0)
  assert.ok(r.report.reverted.length > 0)
  assert.deepEqual(snapshot(e.ctx.configDir), before)
  assert.deepEqual(mutating(e.log().slice(calls)), [])
})

test('uninstall without a ledger owns nothing and changes nothing', async t => {
  const e = makeEnv(t)
  writeJson(e.ctx.paths.settings, { theme: 'dark' })
  const before = snapshot(e.ctx.configDir)
  const r = await uninstall(e.ctx)
  assert.equal(r.code, 0)
  assert.deepEqual(snapshot(e.ctx.configDir), before)
})

test('rollback undoes the install transaction exactly, then reports nothing left', async t => {
  const e = makeEnv(t)
  writeJson(e.ctx.paths.settings, { theme: 'dark' })
  await runInstall(e.ctx, flags, e.root)
  const backups = readdirSync(e.ctx.paths.backupsDir).length
  const r = await rollback(e.ctx)
  assert.equal(r.code, 0, JSON.stringify(r.report))
  const s = readJson(e.ctx.paths.settings)
  assert.equal(s.theme, 'dark')
  for (const k of ['pluginConfigs', 'env', 'statusLine']) assert.equal(s[k], undefined, k)
  assert.ok(!existsSync(e.ctx.paths.statusline))
  assert.deepEqual(registry(e).plugins, [])
  assert.ok(readdirSync(e.ctx.paths.backupsDir).length > backups, 'rollback adds a backup, deletes none')
  assert.equal(loadLedger(e.ctx)?.transactions[0]?.undoneAt !== undefined, true)
  assert.match((await rollback(e.ctx)).report.notes.join(), /nothing to roll back/)
})

test('rollback restores the previous value of an updated key', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  assert.equal((await runConfig(e.ctx, ['set', 'team.maxWorkers', '5'], cfgFlags)).code, 0)
  assert.equal(readJson(e.ctx.paths.settings).pluginConfigs['ctk@ctk-kit'].options.maxWorkers, 5)
  const r = await rollback(e.ctx)
  assert.equal(r.code, 0)
  assert.equal(readJson(e.ctx.paths.settings).pluginConfigs['ctk@ctk-kit'].options.maxWorkers, 3)
  // the install transaction is still intact and undoable
  assert.equal((await rollback(e.ctx)).code, 0)
  assert.equal(readJson(e.ctx.paths.settings).pluginConfigs, undefined)
})

test('rollback refuses to overwrite a value the user changed after the transaction', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  await runConfig(e.ctx, ['set', 'team.maxWorkers', '5'], cfgFlags)
  const s = readJson(e.ctx.paths.settings)
  s.pluginConfigs['ctk@ctk-kit'].options.maxWorkers = 8
  writeJson(e.ctx.paths.settings, s)
  const r = await rollback(e.ctx)
  assert.equal(r.code, 2)
  assert.equal(readJson(e.ctx.paths.settings).pluginConfigs['ctk@ctk-kit'].options.maxWorkers, 8)
  assert.equal(r.report.conflicts[0]?.key, '/pluginConfigs/ctk@ctk-kit/options/maxWorkers')
})

test('rollback --to undoes that transaction and every later one; unknown ids fail', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  await runConfig(e.ctx, ['set', 'team.maxWorkers', '5'], cfgFlags)
  await runConfig(e.ctx, ['set', 'hud.band', 'false'], cfgFlags)
  const ids = loadLedger(e.ctx)?.transactions.map(x => x.id) ?? []
  assert.equal(ids.length, 3)
  assert.equal((await rollback(e.ctx, 'nope')).code, 1)
  const r = await rollback(e.ctx, ids[1])
  assert.deepEqual(r.undone, [ids[2], ids[1]])
  const o = readJson(e.ctx.paths.settings).pluginConfigs['ctk@ctk-kit'].options
  assert.equal(o.maxWorkers, 3)
  assert.equal(o.hudBand, true)
  assert.equal((await rollback(e.ctx, ids[1])).code, 1)
})

test('a user-edited statusline script is kept by rollback and the entry is released', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  const { writeFileSync } = await import('node:fs')
  writeFileSync(e.ctx.paths.statusline, '// mine\n')
  const r = await rollback(e.ctx)
  assert.equal(r.code, 2)
  assert.ok(existsSync(e.ctx.paths.statusline))
  assert.ok(!loadLedger(e.ctx)?.entries.some(x => x.kind === 'file'))
})

test('a corrupt ledger is reported, not replaced', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  const ledger = loadLedger(e.ctx)
  assert.ok(ledger)
  saveLedger(e.ctx, ledger)
  const { writeFileSync } = await import('node:fs')
  writeFileSync(e.ctx.paths.ledger, '{"schemaVersion": 2}')
  await assert.rejects(rollback(e.ctx), /invalid ledger/)
  await assert.rejects(runInstall(e.ctx, flags, e.root), /invalid ledger/)
})
