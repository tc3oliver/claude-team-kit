import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { runDoctor } from '../src/cli/commands/doctor.ts'
import { saveUserLayer } from '../src/core/profilestore.ts'
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

test('doctor judges onboarding before any claude subprocess creates .claude.json', async t => {
  const e = makeEnv(t)
  const r = await runDoctor(e.ctx)
  assert.equal(status(r, 'onboarding'), 'warn')
  assert.match(r.lines.join('\n'), /not started yet/)
  assert.ok(existsSync(join(e.ctx.configDir, '.claude.json')), 'the claude subprocess did create it meanwhile')
  assert.equal(status(await runDoctor(e.ctx), 'onboarding'), 'pass')
})

test('doctor compares sync-marked skill directories with the profile skill list', async t => {
  const e = makeEnv(t)
  saveUserLayer(e.ctx.paths, { skills: ['alpha'] })
  assert.equal(status(await runDoctor(e.ctx), 'skills'), 'warn', 'listed but not installed')
  mkdirSync(join(e.ctx.paths.skillsDir, 'alpha'), { recursive: true })
  writeFileSync(join(e.ctx.paths.skillsDir, 'alpha', '.ctk-managed'), 'x')
  assert.equal(status(await runDoctor(e.ctx), 'skills'), 'pass')
  mkdirSync(join(e.ctx.paths.skillsDir, 'stale'), { recursive: true })
  writeFileSync(join(e.ctx.paths.skillsDir, 'stale', '.ctk-managed'), 'x')
  mkdirSync(join(e.ctx.paths.skillsDir, 'mine'), { recursive: true })
  const r = await runDoctor(e.ctx)
  assert.equal(status(r, 'skills'), 'warn')
  assert.match(r.lines.join('\n'), /not in the profile: stale/)
  assert.ok(!r.lines.join('\n').includes('mine'))
})

test('doctor fails on Claude load errors and on a marketplace whose directory is gone', async t => {
  const e = makeEnv(t)
  writeFileSync(join(e.ctx.configDir, '.claude.json'), '{}')
  await runInstall(e.ctx, flags, e.root)
  const stateFile = join(e.ctx.configDir, 'plugins', 'stub-state.json')
  const state = readJson(stateFile)
  state.plugins[0].errors = ['Marketplace ctk-kit failed to load: cache-miss']
  writeJson(stateFile, state)
  const r = await runDoctor(e.ctx)
  assert.equal(r.code, 1)
  assert.equal(status(r, 'plugin'), 'fail')
  assert.equal(status(r, 'marketplace'), 'fail')
  const text = r.lines.join('\n')
  assert.match(text, /cache-miss/)
  assert.match(text, /fix: run "ctk install" from the checkout you want to keep/)

  const gone = makeEnv(t)
  writeFileSync(join(gone.ctx.configDir, '.claude.json'), '{}')
  await runInstall(gone.ctx, flags, gone.root)
  rmSync(gone.root, { recursive: true })
  const g = await runDoctor(gone.ctx)
  assert.equal(status(g, 'marketplace'), 'fail')
  assert.match(g.lines.join('\n'), /which does not exist/)
})

test('after ctk has run claude commands the onboarding check is info, which never changes the exit code', async t => {
  const e = makeEnv(t)
  writeFileSync(join(e.ctx.configDir, '.claude.json'), '{}')
  await runInstall(e.ctx, flags, e.root)
  const r = await runDoctor(e.ctx)
  assert.equal(status(r, 'onboarding'), 'info')
  assert.equal(r.code, 0, r.lines.join('\n'))
  assert.match(r.lines.join('\n'), /\[info\] onboarding: cannot tell whether Claude Code was started interactively \(ctk's own claude commands create \.claude\.json\)/)
  assert.ok(!r.lines.join('\n').includes('fix:'))
  assert.match(r.lines.join('\n'), /all checks passed/)

  const plain = makeEnv(t) // Claude was started by the user, ctk never ran here
  writeFileSync(join(plain.ctx.configDir, '.claude.json'), '{}')
  assert.equal(status(await runDoctor(plain.ctx), 'onboarding'), 'pass')
})
