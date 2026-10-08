import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { runDoctor } from '../src/cli/commands/doctor.ts'
import { runInstall } from '../src/install/install.ts'
import { makeEnv, readJson, writeJson } from './helpers.ts'

const flags = { statusline: true, enableTeams: true }
const status = (r: Awaited<ReturnType<typeof runDoctor>>, id: string) => (r.data.checks as { id: string; status: string }[]).find(c => c.id === id)?.status

test('doctor passes on a healthy install (exit 0)', async t => {
  const e = makeEnv(t)
  writeFileSync(join(e.ctx.configDir, '.claude.json'), '{}')
  await runInstall(e.ctx, flags, e.root)
  const r = await runDoctor(e.ctx)
  assert.equal(r.code, 0, r.lines.join('\n'))
  assert.ok((r.data.checks as unknown[]).length >= 12)
})

test('doctor warns (exit 2) when nothing is installed yet', async t => {
  const e = makeEnv(t)
  const r = await runDoctor(e.ctx)
  assert.equal(r.code, 1, 'plugin and marketplace missing are failures')
  assert.equal(status(r, 'plugin'), 'fail')
  assert.equal(status(r, 'ledger'), 'warn')
  assert.equal(status(r, 'onboarding'), 'warn')
  assert.match(r.lines.join('\n'), /fix: run "ctk install"/)
})

test('doctor exits 2 for warnings only: edited key, disabled flag', async t => {
  const e = makeEnv(t)
  writeFileSync(join(e.ctx.configDir, '.claude.json'), '{}')
  await runInstall(e.ctx, flags, e.root)
  const s = readJson(e.ctx.paths.settings)
  s.pluginConfigs['ctk@ctk-kit'].options.maxWorkers = 9
  delete s.env
  writeJson(e.ctx.paths.settings, s)
  const r = await runDoctor(e.ctx)
  assert.equal(r.code, 2, r.lines.join('\n'))
  assert.equal(status(r, 'ledger'), 'warn')
  assert.equal(status(r, 'agent-teams'), 'warn')
})

test('doctor fails on invalid settings.json, old Claude Code warns about mods, and a damaged backup fails', async t => {
  const e = makeEnv(t, {}, { STUB_VERSION: '2.1.200' })
  writeFileSync(e.ctx.paths.settings, '{oops')
  let r = await runDoctor(e.ctx)
  assert.equal(status(r, 'settings'), 'fail')
  assert.equal(status(r, 'mods'), 'warn')
  assert.equal(r.code, 1)

  const e2 = makeEnv(t)
  writeFileSync(join(e2.ctx.configDir, '.claude.json'), '{}')
  await runInstall(e2.ctx, flags, e2.root)
  const dir = join(e2.ctx.paths.backupsDir, 'bad')
  mkdirSync(dir, { recursive: true })
  writeJson(join(dir, 'manifest.json'), { id: 'bad', op: 'x', createdAt: '', entries: [{ path: '/x', existed: true, backup: join(dir, 'gone'), sha256: 'abc' }] })
  r = await runDoctor(e2.ctx)
  assert.equal(status(r, 'backups'), 'fail')
  assert.equal(r.code, 1)
})

test('doctor fails when claude is missing', async t => {
  const e = makeEnv(t, { claudeBin: '/nonexistent/claude' })
  const r = await runDoctor(e.ctx)
  assert.equal(status(r, 'claude'), 'fail')
  assert.equal(r.code, 1)
})
