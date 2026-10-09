import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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

test('sync arguments are handed over after global options are removed; sync init --dry-run writes nothing', async t => {
  const e = makeEnv(t)
  const remote = join(e.dir, 'remote.git')
  assert.equal(spawnSync('git', ['init', '--bare', '-q', remote]).status, 0)
  const out: string[] = []
  const code = await main(['sync', 'init', '--remote', remote, '--config-dir', e.ctx.configDir, '--dry-run', '--json'], { out: l => out.push(l), err: l => out.push(l), env: e.ctx.env, cwd: e.dir })
  assert.equal(code, 0, out.join('\n'))
  const doc = JSON.parse(out.join('\n'))
  assert.equal(doc.command, 'sync init')
  assert.equal(doc.status, 'dry-run')
  assert.equal(doc.remote, remote)
  assert.equal(existsSync(join(e.ctx.configDir, 'ctk', 'sync')), false)
})

test('--version is the package.json version', async t => {
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { version: string }
  assert.equal((await run(t, ['--version'])).out[0], pkg.version)
})

const GLOBAL_FLAGS = ['--config-dir', '--profile', '--device', '--dry-run', '--json', '--yes', '--help', '--version']
const COMMAND_FLAGS: Record<string, string[]> = {
  install: ['--no-statusline', '--no-enable-teams'],
  doctor: [],
  update: [],
  rollback: ['--to'],
  uninstall: [],
  stats: [],
  config: ['--device-layer', '--no-apply'],
}

test('every command answers --help (and `help <command>`) with its own usage and every flag it takes', async t => {
  for (const [command, flags] of Object.entries(COMMAND_FLAGS)) {
    for (const args of [[command, '--help'], ['help', command]]) {
      const r = await run(t, args)
      assert.equal(r.code, 0, args.join(' '))
      const text = r.out.join('\n')
      assert.match(text, new RegExp(`Usage: ctk ${command}\\b`), args.join(' '))
      for (const f of [...flags, ...GLOBAL_FLAGS]) assert.ok(text.includes(f), `${args.join(' ')} should mention ${f}`)
    }
  }
})

test('ctk sync --help prints the sync usage; help for an unknown command falls back to the overview', async t => {
  const s = await run(t, ['sync', '--help'])
  assert.equal(s.code, 0)
  assert.match(s.out.join('\n'), /usage: ctk sync/)
  const u = await run(t, ['bogus', '--help'])
  assert.equal(u.code, 0)
  assert.match(u.out.join('\n'), /Commands:/)
})

test('a flag-shaped value cannot hijack the command', async t => {
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { version: string }
  // was: argv.includes('--version') fired on the VALUE and printed the version, exit 0
  const r = await run(t, ['config', 'set', 'outputStyle', '--version'])
  assert.equal(r.code, 1)
  assert.ok(!r.out.join('\n').includes(pkg.version))
  assert.ok(!r.err.join('\n').includes(pkg.version))
  // --help/--json are still accepted after the command; --version is not
  const h = await run(t, ['config', '--help'])
  assert.equal(h.code, 0)
  assert.match(h.out.join('\n'), /Usage: ctk config/)
  const v = await run(t, ['config', '--version'])
  assert.equal(v.code, 1)
  assert.ok(!v.out.join('\n').includes(pkg.version))
})

test('-v before the command prints the version; --config-dir=<dir> inline form works; doctor --json is one document', async t => {
  const e = makeEnv(t)
  const out: string[] = []
  const io = { out: (l: string) => out.push(l), err: () => {}, env: e.ctx.env, cwd: e.dir, claudeBin: e.stub }
  assert.equal(await main(['-v'], io), 0)
  assert.match(out[0] as string, /^\d+\.\d+\.\d+$/)
  out.length = 0
  assert.equal(await main([`--config-dir=${e.ctx.configDir}`, 'stats', '--json'], io), 0)
  assert.equal(out.length, 1)
  assert.equal(JSON.parse(out[0] as string).exitCode, 0)
})
