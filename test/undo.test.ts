import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { main } from '../src/cli/index.ts'
import { runConfig } from '../src/cli/commands/config.ts'
import { createBackup, sha256 } from '../src/core/fsx.ts'
import { loadLedger, saveLedger } from '../src/core/ledger.ts'
import { saveUserLayer } from '../src/core/profilestore.ts'
import { runInstall } from '../src/install/install.ts'
import { runUpdate } from '../src/install/update.ts'
import { isInside, rollback, rollbackSeam, uninstall } from '../src/install/undo.ts'
import { makeEnv, mutating, readJson, snapshot, writeJson } from './helpers.ts'

const flags = { statusline: true, enableTeams: true }
const cfgFlags = { deviceLayer: false, noApply: false }
const registry = (e: ReturnType<typeof makeEnv>) => readJson(join(e.ctx.configDir, 'plugins', 'stub-state.json'))

test('uninstall restores settings, removes plugin/marketplace/ctk dir, keeps backups and foreign keys', async t => {
  const e = makeEnv(t)
  saveUserLayer(e.ctx.paths, { portable: { settings: { model: 'opus' } } })
  writeJson(e.ctx.paths.settings, { theme: 'dark', env: { OTHER: '1' }, enabledPlugins: { 'other@market': true }, hooks: { Stop: [] } })
  await runInstall(e.ctx, flags, e.root)
  assert.equal(readJson(e.ctx.paths.settings).model, 'opus')
  const r = await uninstall(e.ctx)
  assert.equal(r.code, 0, JSON.stringify(r.report))
  const s = readJson(e.ctx.paths.settings)
  assert.equal(s.theme, 'dark')
  assert.deepEqual(s.env, { OTHER: '1' })
  assert.deepEqual(s.hooks, { Stop: [] })
  assert.equal(s.enabledPlugins['other@market'], true)
  for (const k of ['model', 'pluginConfigs', 'statusLine']) assert.equal(s[k], undefined, k)
  assert.deepEqual(registry(e).plugins, [])
  assert.deepEqual(registry(e).marketplaces, [])
  assert.deepEqual(readdirSync(e.ctx.paths.ctk), ['backups'])
  assert.ok(readdirSync(e.ctx.paths.backupsDir).length >= 2)
})

test('uninstall: an option the user edited goes with the plugin, reported honestly and without a conflict', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  const s = readJson(e.ctx.paths.settings)
  s.pluginConfigs['ctk@ctk-kit'].options.maxWorkers = 8
  writeJson(e.ctx.paths.settings, s)
  const r = await uninstall(e.ctx)
  assert.equal(r.code, 0, JSON.stringify(r.report))
  assert.deepEqual(r.report.conflicts, [])
  const note = r.report.notes.find(n => n.startsWith('/pluginConfigs/ctk@ctk-kit/options/maxWorkers'))
  assert.match(note ?? '', /removed with the plugin by Claude Code \(your value 8 is kept in backup \S+\)/)
  const id = /kept in backup (\S+)\)/.exec(note ?? '')?.[1] as string
  const kept = readJson(join(e.ctx.paths.backupsDir, id, 'files', '0'))
  assert.equal(kept.pluginConfigs['ctk@ctk-kit'].options.maxWorkers, 8)
  assert.equal(readJson(e.ctx.paths.settings).pluginConfigs?.['ctk@ctk-kit'], undefined)
})

test('uninstall: a real conflict on a key outside the plugin config still exits 2', async t => {
  const e = makeEnv(t)
  saveUserLayer(e.ctx.paths, { portable: { settings: { model: 'opus' } } })
  await runInstall(e.ctx, flags, e.root)
  writeJson(e.ctx.paths.settings, { ...readJson(e.ctx.paths.settings), model: 'mine' })
  const r = await uninstall(e.ctx)
  assert.equal(r.code, 2)
  assert.deepEqual(r.report.conflicts.map(c => c.key), ['/model'])
  assert.equal(readJson(e.ctx.paths.settings).model, 'mine')
})

