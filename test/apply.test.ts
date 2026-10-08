import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { loadLedger } from '../src/core/ledger.ts'
import { DEFAULT_PROFILE, type Profile } from '../src/core/schema.ts'
import { applyProfile, materializeSkills } from '../src/install/apply.ts'
import { isCtkStatusLine, statuslineCommand } from '../src/install/statusline.ts'
import { makeEnv, readJson, snapshot, writeJson } from './helpers.ts'

const profile = (over: Partial<Profile> = {}): Profile => ({ ...structuredClone(DEFAULT_PROFILE), ...over })
const withModel = (m?: string): Profile => profile({ portable: { settings: m ? { model: m } : {} } })

test('applyProfile on a fresh dir writes owned keys once; the second call is a no-op', async t => {
  const e = makeEnv(t)
  const r1 = await applyProfile(e.ctx, withModel('opus'), { op: 'sync' })
  assert.equal(r1.changed, true)
  assert.deepEqual(r1.conflicts, [])
  assert.match(r1.skipped.join(), /status line script is not installed/)
  const s = readJson(e.ctx.paths.settings)
  assert.equal(s.model, 'opus')
  assert.equal(s.statusLine, undefined)
  const before = snapshot(e.ctx.configDir)
  const r2 = await applyProfile(e.ctx, withModel('opus'), { op: 'sync' })
  assert.equal(r2.changed, false)
  assert.deepEqual(snapshot(e.ctx.configDir), before)
  assert.equal(loadLedger(e.ctx)?.transactions.length, 1)
})

test('applyProfile --dry-run reports the change and writes nothing', async t => {
  const e = makeEnv(t, { dryRun: true })
  const r = await applyProfile(e.ctx, withModel('opus'))
  assert.equal(r.changed, true)
  assert.deepEqual(readdirSync(e.ctx.configDir), [])
})

test('a changed portable value is updated and a dropped one is restored to absent', async t => {
  const e = makeEnv(t)
  await applyProfile(e.ctx, withModel('opus'))
  await applyProfile(e.ctx, withModel('haiku'))
  assert.equal(readJson(e.ctx.paths.settings).model, 'haiku')
  await applyProfile(e.ctx, withModel())
  assert.equal(readJson(e.ctx.paths.settings).model, undefined)
  assert.ok(!loadLedger(e.ctx)?.entries.some(x => x.kind === 'settings-key' && x.pointer === '/model'))
})

test('a user value in a managed key is a conflict; an equal one is adopted but never removed', async t => {
  const e = makeEnv(t)
  writeJson(e.ctx.paths.settings, { model: 'sonnet', effortLevel: 'high' })
  const p = profile({ portable: { settings: { model: 'opus', effortLevel: 'high' } } })
  const r = await applyProfile(e.ctx, p)
  assert.deepEqual(r.conflicts.map(c => c.pointer), ['/model'])
  assert.equal(readJson(e.ctx.paths.settings).model, 'sonnet')
  await applyProfile(e.ctx, withModel())
  const s = readJson(e.ctx.paths.settings)
  assert.equal(s.effortLevel, 'high', 'adopted key is not removed')
  assert.equal(s.model, 'sonnet')
})

test('a key that changed under a no-longer-managed entry is kept', async t => {
  const e = makeEnv(t)
  await applyProfile(e.ctx, withModel('opus'))
  writeJson(e.ctx.paths.settings, { ...readJson(e.ctx.paths.settings), model: 'mine' })
  const r = await applyProfile(e.ctx, withModel())
  assert.equal(readJson(e.ctx.paths.settings).model, 'mine')
  assert.match(r.skipped.join(), /no longer managed/)
})

test('a non-object in the way of a pointer is a conflict, not a crash', async t => {
  const e = makeEnv(t)
  writeJson(e.ctx.paths.settings, { env: 'oops' })
  const r = await applyProfile(e.ctx, profile())
  assert.ok(r.conflicts.some(c => c.pointer === '/env/CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'))
  assert.equal(readJson(e.ctx.paths.settings).env, 'oops')
})

test('invalid settings.json is refused by applyProfile', async t => {
  const e = makeEnv(t)
  writeFileSync(e.ctx.paths.settings, '[1,2')
  const before = snapshot(e.ctx.configDir)
  await assert.rejects(applyProfile(e.ctx, profile()), /not valid JSON/)
  assert.deepEqual(snapshot(e.ctx.configDir), before)
})

