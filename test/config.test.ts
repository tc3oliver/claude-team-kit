import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { test } from 'node:test'

import { runConfig } from '../src/cli/commands/config.ts'
import { loadDeviceLayer, loadUserLayer } from '../src/core/profilestore.ts'
import { makeEnv, readJson, snapshot } from './helpers.ts'

const f = { deviceLayer: false, noApply: false }

test('config set/get/list/unset on the user layer, applying to settings.json', async t => {
  const e = makeEnv(t)
  let r = await runConfig(e.ctx, ['set', 'team.maxWorkers', '7'], f)
  assert.equal(r.code, 0, r.lines.join('\n'))
  assert.deepEqual(loadUserLayer(e.ctx.paths), { schemaVersion: 1, team: { maxWorkers: 7 } })
  assert.equal(readJson(e.ctx.paths.settings).pluginConfigs['ctk@ctk-kit'].options.maxWorkers, 7)
  r = await runConfig(e.ctx, ['get', 'team.maxWorkers'], f)
  assert.deepEqual(r.lines, ['7'])
  r = await runConfig(e.ctx, ['list'], f)
  assert.deepEqual(r.lines, ['team.maxWorkers = 7'])
  await runConfig(e.ctx, ['set', 'routing.explorer.model', 'haiku'], f)
  r = await runConfig(e.ctx, ['unset', 'team.maxWorkers'], f)
  assert.equal(r.code, 0)
  assert.equal(readJson(e.ctx.paths.settings).pluginConfigs['ctk@ctk-kit'].options.maxWorkers, 5)
  assert.equal((await runConfig(e.ctx, ['get', 'team.maxWorkers'], f)).code, 1)
})

test('config rejects invalid values and unknown keys without writing', async t => {
  const e = makeEnv(t)
  for (const args of [['set', 'team.maxWorkers', '99'], ['set', 'team.maxWorkers', 'many'], ['set', 'nope.key', '1'], ['set', '__proto__.x', '1'], ['bogus', 'x'], ['set', 'team.maxWorkers']]) {
    const r = await runConfig(e.ctx, args, f)
    assert.equal(r.code, 1, args.join(' '))
  }
  assert.equal(existsSync(e.ctx.paths.profile), false)
  assert.equal(existsSync(e.ctx.paths.settings), false)
})

test('--device-layer edits the device layer; --no-apply leaves settings alone; --dry-run writes nothing', async t => {
  const e = makeEnv(t)
  assert.equal((await runConfig(e.ctx, ['set', 'hud.band', 'false'], { deviceLayer: true, noApply: true })).code, 0)
  assert.deepEqual(loadDeviceLayer(e.ctx.paths, e.ctx.device), { schemaVersion: 1, hud: { band: false } })
  assert.equal(loadUserLayer(e.ctx.paths), null)
  assert.equal(existsSync(e.ctx.paths.settings), false)
  const before = snapshot(e.ctx.configDir)
  const r = await runConfig({ ...e.ctx, dryRun: true }, ['set', 'team.maxWorkers', '4'], f)
  assert.equal(r.code, 0)
  assert.deepEqual(snapshot(e.ctx.configDir), before)
})

test('config set that hits a user-owned settings value reports a conflict (exit 2) but saves the layer', async t => {
  const e = makeEnv(t)
  const { writeJson } = await import('./helpers.ts')
  writeJson(e.ctx.paths.settings, { model: 'sonnet' })
  const r = await runConfig(e.ctx, ['set', 'portable.settings.model', 'opus'], f)
  assert.equal(r.code, 2)
  assert.equal(readJson(e.ctx.paths.settings).model, 'sonnet')
  assert.equal(loadUserLayer(e.ctx.paths)?.portable?.settings?.model, 'opus')
})