test('rollback with a pre-existing plugin (not uninstalled by ctk) leaves an edited option in place as a conflict', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  const { rmSync } = await import('node:fs')
  rmSync(e.ctx.paths.ctk, { recursive: true, force: true })
  const fresh = readJson(e.ctx.paths.settings)
  for (const k of ['pluginConfigs', 'env', 'statusLine']) delete fresh[k]
  writeJson(e.ctx.paths.settings, fresh)
  assert.equal((await runInstall(e.ctx, flags, e.root)).code, 0) // plugin and marketplace pre-exist: ctk owns the keys only
  assert.deepEqual(loadLedger(e.ctx)?.entries.find(x => x.kind === 'plugin'), { kind: 'plugin', marketplaceAddedByCtk: false, pluginInstalledByCtk: false })
  const s = readJson(e.ctx.paths.settings)
  s.pluginConfigs['ctk@ctk-kit'].options.maxWorkers = 8
  writeJson(e.ctx.paths.settings, s)
  const r = await rollback(e.ctx)
  assert.equal(r.code, 2)
  assert.deepEqual(r.report.conflicts.map(c => c.key), ['/pluginConfigs/ctk@ctk-kit/options/maxWorkers'])
  assert.equal(readJson(e.ctx.paths.settings).pluginConfigs['ctk@ctk-kit'].options.maxWorkers, 8)
  assert.equal(registry(e).plugins.length, 1, 'plugin not uninstalled')
})

test('rollback notes each rolled-back key a profile layer still sets, and leaves profile.json alone', async t => {
  const e = makeEnv(t)
  saveUserLayer(e.ctx.paths, { team: { maxWorkers: 7 }, portable: { settings: { model: 'opus' } } })
  await runInstall(e.ctx, flags, e.root)
  const profileBefore = snapshot(e.ctx.paths.ctk)['/profile.json']
  const r = await rollback(e.ctx)
  assert.equal(r.code, 0)
  const notes = r.report.notes.filter(n => n.startsWith('profile layer still sets'))
  assert.deepEqual(notes.sort(), [
    'profile layer still sets portable.settings.model; run `ctk config unset portable.settings.model` or the next update/config will re-apply it',
    'profile layer still sets team.maxWorkers; run `ctk config unset team.maxWorkers` or the next update/config will re-apply it',
  ])
  assert.equal(snapshot(e.ctx.paths.ctk)['/profile.json'], profileBefore)
})

test('uninstall --dry-run writes nothing', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  const before = snapshot(e.ctx.configDir)
  const calls = e.log().length
  const r = await uninstall({ ...e.ctx, dryRun: true })
  assert.equal(r.code, 0)
  assert.ok(r.report.reverted.length > 0)
  assert.deepEqual(snapshot(e.ctx.configDir), before)
  assert.deepEqual(mutating(e.log().slice(calls)), [])
})

test('uninstall without a ledger owns nothing and changes nothing', async t => {
  const e = makeEnv(t)
  writeJson(e.ctx.paths.settings, { theme: 'dark' })
  const before = snapshot(e.ctx.configDir)
  const r = await uninstall(e.ctx)
  assert.equal(r.code, 0)
  assert.deepEqual(snapshot(e.ctx.configDir), before)
})

test('rollback undoes the install transaction exactly, then reports nothing left', async t => {
  const e = makeEnv(t)
  writeJson(e.ctx.paths.settings, { theme: 'dark' })
  await runInstall(e.ctx, flags, e.root)
  const backups = readdirSync(e.ctx.paths.backupsDir).length
  const r = await rollback(e.ctx)
  assert.equal(r.code, 0, JSON.stringify(r.report))
  const s = readJson(e.ctx.paths.settings)
  assert.equal(s.theme, 'dark')
  for (const k of ['pluginConfigs', 'env', 'statusLine']) assert.equal(s[k], undefined, k)
  assert.ok(!existsSync(e.ctx.paths.statusline))
  assert.deepEqual(registry(e).plugins, [])
  assert.ok(readdirSync(e.ctx.paths.backupsDir).length > backups, 'rollback adds a backup, deletes none')
  assert.equal(loadLedger(e.ctx)?.transactions[0]?.undoneAt !== undefined, true)
  assert.match((await rollback(e.ctx)).report.notes.join(), /nothing to roll back/)
})

test('rollback restores the previous value of an updated key', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  assert.equal((await runConfig(e.ctx, ['set', 'team.maxWorkers', '7'], cfgFlags)).code, 0)
  assert.equal(readJson(e.ctx.paths.settings).pluginConfigs['ctk@ctk-kit'].options.maxWorkers, 7)
  const r = await rollback(e.ctx)
  assert.equal(r.code, 0)
  assert.equal(readJson(e.ctx.paths.settings).pluginConfigs['ctk@ctk-kit'].options.maxWorkers, 5)
  // the install transaction is still intact and undoable
  assert.equal((await rollback(e.ctx)).code, 0)
  assert.equal(readJson(e.ctx.paths.settings).pluginConfigs, undefined)
})

