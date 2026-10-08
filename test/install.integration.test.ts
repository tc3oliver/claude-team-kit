import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { test } from 'node:test'

import { runDoctor } from '../src/cli/commands/doctor.ts'
import { listMarketplaces, listPlugins } from '../src/core/claude.ts'
import { runInstall } from '../src/install/install.ts'
import { uninstall } from '../src/install/undo.ts'
import { makeEnv, readJson, snapshot } from './helpers.ts'

const hasClaude = spawnSync('claude', ['--version'], { stdio: 'ignore' }).status === 0

// Drives the real `claude` binary against a throwaway CLAUDE_CONFIG_DIR and the real repo marketplace. No model calls.
test('real claude: install, idempotent re-install, doctor, uninstall', { skip: hasClaude ? false : 'claude not on PATH' }, async t => {
  const e = makeEnv(t)
  const ctx = { ...e.ctx }
  delete ctx.claudeBin

  const r1 = await runInstall(ctx, { statusline: true, enableTeams: true })
  assert.equal(r1.code, 0, r1.lines.join('\n'))
  const plugin = (await listPlugins(ctx)).find(p => p.id === 'ctk@ctk-kit')
  assert.ok(plugin?.enabled)
  assert.ok((await listMarketplaces(ctx)).some(m => m.name === 'ctk-kit'))
  const s = readJson(ctx.paths.settings)
  assert.equal(s.pluginConfigs['ctk@ctk-kit'].options.maxWorkers, 3)
  assert.equal(s.enabledPlugins['ctk@ctk-kit'], true)

  const before = snapshot(ctx.configDir)
  const backups = readdirSync(ctx.paths.backupsDir).length
  const r2 = await runInstall(ctx, { statusline: true, enableTeams: true })
  assert.equal(r2.code, 0, r2.lines.join('\n'))
  assert.deepEqual(snapshot(ctx.configDir), before)
  assert.equal(readdirSync(ctx.paths.backupsDir).length, backups)

  const d = await runDoctor(ctx)
  assert.notEqual(d.code, 1, d.lines.join('\n'))

  const u = await uninstall(ctx)
  assert.equal(u.code, 0, JSON.stringify(u.report))
  assert.deepEqual(await listPlugins(ctx), [])
  assert.deepEqual(await listMarketplaces(ctx), [])
  assert.deepEqual(readJson(ctx.paths.settings), {}, 'a fresh config dir is back to an empty settings.json')
  assert.deepEqual(readdirSync(ctx.paths.ctk), ['backups'])
})
