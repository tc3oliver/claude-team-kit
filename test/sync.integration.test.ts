import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

import { runSync } from '../src/cli/commands/sync.ts'
import { bareRemote, device, readProfile, registerCleanup, snapshot, writeProfile } from './sync.helpers.ts'

registerCleanup()

// Real applyProfile from src/install/apply.ts (no stub): a pulled profile reaches settings.json.
test('integration: pull applies the merged profile to settings.json through the real applyProfile', async () => {
  const remote = bareRemote()
  const a = device('laptop')
  const b = device('desktop')
  assert.equal(await a.sync('init', '--remote', remote), 0)
  writeProfile(a, { team: { maxWorkers: 5 }, hud: { statusLine: 'off' }, portable: { settings: { model: 'opus' } } })
  assert.equal(await a.sync('publish'), 0, a.out.join('\n'))

  assert.equal(await b.sync('init', '--remote', remote), 0)
  assert.equal(await runSync(['pull'], b.ctx), 0, b.out.join('\n') + b.err.join('\n'))
  const settings = JSON.parse(readFileSync(b.ctx.paths.settings, 'utf8')) as { model?: string; pluginConfigs?: Record<string, { options?: { maxWorkers?: number } }> }
  assert.equal(settings.model, 'opus')
  assert.equal(settings.pluginConfigs?.['ctk@ctk-kit']?.options?.maxWorkers, 5)
  assert.ok(existsSync(b.ctx.paths.ledger))
  assert.deepEqual((readProfile(b).team as { maxWorkers: number }).maxWorkers, 5)

  const before = snapshot(b.ctx.configDir)
  assert.equal(await runSync(['pull'], b.ctx), 0)
  assert.deepEqual(snapshot(b.ctx.configDir), before, 'a second pull leaves settings, ledger and sync state untouched')
})

test('integration: a user-owned settings value is reported as a conflict, not overwritten', async () => {
  const remote = bareRemote()
  const a = device('laptop')
  const b = device('desktop')
  await a.sync('init', '--remote', remote)
  writeProfile(a, { hud: { statusLine: 'off' }, portable: { settings: { model: 'opus' } } })
  await a.sync('publish')
  await b.sync('init', '--remote', remote)
  const { writeFileSync, mkdirSync } = await import('node:fs')
  mkdirSync(b.ctx.configDir, { recursive: true })
  writeFileSync(b.ctx.paths.settings, `${JSON.stringify({ model: 'haiku' }, null, 2)}\n`)
  assert.equal(await runSync(['pull'], b.ctx), 2, b.out.join('\n'))
  assert.equal((JSON.parse(readFileSync(b.ctx.paths.settings, 'utf8')) as { model: string }).model, 'haiku')
  assert.match(b.out.join('\n'), /settings conflict \/model/)
})