test('rollback refuses to overwrite a value the user changed after the transaction', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  await runConfig(e.ctx, ['set', 'team.maxWorkers', '7'], cfgFlags)
  const s = readJson(e.ctx.paths.settings)
  s.pluginConfigs['ctk@ctk-kit'].options.maxWorkers = 8
  writeJson(e.ctx.paths.settings, s)
  const r = await rollback(e.ctx)
  assert.equal(r.code, 2)
  assert.equal(readJson(e.ctx.paths.settings).pluginConfigs['ctk@ctk-kit'].options.maxWorkers, 8)
  assert.equal(r.report.conflicts[0]?.key, '/pluginConfigs/ctk@ctk-kit/options/maxWorkers')
})

test('rollback --to undoes that transaction and every later one; unknown ids fail', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  await runConfig(e.ctx, ['set', 'team.maxWorkers', '7'], cfgFlags)
  await runConfig(e.ctx, ['set', 'hud.band', 'false'], cfgFlags)
  const ids = loadLedger(e.ctx)?.transactions.map(x => x.id) ?? []
  assert.equal(ids.length, 3)
  assert.equal((await rollback(e.ctx, 'nope')).code, 1)
  const r = await rollback(e.ctx, ids[1])
  assert.deepEqual(r.undone, [ids[2], ids[1]])
  const o = readJson(e.ctx.paths.settings).pluginConfigs['ctk@ctk-kit'].options
  assert.equal(o.maxWorkers, 5)
  assert.equal(o.hudBand, true)
  assert.equal((await rollback(e.ctx, ids[1])).code, 1)
})

test('a user-edited statusline script is kept by rollback and the entry is released', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  const { writeFileSync } = await import('node:fs')
  writeFileSync(e.ctx.paths.statusline, '// mine\n')
  const r = await rollback(e.ctx)
  assert.equal(r.code, 2)
  assert.ok(existsSync(e.ctx.paths.statusline))
  assert.ok(!loadLedger(e.ctx)?.entries.some(x => x.kind === 'file'))
})

test('a corrupt ledger is reported, not replaced', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  const ledger = loadLedger(e.ctx)
  assert.ok(ledger)
  saveLedger(e.ctx, ledger)
  const { writeFileSync } = await import('node:fs')
  writeFileSync(e.ctx.paths.ledger, '{"schemaVersion": 2}')
  await assert.rejects(rollback(e.ctx), /invalid ledger/)
  await assert.rejects(runInstall(e.ctx, flags, e.root), /invalid ledger/)
})

test('a failed plugin uninstall keeps the ledger and ctk dir; a re-run completes', async t => {
  const e = makeEnv(t, {}, { STUB_FAIL: 'uninstall' })
  await runInstall(e.ctx, flags, e.root)
  const r = await uninstall(e.ctx)
  assert.equal(r.code, 2)
  assert.ok(r.report.conflicts.some(c => c.key === 'plugin'))
  assert.ok(existsSync(e.ctx.paths.ledger), 'ledger kept')
  assert.ok(existsSync(e.ctx.paths.statusline), 'nothing wiped')
  assert.equal(registry(e).plugins.length, 1)
  const env = { ...e.ctx.env }
  delete env.STUB_FAIL
  const again = await uninstall({ ...e.ctx, env })
  assert.equal(again.code, 0, JSON.stringify(again.report))
  assert.deepEqual(registry(e).plugins, [])
  assert.deepEqual(readdirSync(e.ctx.paths.ctk), ['backups'])
})

test('uninstall keeps the device layer and the sync clone and says where they are', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  writeJson(e.ctx.paths.deviceFile(e.ctx.device), { schemaVersion: 1, team: { maxWorkers: 2 } })
  mkdirSync(e.ctx.paths.syncRepo, { recursive: true })
  writeFileSync(join(e.ctx.paths.syncDir, 'config.json'), '{}')
  const r = await uninstall(e.ctx)
  assert.equal(r.code, 0)
  assert.deepEqual(readdirSync(e.ctx.paths.ctk).sort(), ['backups', 'devices', 'sync'])
  assert.ok(existsSync(e.ctx.paths.deviceFile(e.ctx.device)))
  assert.ok(r.report.notes.some(n => n.includes(e.ctx.paths.syncDir) && /kept/.test(n)))
  assert.ok(r.report.notes.some(n => n.includes(e.ctx.paths.devicesDir)))
})

