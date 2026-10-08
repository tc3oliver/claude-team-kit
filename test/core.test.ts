import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createBackup, JsonParseError, listFiles, readJsonIfExists, verifyBackup, writeFileAtomic } from '../src/core/fsx.ts'
import { deepEqual, deepMerge, flatten, fromPointer, pointerDelete, pointerGet, pointerSet, toPointer, unflatten } from '../src/core/jsonx.ts'
import { ctkPaths, isValidProfileName, resolveConfigDir, resolveDevice, toPosix } from '../src/core/paths.ts'

const tmp = () => mkdtempSync(join(tmpdir(), 'ctk-core-'))

test('pointer escaping round-trips keys with / ~ and @', () => {
  const segs = ['pluginConfigs', 'ctk@ctk-kit', 'a/b', 'c~d']
  assert.deepEqual(fromPointer(toPointer(segs)), segs)
})

test('pointerSet/Get/Delete create and prune parents', () => {
  const o = { keep: 1 } as Record<string, any>
  pointerSet(o, '/a/b/c', 5)
  assert.equal(pointerGet(o, '/a/b/c'), 5)
  assert.ok(pointerDelete(o, '/a/b/c'))
  assert.deepEqual(o, { keep: 1 })
  assert.equal(pointerDelete(o, '/a/b/c'), false)
  pointerSet(o, '/x', 1)
  assert.throws(() => pointerSet(o, '/x/y', 2))
})

test('flatten/unflatten are inverse; arrays are leaves; key order ignored by deepEqual', () => {
  const v = { b: { c: [1, 2] }, a: 1, e: {} }
  const flat = flatten(v)
  assert.deepEqual(Object.keys(flat), ['/a', '/b/c', '/e'])
  assert.ok(deepEqual(unflatten(flat), v))
  assert.ok(deepEqual({ x: 1, y: 2 }, { y: 2, x: 1 }))
})

test('deepMerge is right-biased, replaces arrays, does not mutate', () => {
  const a = { t: { n: 1, m: 2 }, s: [1] }
  const b = { t: { n: 9 }, s: [2, 3] }
  const out = deepMerge(a, b, null)
  assert.deepEqual(out, { t: { n: 9, m: 2 }, s: [2, 3] })
  assert.deepEqual(a, { t: { n: 1, m: 2 }, s: [1] })
})

test('writeFileAtomic leaves no temp files and replaces content', () => {
  const d = tmp()
  try {
    const f = join(d, 'sub', 'x.json')
    writeFileAtomic(f, 'one')
    writeFileAtomic(f, 'two')
    assert.equal(readFileSync(f, 'utf8'), 'two')
    assert.deepEqual(listFiles(d), ['sub/x.json'])
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test('invalid JSON is reported, never swallowed', () => {
  const d = tmp()
  try {
    const f = join(d, 's.json')
    writeFileSync(f, '{ not json')
    assert.throws(() => readJsonIfExists(f), JsonParseError)
    assert.equal(readJsonIfExists(join(d, 'missing.json')), null)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test('backup records absent files and verifies restorable copies', () => {
  const d = tmp()
  try {
    const f = join(d, 'settings.json')
    writeFileSync(f, '{"a":1}')
    const m = createBackup(join(d, 'backups'), 'install', [f, join(d, 'nope.json')])
    assert.equal(m.entries[0]?.existed, true)
    assert.equal(m.entries[1]?.existed, false)
    assert.deepEqual(verifyBackup(m), { ok: true, problems: [] })
    writeFileSync(m.entries[0]!.backup!, 'tampered')
    assert.equal(verifyBackup(m).ok, false)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test('paths: config dir precedence, device and profile names, posix paths', () => {
  assert.equal(resolveConfigDir('/x/y', { CLAUDE_CONFIG_DIR: '/env' }), '/x/y')
  assert.equal(resolveConfigDir(undefined, { CLAUDE_CONFIG_DIR: '/env' }), '/env')
  assert.match(resolveConfigDir(undefined, {}), /\.claude$/)
  assert.equal(resolveDevice('My-Mac.local'), 'my-mac')
  assert.equal(resolveDevice('../etc/passwd'), 'etc-passwd')
  assert.ok(isValidProfileName('work_1') && !isValidProfileName('../x') && !isValidProfileName('A'))
  assert.equal(toPosix('C:\\Users\\a\\.claude\\ctk'), 'C:/Users/a/.claude/ctk')
  assert.ok(ctkPaths('/c').ledger.endsWith('ledger.json'))
})