test('the indentation and trailing newline of settings.json are kept', async t => {
  const e = makeEnv(t)
  writeFileSync(e.ctx.paths.settings, '{\n\t"theme": "dark"\n}')
  await applyProfile(e.ctx, withModel('opus'))
  const text = readFileSync(e.ctx.paths.settings, 'utf8')
  assert.match(text, /^\{\n\t"theme": "dark",/)
  assert.ok(!text.endsWith('\n'))
})

test('statusline command: forward slashes and quoting for win32-style paths', () => {
  assert.equal(
    statuslineCommand('C:\\Program Files\\nodejs\\node.exe', 'C:\\Users\\Me Too\\.claude\\ctk\\bin\\ctk-statusline.mjs'),
    '"C:/Program Files/nodejs/node.exe" "C:/Users/Me Too/.claude/ctk/bin/ctk-statusline.mjs"',
  )
  assert.equal(statuslineCommand('/usr/bin/node', '/home/a/.claude/ctk/bin/ctk-statusline.mjs'), '"/usr/bin/node" "/home/a/.claude/ctk/bin/ctk-statusline.mjs"')
  assert.ok(isCtkStatusLine({ type: 'command', command: statuslineCommand('C:\\n\\node.exe', 'D:\\cfg\\ctk\\bin\\ctk-statusline.mjs') }))
  assert.ok(!isCtkStatusLine({ type: 'command', command: 'my-script' }))
  assert.ok(!isCtkStatusLine(undefined))
})

const skillRepo = (dir: string, files: Record<string, string>): string => {
  const repo = join(dir, 'repo-skills')
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(repo, rel, '..'), { recursive: true })
    writeFileSync(join(repo, rel), text)
  }
  return repo
}

test('materializeSkills copies with a marker, is idempotent, updates, and removes dropped skills', async t => {
  const e = makeEnv(t)
  const repo = skillRepo(e.dir, { 'a/SKILL.md': 'A1', 'a/references/x.md': 'X', 'b/SKILL.md': 'B' })
  const r1 = await materializeSkills(e.ctx, ['a', 'b'], repo)
  assert.deepEqual(r1.written, ['a', 'b'])
  assert.ok(existsSync(join(e.ctx.paths.skillsDir, 'a', '.ctk-managed')))
  assert.equal(readFileSync(join(e.ctx.paths.skillsDir, 'a', 'references', 'x.md'), 'utf8'), 'X')
  const before = snapshot(e.ctx.configDir)
  const r2 = await materializeSkills(e.ctx, ['a', 'b'], repo)
  assert.deepEqual(r2.unchanged, ['a', 'b'])
  assert.deepEqual(snapshot(e.ctx.configDir), before)
  writeFileSync(join(repo, 'a', 'SKILL.md'), 'A2')
  assert.deepEqual((await materializeSkills(e.ctx, ['a', 'b'], repo)).written, ['a'])
  assert.equal(readFileSync(join(e.ctx.paths.skillsDir, 'a', 'SKILL.md'), 'utf8'), 'A2')
  const r4 = await materializeSkills(e.ctx, ['a'], repo)
  assert.equal(r4.removed.length, 1)
  assert.ok(!existsSync(join(e.ctx.paths.skillsDir, 'b')))
})

test('materializeSkills never touches a directory without the marker or a locally edited managed skill', async t => {
  const e = makeEnv(t)
  const repo = skillRepo(e.dir, { 'mine/SKILL.md': 'repo', 'a/SKILL.md': 'A' })
  mkdirSync(join(e.ctx.paths.skillsDir, 'mine'), { recursive: true })
  writeFileSync(join(e.ctx.paths.skillsDir, 'mine', 'SKILL.md'), 'user')
  const r = await materializeSkills(e.ctx, ['mine'], repo)
  assert.equal(r.conflicts.length, 1)
  assert.equal(readFileSync(join(e.ctx.paths.skillsDir, 'mine', 'SKILL.md'), 'utf8'), 'user')
  await materializeSkills(e.ctx, ['a'], repo)
  writeFileSync(join(e.ctx.paths.skillsDir, 'a', 'SKILL.md'), 'edited')
  const r2 = await materializeSkills(e.ctx, [], repo)
  assert.deepEqual(r2.removed, [], 'edited managed skill is not deleted')
  assert.equal(readFileSync(join(e.ctx.paths.skillsDir, 'a', 'SKILL.md'), 'utf8'), 'edited')
  assert.equal((await materializeSkills(e.ctx, ['../x'], repo)).conflicts.length, 1)
})