test('uninstall removes the status line script only if it is still what CTK wrote', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  writeFileSync(e.ctx.paths.statusline, '// mine\n')
  const r = await uninstall(e.ctx)
  assert.equal(r.code, 2)
  assert.deepEqual(r.report.conflicts.map(c => c.key), [e.ctx.paths.statusline])
  assert.equal(readFileSync(e.ctx.paths.statusline, 'utf8'), '// mine\n')
  assert.ok(existsSync(e.ctx.paths.ledger))
})

test('path-prefix checks compare whole segments: a sibling named like the ctk dir is not inside it', async t => {
  const ctk = join(tmpdir(), 'c', 'ctk')
  assert.equal(isInside(ctk, join(ctk, 'bin', 'x')), true)
  assert.equal(isInside(ctk, join(tmpdir(), 'c', 'ctk-extra', 'x')), false)
  assert.equal(isInside(ctk, ctk), false)
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  const sibling = join(e.ctx.configDir, 'ctk-extra', 'f.txt')
  mkdirSync(join(e.ctx.configDir, 'ctk-extra'), { recursive: true })
  writeFileSync(sibling, 'x')
  const ledger = loadLedger(e.ctx)
  assert.ok(ledger)
  ledger.entries.push({ kind: 'file', path: sibling, sha256: sha256('x'), priorSha256: null })
  saveLedger(e.ctx, ledger)
  const r = await uninstall(e.ctx)
  assert.equal(r.code, 0, JSON.stringify(r.report))
  assert.ok(!existsSync(sibling), 'the sibling file was reverted like any other recorded file')
})

test('a rollback crash at any stage is safe to rerun: files and ledger converge', async t => {
  for (const stage of ['beforeTx', 'afterFiles', 'saveLedger'] as const) {
    const e = makeEnv(t)
    writeJson(e.ctx.paths.settings, { theme: 'dark' })
    await runInstall(e.ctx, flags, e.root)
    rollbackSeam.fault = s => {
      if (s === stage) throw new Error(`crash at ${s}`)
    }
    await assert.rejects(rollback(e.ctx), /crash/, stage)
    rollbackSeam.fault = undefined
    const r = await rollback(e.ctx)
    assert.equal(r.code, 0, `${stage}: ${JSON.stringify(r.report)}`)
    assert.deepEqual(readJson(e.ctx.paths.settings), { theme: 'dark' }, stage)
    assert.ok(!existsSync(e.ctx.paths.statusline), stage)
    assert.deepEqual(registry(e).plugins, [], stage)
    assert.ok(loadLedger(e.ctx)?.transactions.every(x => x.undoneAt !== undefined), stage)
  }
})

test('user edits inside the crash window survive the rerun as conflicts, never clobbered', async t => {
  const e = makeEnv(t)
  saveUserLayer(e.ctx.paths, { portable: { settings: { model: 'opus' } } })
  await runInstall(e.ctx, flags, e.root)
  // Crash after the tx's files were reverted but before its ledger save: on disk the tx is still open.
  rollbackSeam.fault = s => {
    if (s === 'afterFiles') throw new Error('crash')
  }
  await assert.rejects(rollback(e.ctx), /crash/)
  rollbackSeam.fault = undefined
  // The user edits inside the window; the rerun must report conflicts, not overwrite.
  writeJson(e.ctx.paths.settings, { ...readJson(e.ctx.paths.settings), model: 'mine' })
  writeFileSync(e.ctx.paths.statusline, '// mine\n')
  const r = await rollback(e.ctx)
  assert.equal(r.code, 2)
  assert.deepEqual(r.report.conflicts.map(c => c.key).sort(), [e.ctx.paths.statusline, '/model'].sort())
  assert.equal(readJson(e.ctx.paths.settings).model, 'mine')
  assert.equal(readFileSync(e.ctx.paths.statusline, 'utf8'), '// mine\n')
  assert.ok(loadLedger(e.ctx)?.transactions.every(x => x.undoneAt !== undefined))
})

