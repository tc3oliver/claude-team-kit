import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { test } from 'node:test'

import { loadLedger, saveLedger } from '../src/core/ledger.ts'
import { DEFAULT_PROFILE, type Profile } from '../src/core/schema.ts'
import { applyProfile } from '../src/install/apply.ts'
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

test('statusline command, win32: forward slashes, double quotes, hostile characters refused', () => {
  assert.equal(
    statuslineCommand('C:\\Program Files\\nodejs\\node.exe', 'C:\\Users\\Me Too\\.claude\\ctk\\bin\\ctk-statusline.mjs', 'win32'),
    '"C:/Program Files/nodejs/node.exe" "C:/Users/Me Too/.claude/ctk/bin/ctk-statusline.mjs"',
  )
  for (const bad of ['C:\\a"b\\x.mjs', 'C:\\a$b\\x.mjs', 'C:\\a`b\\x.mjs', 'C:\\a%PATH%\\x.mjs']) {
    assert.throws(() => statuslineCommand('C:\\n\\node.exe', bad, 'win32'), /cannot build a safe status line command/, bad)
    assert.throws(() => statuslineCommand(bad, 'C:\\x.mjs', 'win32'), /cannot build/, bad)
  }
  assert.ok(isCtkStatusLine({ type: 'command', command: statuslineCommand('C:\\n\\node.exe', 'D:\\cfg\\ctk\\bin\\ctk-statusline.mjs', 'win32') }))
})

test('statusline command, POSIX: single-quoted, so spaces, $ and quotes in paths are inert', () => {
  assert.equal(statuslineCommand('/usr/bin/node', '/home/a/.claude/ctk/bin/ctk-statusline.mjs', 'linux'), "'/usr/bin/node' '/home/a/.claude/ctk/bin/ctk-statusline.mjs'")
  const script = "/home/it's $HOME/my dir/`id`/ctk/bin/ctk-statusline.mjs"
  const cmd = statuslineCommand('/opt/n o/node', script, 'darwin')
  assert.equal(cmd, "'/opt/n o/node' '/home/it'\\''s $HOME/my dir/`id`/ctk/bin/ctk-statusline.mjs'")
  // a real shell must hand both paths back verbatim
  const out = spawnSync('sh', ['-c', `printf '%s\\n' ${cmd}`], { encoding: 'utf8' }).stdout.split('\n')
  assert.deepEqual(out.slice(0, 2), ['/opt/n o/node', script])
  assert.ok(isCtkStatusLine({ type: 'command', command: cmd }))
  assert.ok(isCtkStatusLine({ type: 'command', command: '"/n/node" "/x/ctk/bin/ctk-statusline.mjs"' }), 'older double-quoted form is still recognised')
  assert.ok(!isCtkStatusLine({ type: 'command', command: 'my-script' }))
  assert.ok(!isCtkStatusLine(undefined))
})

test('a key the user deleted after CTK wrote it stays deleted, is noted, and exits without conflict', async t => {
  const e = makeEnv(t)
  await applyProfile(e.ctx, withModel('opus'))
  const s = readJson(e.ctx.paths.settings)
  delete s.model
  writeJson(e.ctx.paths.settings, s)
  const r = await applyProfile(e.ctx, withModel('opus'))
  assert.deepEqual(r.conflicts, [])
  assert.match(r.skipped.join('\n'), /\/model: removed by you since CTK wrote it; not re-added/)
  assert.equal(readJson(e.ctx.paths.settings).model, undefined)
  const entry = loadLedger(e.ctx)?.entries.find(x => x.kind === 'settings-key' && x.pointer === '/model')
  assert.equal(entry?.kind === 'settings-key' && entry.owned, false)
  const again = await applyProfile(e.ctx, withModel('opus'))
  assert.equal(readJson(e.ctx.paths.settings).model, undefined)
  assert.deepEqual(again.conflicts, [])
})

