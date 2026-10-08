import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MODS_MIN_VERSION, parseVersion, runClaude, versionAtLeast } from '../src/core/claude.ts'
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