test('a crash on a middle transaction leaves earlier ones committed; the rerun finishes the rest', async t => {
  const e = makeEnv(t)
  writeJson(e.ctx.paths.settings, { theme: 'dark' })
  await runInstall(e.ctx, flags, e.root)
  await runConfig(e.ctx, ['set', 'team.maxWorkers', '7'], cfgFlags)
  const ids = loadLedger(e.ctx)?.transactions.map(x => x.id) ?? []
  assert.equal(ids.length, 2)
  // Targets run newest-first: ids[1] (config) commits, then the install tx crashes before its save.
  rollbackSeam.fault = (s, i) => {
    if (s === 'afterFiles' && i === 1) throw new Error('crash')
  }
  await assert.rejects(rollback(e.ctx, ids[0]), /crash/)
  rollbackSeam.fault = undefined
  const mid = loadLedger(e.ctx)
  assert.ok(mid?.transactions.find(x => x.id === ids[1])?.undoneAt !== undefined, 'the first tx was committed by its own save')
  assert.equal(mid?.transactions.find(x => x.id === ids[0])?.undoneAt, undefined, 'the crashed tx is still open')
  const r = await rollback(e.ctx, ids[0])
  assert.equal(r.code, 0, JSON.stringify(r.report))
  assert.deepEqual(readJson(e.ctx.paths.settings), { theme: 'dark' })
  assert.ok(!existsSync(e.ctx.paths.statusline))
  assert.deepEqual(registry(e).plugins, [])
  assert.ok(loadLedger(e.ctx)?.transactions.every(x => x.undoneAt !== undefined))
})

test('uninstall restores an out-of-dir file that has a prior and a backup copy, instead of deleting it', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  const outside = join(e.dir, 'outside.txt')
  writeFileSync(outside, 'prior')
  const backupId = createBackup(e.ctx.paths.backupsDir, 'install', [outside]).id
  writeFileSync(outside, 'ctk wrote this')
  const ledger = loadLedger(e.ctx)
  assert.ok(ledger)
  ledger.entries.push({ kind: 'file', path: outside, sha256: sha256('ctk wrote this'), priorSha256: sha256('prior') })
  ledger.transactions.push({ id: 'synthetic', op: 'install', at: new Date().toISOString(), backupId, entryChanges: [] })
  saveLedger(e.ctx, ledger)
  const r = await uninstall(e.ctx)
  assert.equal(r.code, 0, JSON.stringify(r.report))
  assert.equal(readFileSync(outside, 'utf8'), 'prior')
  assert.ok(r.report.reverted.includes(outside))
  assert.ok(!r.report.removed.includes(outside))
})

const UNRELATED = { theme: 'dark', permissions: { allow: ['Bash(ls)'] }, hooks: { Stop: [] }, model: 'sonnet' }

test('install then uninstall leaves settings.json with exactly the original content and key order', async t => {
  const e = makeEnv(t)
  writeJson(e.ctx.paths.settings, UNRELATED)
  await runInstall(e.ctx, flags, e.root)
  assert.notDeepEqual(readJson(e.ctx.paths.settings), UNRELATED)
  const r = await uninstall(e.ctx)
  assert.equal(r.code, 0, JSON.stringify(r.report))
  assert.equal(JSON.stringify(readJson(e.ctx.paths.settings)), JSON.stringify(UNRELATED))
  assert.deepEqual(readdirSync(e.ctx.paths.ctk), ['backups'])
})

test('install then rollback leaves settings.json with exactly the original content and key order', async t => {
  const e = makeEnv(t)
  writeJson(e.ctx.paths.settings, UNRELATED)
  await runInstall(e.ctx, flags, e.root)
  const r = await rollback(e.ctx)
  assert.equal(r.code, 0, JSON.stringify(r.report))
  assert.equal(JSON.stringify(readJson(e.ctx.paths.settings)), JSON.stringify(UNRELATED))
})

test('containers that existed before ctk are kept, even when ctk leaves them empty', async t => {
  const e = makeEnv(t)
  const original = { ...UNRELATED, env: {}, enabledPlugins: { 'x@y': true }, pluginConfigs: {} }
  writeJson(e.ctx.paths.settings, original)
  await runInstall(e.ctx, flags, e.root)
  assert.equal((await uninstall(e.ctx)).code, 0)
  assert.equal(JSON.stringify(readJson(e.ctx.paths.settings)), JSON.stringify(original))
})

test('a container ctk created is kept when it holds something of the user', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  const s = readJson(e.ctx.paths.settings)
  s.env.MY_VAR = '1'
  writeJson(e.ctx.paths.settings, s)
  assert.equal((await uninstall(e.ctx)).code, 0)
  assert.deepEqual(readJson(e.ctx.paths.settings).env, { MY_VAR: '1' })
})

const router = async (e: ReturnType<typeof makeEnv>, args: string[]) => {
  const out: string[] = []
  const code = await main([...args, '--config-dir', e.ctx.configDir], { out: l => out.push(l), err: l => out.push(l), env: e.ctx.env, cwd: e.dir, claudeBin: e.stub })
  return { code, out }
}