test('a crash between the ledger save and the settings write is finished by the next run', async t => {
  const e = makeEnv(t)
  await applyProfile(e.ctx, profile())
  // what a crash leaves: ledger says maxWorkers=7 (pending, settings still 5); settings.json untouched
  const ledger = loadLedger(e.ctx)
  assert.ok(ledger)
  const ptr = '/pluginConfigs/ctk@ctk-kit/options/maxWorkers'
  ledger.entries = ledger.entries.map(x => (x.kind === 'settings-key' && x.pointer === ptr ? { ...x, written: 7, pending: { value: 5 } } : x))
  saveLedger(e.ctx, ledger)
  assert.equal(readJson(e.ctx.paths.settings).pluginConfigs['ctk@ctk-kit'].options.maxWorkers, 5)
  const r = await applyProfile(e.ctx, profile({ team: { maxWorkers: 7, hint: true } }))
  assert.deepEqual(r.conflicts, [])
  assert.equal(readJson(e.ctx.paths.settings).pluginConfigs['ctk@ctk-kit'].options.maxWorkers, 7)
  const entry = loadLedger(e.ctx)?.entries.find(x => x.kind === 'settings-key' && x.pointer === ptr)
  assert.ok(entry?.kind === 'settings-key' && entry.owned && entry.pending === undefined && entry.written === 7)
  assert.equal(loadLedger(e.ctx)?.entries.some(x => x.kind === 'settings-key' && x.pending !== undefined), false)
})

const TASK = 'CLAUDE_CODE_ENABLE_TODO_TOOLS'
const withTaskTools = (on: boolean): Profile => profile({ claude: { enableAgentTeams: false, enableTaskTools: on } })

test('enableTaskTools owns env.CLAUDE_CODE_ENABLE_TODO_TOOLS=1 like the agent-teams key: written once, idempotent, removed when switched off', async t => {
  const e = makeEnv(t)
  const dry = await applyProfile({ ...e.ctx, dryRun: true }, withTaskTools(true))
  assert.equal(dry.changed, true)
  assert.deepEqual(readdirSync(e.ctx.configDir), [], 'dry-run writes nothing')
  const r = await applyProfile(e.ctx, withTaskTools(true))
  assert.deepEqual(r.conflicts, [])
  assert.equal(readJson(e.ctx.paths.settings).env[TASK], '1')
  const before = snapshot(e.ctx.configDir)
  assert.equal((await applyProfile(e.ctx, withTaskTools(true))).changed, false)
  assert.deepEqual(snapshot(e.ctx.configDir), before)
  await applyProfile(e.ctx, withTaskTools(false))
  assert.equal(readJson(e.ctx.paths.settings).env?.[TASK], undefined)
})

test('enableTaskTools: a value of the user is kept with a note; an equal one is adopted and never removed', async t => {
  const e = makeEnv(t)
  writeJson(e.ctx.paths.settings, { env: { [TASK]: '0' } })
  const r = await applyProfile(e.ctx, withTaskTools(true))
  assert.deepEqual(r.conflicts, [])
  assert.match(r.skipped.join('\n'), /CLAUDE_CODE_ENABLE_TODO_TOOLS: already set to a different value; left unchanged/)
  assert.equal(readJson(e.ctx.paths.settings).env[TASK], '0')

  const f = makeEnv(t)
  writeJson(f.ctx.paths.settings, { env: { [TASK]: '1' } })
  await applyProfile(f.ctx, withTaskTools(true))
  await applyProfile(f.ctx, withTaskTools(false))
  assert.equal(readJson(f.ctx.paths.settings).env[TASK], '1', 'not ours, never removed')
})

test('enableTaskTools off never writes the key and never touches a user\'s own', async t => {
  const e = makeEnv(t)
  await applyProfile(e.ctx, withTaskTools(false))
  assert.equal(readJson(e.ctx.paths.settings).env?.[TASK], undefined)
  writeJson(e.ctx.paths.settings, { ...readJson(e.ctx.paths.settings), env: { [TASK]: '1', OTHER: 'x' } })
  assert.equal((await applyProfile(e.ctx, withTaskTools(false))).changed, false)
  assert.deepEqual(readJson(e.ctx.paths.settings).env, { [TASK]: '1', OTHER: 'x' })
})
