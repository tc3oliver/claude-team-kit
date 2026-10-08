import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MODS_MIN_VERSION, parseVersion, planSpawn, resolveOnWindows, runClaude, versionAtLeast } from '../src/core/claude.ts'
import { makeEnv } from './helpers.ts'

test('version parsing and comparison', () => {
  assert.deepEqual(parseVersion('2.1.294 (Claude Code)'), [2, 1, 294])
  assert.equal(parseVersion('nope'), null)
  assert.equal(versionAtLeast('2.1.287', MODS_MIN_VERSION), true)
  assert.equal(versionAtLeast('2.1.286', MODS_MIN_VERSION), false)
  assert.equal(versionAtLeast('2.2.0', MODS_MIN_VERSION), true)
  assert.equal(versionAtLeast('10.0.0', '9.9.9'), true)
  assert.equal(versionAtLeast('garbage', '1.0.0'), false)
})

test('runClaude reports a missing binary instead of throwing and passes CLAUDE_CONFIG_DIR to the child', async t => {
  const e = makeEnv(t)
  assert.equal((await runClaude({ ...e.ctx, claudeBin: '/nonexistent/claude' }, ['--version'])).missing, true)
  const r = await runClaude(e.ctx, ['plugin', 'list', '--json'])
  assert.equal(r.code, 0)
  assert.equal(r.stdout.trim(), '[]')
})

test('Windows: claude is looked up as .exe, .cmd, .bat along PATH, and a missing binary is reported as missing (not as a shell error)', () => {
  const have = (...files: string[]) => (p: string) => files.includes(p)
  const env = { Path: 'C:\\Windows;C:\\Users\\me\\bin;C:\\tools' }
  assert.equal(resolveOnWindows('claude', env, have('C:\\Users\\me\\bin\\claude.exe')), 'C:\\Users\\me\\bin\\claude.exe')
  assert.equal(resolveOnWindows('claude', env, have('C:\\tools\\claude.cmd', 'C:\\tools\\claude.bat')), 'C:\\tools\\claude.cmd', '.cmd before .bat')
  assert.equal(resolveOnWindows('claude', env, have('C:\\Users\\me\\bin\\claude.cmd', 'C:\\tools\\claude.exe')), 'C:\\Users\\me\\bin\\claude.cmd', 'earlier PATH entry wins')
  assert.equal(resolveOnWindows('claude', env, have()), null)
  assert.equal(resolveOnWindows('C:\\x\\claude', {}, have('C:\\x\\claude.exe')), 'C:\\x\\claude.exe', 'a path is tried directly, without PATH')
  assert.equal(resolveOnWindows('/nonexistent/claude', env, have()), null)
  assert.equal(resolveOnWindows('C:\\x\\claude.cmd', {}, have('C:\\x\\claude.cmd')), 'C:\\x\\claude.cmd')

  assert.equal(planSpawn('claude', ['plugin', 'list'], env, 'win32', have()), null)
  assert.deepEqual(planSpawn('claude', ['plugin', 'list'], env, 'win32', have('C:\\tools\\claude.exe')), { file: 'C:\\tools\\claude.exe', args: ['plugin', 'list'], shell: false })
  assert.deepEqual(planSpawn('claude', ['plugin', 'install', 'a b'], env, 'win32', have('C:\\tools\\claude.cmd')), {
    file: '"C:\\tools\\claude.cmd"',
    args: ['"plugin"', '"install"', '"a b"'],
    shell: true,
  })
  assert.throws(() => planSpawn('claude', ['say "hi"'], env, 'win32', have('C:\\tools\\claude.cmd')), /double quote/)
  // elsewhere the OS reports ENOENT; scripts run under this node on every platform
  assert.deepEqual(planSpawn('claude', ['x'], env, 'linux', have()), { file: 'claude', args: ['x'], shell: false })
  assert.deepEqual(planSpawn('/s/stub.mjs', ['x'], env, 'win32', have()), { file: process.execPath, args: ['/s/stub.mjs', 'x'], shell: false })
})
