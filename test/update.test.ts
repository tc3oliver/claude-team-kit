import assert from 'node:assert/strict'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { runInstall } from '../src/install/install.ts'
import { rollback } from '../src/install/undo.ts'
import { runUpdate } from '../src/install/update.ts'
import { loadLedger } from '../src/core/ledger.ts'
import { makeEnv, mutating, snapshot, writeJson } from './helpers.ts'

const flags = { statusline: true, enableTeams: true }

const bump = (root: string, version: string, script: string) => {
  writeJson(join(root, 'plugin', 'ctk', '.claude-plugin', 'plugin.json'), { name: 'ctk', version })
  writeFileSync(join(root, 'plugin', 'ctk', 'statusline', 'ctk-statusline.mjs'), script)
}

test('update refreshes the plugin and the status line script, backs up first, and is idempotent', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  bump(e.root, '0.2.0', '// statusline v2\n')
  const backups = readdirSync(e.ctx.paths.backupsDir).length
  const calls = e.log().length
  const r = await runUpdate(e.ctx, e.root)
  assert.equal(r.code, 0, r.lines.join('\n'))
  assert.deepEqual(mutating(e.log().slice(calls)).map(c => c.slice(0, 3).join(' ')), ['plugin marketplace update', 'plugin update ctk@ctk-kit'])
  assert.equal(readFileSync(e.ctx.paths.statusline, 'utf8'), '// statusline v2\n')
  assert.equal(readdirSync(e.ctx.paths.backupsDir).length, backups + 1)
  assert.match(r.lines.join('\n'), /npm install -g claude-team-kit@latest/)
  const before = snapshot(e.ctx.configDir)
  const again = await runUpdate(e.ctx, e.root)
  assert.equal(again.code, 0)
  assert.deepEqual(snapshot(e.ctx.configDir), before)
  assert.match(again.lines.join('\n'), /already up to date/)
})

test('rolling back an update restores the previous status line script from the backup', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  bump(e.root, '0.2.0', '// statusline v2\n')
  await runUpdate(e.ctx, e.root)
  const r = await rollback(e.ctx)
  assert.equal(r.code, 0, JSON.stringify(r.report))
  assert.equal(readFileSync(e.ctx.paths.statusline, 'utf8'), '// statusline v1\n')
  assert.equal(loadLedger(e.ctx)?.entries.find(x => x.kind === 'file')?.kind, 'file')
})

test('update --dry-run changes nothing; update without an install fails', async t => {
  const e = makeEnv(t, { dryRun: true })
  const r0 = await runUpdate(e.ctx, e.root)
  assert.equal(r0.code, 1)
  const live = { ...e.ctx, dryRun: false }
  await runInstall(live, flags, e.root)
  bump(e.root, '0.2.0', '// statusline v2\n')
  const before = snapshot(e.ctx.configDir)
  const r = await runUpdate(e.ctx, e.root)
  assert.equal(r.code, 0)
  assert.deepEqual(snapshot(e.ctx.configDir), before)
  assert.match(r.lines.join('\n'), /0\.1\.0 -> 0\.2\.0/)
})
