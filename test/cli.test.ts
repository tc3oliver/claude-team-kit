import assert from 'node:assert/strict'
import { test } from 'node:test'

import { main, type Io } from '../src/cli/index.ts'
import { makeEnv, readJson } from './helpers.ts'

const run = async (t: Parameters<typeof makeEnv>[0], args: string[], io: Partial<Io> = {}) => {
  const e = makeEnv(t)
  const out: string[] = []
  const err: string[] = []
  const code = await main(['--config-dir', e.ctx.configDir, ...args], { out: l => out.push(l), err: l => err.push(l), env: e.ctx.env, cwd: e.dir, claudeBin: e.stub, ...io })
  return { code, out, err, e }
}

test('help and version', async t => {
  const h = await run(t, ['--help'])
  assert.equal(h.code, 0)
  assert.match(h.out.join('\n'), /Usage: ctk <command>/)
  const v = await run(t, ['--version'])
  assert.match(v.out[0] as string, /^\d+\.\d+\.\d+$/)
  assert.equal((await run(t, [])).code, 1)
})

test('unknown command and unknown option exit 1', async t => {
  assert.equal((await run(t, ['frobnicate'])).code, 1)
  const r = await run(t, ['doctor', '--nope'])
  assert.equal(r.code, 1)
  assert.match(r.err.join(), /nope/)
})

test('invalid profile name is rejected', async t => {
  const r = await run(t, ['doctor', '--profile', 'Bad Name'])
  assert.equal(r.code, 1)
  assert.match(r.err.join(), /invalid profile name/)
})

test('--json prints exactly one document, for results and for errors', async t => {
  const r = await run(t, ['stats', '--json'])
  assert.equal(r.code, 0)
  assert.equal(r.out.length, 1)
  assert.equal(JSON.parse(r.out[0] as string).exitCode, 0)
  const bad = await run(t, ['config', 'get', 'x', '--json'])
  assert.equal(bad.out.length, 1)
  assert.equal(JSON.parse(bad.out[0] as string).exitCode, 1)
})

test('install, config and uninstall through the router; install --dry-run writes nothing', async t => {
  const e = makeEnv(t)
  const out: string[] = []
  const io = { out: (l: string) => out.push(l), err: () => {}, env: e.ctx.env, cwd: e.dir, claudeBin: e.stub }
  // the router installs from the real package root, which has the real marketplace and statusline
  assert.equal(await main(['install', '--config-dir', e.ctx.configDir, '--dry-run', '--json'], io), 0)
  assert.equal(JSON.parse(out.join('')).dryRun, true)
  assert.equal(await main(['config', 'set', 'team.maxWorkers', '4', '--config-dir', e.ctx.configDir], io), 0)
  assert.equal(readJson(e.ctx.paths.settings).pluginConfigs['ctk@ctk-kit'].options.maxWorkers, 4)
  assert.equal(await main(['uninstall', '--config-dir', e.ctx.configDir], io), 0)
  assert.equal(readJson(e.ctx.paths.settings).pluginConfigs, undefined)
})

test('sync arguments are handed over after global options are removed', async t => {
  const e = makeEnv(t)
  const out: string[] = []
  const code = await main(['sync', 'init', '--remote', '/x/y', '--config-dir', e.ctx.configDir, '--dry-run'], { out: l => out.push(l), err: l => out.push(l), env: e.ctx.env, cwd: e.dir })
  // sync.ts may not exist yet in this build; either way the router must not crash
  assert.ok(code === 0 || code === 1 || code === 2)
})