test('uninstall prints "removed" for deleted keys and "restored" only when a previous value is put back', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  await runConfig(e.ctx, ['set', 'team.maxWorkers', '7'], cfgFlags)
  const rb = await router(e, ['rollback'])
  assert.equal(rb.code, 0, rb.out.join('\n'))
  assert.ok(rb.out.includes('  restored /pluginConfigs/ctk@ctk-kit/options/maxWorkers'), rb.out.join('\n'))
  assert.ok(!rb.out.some(l => l.includes('removed /pluginConfigs')))
  const un = await router(e, ['uninstall'])
  const text = un.out.join('\n')
  assert.match(text, /^  removed \/statusLine$/m)
  assert.match(text, /^  removed plugin ctk@ctk-kit$/m)
  assert.ok(!/restored \/statusLine/.test(text))
})

test('--json keeps `reverted` as everything put back and adds `removed` as its deleted subset', async t => {
  const e = makeEnv(t)
  writeJson(e.ctx.paths.settings, { env: { KEEP: '1' } })
  await runInstall(e.ctx, flags, e.root)
  const un = await router(e, ['uninstall', '--json'])
  const doc = JSON.parse(un.out.join('\n'))
  assert.ok(Array.isArray(doc.reverted) && Array.isArray(doc.removed) && Array.isArray(doc.conflicts) && Array.isArray(doc.notes))
  assert.ok(doc.reverted.includes('/statusLine'))
  assert.ok(doc.removed.length > 0 && doc.removed.every((k: string) => doc.reverted.includes(k)))
})

test('uninstall and rollback remove the task-tools key and the env container ctk created; rollback names the profile key', async t => {
  for (const how of ['uninstall', 'rollback'] as const) {
    const e = makeEnv(t)
    saveUserLayer(e.ctx.paths, { claude: { enableAgentTeams: false, enableTaskTools: true } })
    writeJson(e.ctx.paths.settings, UNRELATED)
    await runInstall(e.ctx, flags, e.root)
    assert.equal(readJson(e.ctx.paths.settings).env.CLAUDE_CODE_ENABLE_TODO_TOOLS, '1')
    const r = how === 'uninstall' ? await uninstall(e.ctx) : await rollback(e.ctx)
    assert.equal(r.code, 0, JSON.stringify(r.report))
    assert.equal(JSON.stringify(readJson(e.ctx.paths.settings)), JSON.stringify(UNRELATED), how)
    if (how === 'rollback') assert.ok(r.report.notes.some(n => n.startsWith('profile layer still sets claude.enableTaskTools')))
  }
})

test('uninstall headlines: removed, would uninstall, nothing to uninstall, and incomplete only for a failed step', async t => {
  const e = makeEnv(t)
  const none = await router(e, ['uninstall'])
  assert.equal(none.code, 0)
  assert.equal(none.out[0], 'nothing to uninstall: ctk owns nothing here')
  assert.ok(!none.out.join('\n').includes('incomplete'))
  assert.equal((await router(e, ['uninstall', '--dry-run'])).out[0], 'nothing to uninstall: ctk owns nothing here')

  await runInstall(e.ctx, flags, e.root)
  const dry = await router(e, ['uninstall', '--dry-run'])
  assert.equal(dry.out[0], 'would uninstall ctk')
  const done = await router(e, ['uninstall'])
  assert.equal(done.code, 0)
  assert.match(done.out[0] as string, /^uninstalled ctk \(backups kept in /)

  const f = makeEnv(t, {}, { STUB_FAIL: 'uninstall' })
  await runInstall(f.ctx, flags, f.root)
  const failed = await router(f, ['uninstall'])
  assert.equal(failed.code, 2)
  assert.equal(failed.out[0], 'uninstall incomplete')
  const json = JSON.parse((await router(f, ['uninstall', '--json'])).out.join('\n'))
  assert.equal(json.status, 'incomplete')
})

test('rollback with nothing to roll back says so, exits 0, and claims no rollback', async t => {
  const e = makeEnv(t)
  for (const setup of [false, true]) {
    if (setup) {
      await runInstall(e.ctx, flags, e.root)
      assert.equal((await router(e, ['rollback'])).code, 0)
    }
    const r = await router(e, ['rollback'])
    assert.equal(r.code, 0)
    assert.deepEqual(r.out, ['nothing to roll back'])
  }
})
