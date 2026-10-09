import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { runClaude } from '../src/core/claude.ts'
import { loadLedger } from '../src/core/ledger.ts'
import { statuslineCommand } from '../src/install/statusline.ts'
import { runUpdate } from '../src/install/update.ts'
import { loadDeviceLayer, saveUserLayer } from '../src/core/profilestore.ts'
import { runInstall } from '../src/install/install.ts'
import { makeEnv, mutating, readJson, snapshot, writeJson } from './helpers.ts'

const flags = { statusline: true, enableTeams: true }
const OPT = '/pluginConfigs/ctk@ctk-kit/options'

test('install writes plugin, statusline, owned keys and a ledger; keeps other settings', async t => {
  const e = makeEnv(t)
  writeJson(e.ctx.paths.settings, {
    theme: 'dark',
    enabledPlugins: { 'other@market': true },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] },
    permissions: { allow: ['Bash(ls)'] },
  })
  const r = await runInstall(e.ctx, flags, e.root)
  assert.equal(r.code, 0, r.lines.join('\n'))
  const s = readJson(e.ctx.paths.settings)
  assert.deepEqual(Object.keys(s).slice(0, 4), ['theme', 'enabledPlugins', 'hooks', 'permissions'])
  assert.equal(s.theme, 'dark')
  assert.deepEqual(s.hooks, { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] })
  assert.deepEqual(s.permissions, { allow: ['Bash(ls)'] })
  assert.equal(s.enabledPlugins['other@market'], true)
  assert.equal(s.enabledPlugins['ctk@ctk-kit'], true)
  assert.equal(s.pluginConfigs['ctk@ctk-kit'].options.maxWorkers, 5)
  assert.equal(s.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, '1')
  // POSIX: single-quoted absolute paths. Windows: double-quoted with forward slashes (Git Bash eats backslashes).
  assert.equal(s.statusLine.command, statuslineCommand(process.execPath, e.ctx.paths.statusline))
  assert.match(
    s.statusLine.command,
    process.platform === 'win32' ? /^"[^"]*node(\.exe)?" "[^"\\]*\/ctk\/bin\/ctk-statusline\.mjs"$/ : /^'.*node[^']*' '.*\/ctk\/bin\/ctk-statusline\.mjs'$/,
  )
  assert.equal(readFileSync(e.ctx.paths.statusline, 'utf8'), '// statusline v1\n')
  const ledger = loadLedger(e.ctx)
  assert.ok(ledger)
  assert.equal(ledger.transactions.length, 1)
  assert.deepEqual(ledger.entries.find(x => x.kind === 'plugin'), { kind: 'plugin', marketplaceAddedByCtk: true, pluginInstalledByCtk: true })
  assert.deepEqual(mutating(e.log()).map(c => c.slice(0, 3).join(' ')), ['plugin marketplace add', 'plugin install ctk@ctk-kit'])
})

test('second install changes no file, creates no backup or transaction, runs no mutating claude call', async t => {
  const e = makeEnv(t)
  assert.equal((await runInstall(e.ctx, flags, e.root)).code, 0)
  const before = snapshot(e.ctx.configDir)
  const calls = e.log().length
  const r = await runInstall(e.ctx, flags, e.root)
  assert.equal(r.code, 0)
  assert.deepEqual(snapshot(e.ctx.configDir), before)
  assert.equal(loadLedger(e.ctx)?.transactions.length, 1)
  assert.equal(readdirSync(e.ctx.paths.backupsDir).length, 1)
  assert.deepEqual(mutating(e.log().slice(calls)), [])
  assert.match(r.lines.join('\n'), /nothing to change/)
})

test('dry-run writes nothing and calls no mutating claude command', async t => {
  const e = makeEnv(t, { dryRun: true })
  writeJson(e.ctx.paths.settings, { theme: 'dark' })
  const before = snapshot(e.ctx.configDir)
  const r = await runInstall(e.ctx, flags, e.root)
  assert.equal(r.code, 0)
  assert.deepEqual(snapshot(e.ctx.configDir), before)
  assert.deepEqual(mutating(e.log()), [])
  assert.match(r.lines.join('\n'), /plan:/)
  assert.match(r.lines.join('\n'), /marketplace ctk-kit: add/)
})

test('a different user value is a conflict: left untouched, exit 2, everything else still installs', async t => {
  const e = makeEnv(t)
  saveUserLayer(e.ctx.paths, { portable: { settings: { model: 'opus' } } })
  writeJson(e.ctx.paths.settings, { model: 'sonnet', pluginConfigs: { 'ctk@ctk-kit': { options: { maxWorkers: 9 } } } })
  const r = await runInstall(e.ctx, flags, e.root)
  assert.equal(r.code, 2, r.lines.join('\n'))
  const s = readJson(e.ctx.paths.settings)
  assert.equal(s.model, 'sonnet')
  assert.equal(s.pluginConfigs['ctk@ctk-kit'].options.maxWorkers, 9)
  assert.equal(s.pluginConfigs['ctk@ctk-kit'].options.hudBand, true)
  const conflicts = (r.data.conflicts as { pointer: string }[]).map(c => c.pointer).sort()
  assert.deepEqual(conflicts, ['/model', `${OPT}/maxWorkers`])
  const ledger = loadLedger(e.ctx)
  assert.ok(!ledger?.entries.some(x => x.kind === 'settings-key' && x.owned && (x.pointer === '/model' || x.pointer === `${OPT}/maxWorkers`)))
  // repeating keeps reporting the conflict
  assert.equal((await runInstall(e.ctx, flags, e.root)).code, 2)
})

test('a user-edited key that CTK owns is left alone and reported', async t => {
  const e = makeEnv(t)
  assert.equal((await runInstall(e.ctx, flags, e.root)).code, 0)
  const s = readJson(e.ctx.paths.settings)
  s.pluginConfigs['ctk@ctk-kit'].options.maxWorkers = 7
  writeJson(e.ctx.paths.settings, s)
  const r = await runInstall(e.ctx, flags, e.root)
  assert.equal(r.code, 2)
  assert.equal(readJson(e.ctx.paths.settings).pluginConfigs['ctk@ctk-kit'].options.maxWorkers, 7)
})

test('invalid settings.json is never overwritten and nothing is installed', async t => {
  const e = makeEnv(t)
  writeFileSync(e.ctx.paths.settings, '{ "theme": ')
  const before = snapshot(e.ctx.configDir)
  await assert.rejects(runInstall(e.ctx, flags, e.root), /not valid JSON/)
  assert.deepEqual(snapshot(e.ctx.configDir), before)
  assert.deepEqual(mutating(e.log()), [])
})

test('a user statusLine is never replaced; the report says the HUD runs via the band', async t => {
  const e = makeEnv(t)
  const mine = { type: 'command', command: 'my-status' }
  writeJson(e.ctx.paths.settings, { statusLine: mine, env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '0' } })
  const r = await runInstall(e.ctx, flags, e.root)
  assert.equal(r.code, 0)
  const s = readJson(e.ctx.paths.settings)
  assert.deepEqual(s.statusLine, mine)
  assert.equal(s.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, '0')
  assert.match(r.lines.join('\n'), /mod band only/)
})

test('--no-statusline and --no-enable-teams are honoured and remembered in the device layer', async t => {
  const e = makeEnv(t)
  const r = await runInstall(e.ctx, { statusline: false, enableTeams: false }, e.root)
  assert.equal(r.code, 0)
  const s = readJson(e.ctx.paths.settings)
  assert.equal(s.statusLine, undefined)
  assert.equal(s.env, undefined)
  assert.ok(!existsSync(e.ctx.paths.statusline))
  assert.deepEqual(loadDeviceLayer(e.ctx.paths, e.ctx.device), { schemaVersion: 1, hud: { statusLine: 'off' }, claude: { enableAgentTeams: false } })
  const again = snapshot(e.ctx.configDir)
  assert.equal((await runInstall(e.ctx, { statusline: false, enableTeams: false }, e.root)).code, 0)
  assert.deepEqual(snapshot(e.ctx.configDir), again)
})

test('a marketplace someone else registered at a path that still exists is a conflict with the manual command, and nothing changes', async t => {
  const e = makeEnv(t)
  mkdirSync(join(e.dir, 'elsewhere'))
  writeJson(join(e.ctx.configDir, 'plugins', 'stub-state.json'), { marketplaces: [{ name: 'ctk-kit', source: 'directory', path: join(e.dir, 'elsewhere'), installLocation: '' }], plugins: [] })
  const r = await runInstall(e.ctx, flags, e.root)
  assert.equal(r.code, 2)
  assert.match(r.lines.join('\n'), /claude plugin marketplace remove ctk-kit.*and then "ctk install"/)
  assert.deepEqual(mutating(e.log()), [])
  assert.ok(!existsSync(e.ctx.paths.ledger))
})

test('pre-existing marketplace and plugin are not marked as installed by ctk', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  const { rmSync } = await import('node:fs')
  rmSync(e.ctx.paths.ctk, { recursive: true, force: true })
  assert.equal((await runInstall(e.ctx, flags, e.root)).code, 0)
  assert.deepEqual(loadLedger(e.ctx)?.entries.find(x => x.kind === 'plugin'), { kind: 'plugin', marketplaceAddedByCtk: false, pluginInstalledByCtk: false })
})

test('a claude failure mid-install is reported and the partial work is ledgered', async t => {
  const e = makeEnv(t, {}, { STUB_FAIL: 'install ctk@ctk-kit' })
  await assert.rejects(runInstall(e.ctx, flags, e.root), /forced failure/)
  const ledger = loadLedger(e.ctx)
  assert.ok(ledger)
  assert.deepEqual(ledger.entries.find(x => x.kind === 'plugin'), { kind: 'plugin', marketplaceAddedByCtk: true, pluginInstalledByCtk: false })
  assert.equal(ledger.transactions.length, 1)
})

const bump = (root: string, script: string) => writeFileSync(join(root, 'plugins', 'ctk', 'statusline', 'ctk-statusline.mjs'), script)

test('a status line script the user edited is never overwritten by install or update (exit 2)', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  writeFileSync(e.ctx.paths.statusline, '// mine\n')
  bump(e.root, '// statusline v2\n')
  const i = await runInstall(e.ctx, flags, e.root)
  assert.equal(i.code, 2, i.lines.join('\n'))
  assert.equal(readFileSync(e.ctx.paths.statusline, 'utf8'), '// mine\n')
  assert.deepEqual((i.data.conflicts as { pointer: string }[]).map(c => c.pointer), [e.ctx.paths.statusline])
  const u = await runUpdate(e.ctx, e.root)
  assert.equal(u.code, 2, u.lines.join('\n'))
  assert.equal(readFileSync(e.ctx.paths.statusline, 'utf8'), '// mine\n')
  // an unedited script is still refreshed
  writeFileSync(e.ctx.paths.statusline, '// statusline v1\n')
  assert.equal((await runUpdate(e.ctx, e.root)).code, 0)
  assert.equal(readFileSync(e.ctx.paths.statusline, 'utf8'), '// statusline v2\n')
})

test('a plugin the user disabled stays disabled: install warns and does not enable it', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  const stateFile = join(e.ctx.configDir, 'plugins', 'stub-state.json')
  const state = readJson(stateFile)
  state.plugins[0].enabled = false
  writeJson(stateFile, state)
  const calls = e.log().length
  const r = await runInstall(e.ctx, flags, e.root)
  assert.equal(r.code, 0)
  assert.deepEqual(mutating(e.log().slice(calls)), [])
  assert.equal(readJson(stateFile).plugins[0].enabled, false)
  const text = r.lines.join('\n')
  assert.match(text, /installed but disabled, left disabled/)
  assert.deepEqual(r.lines.slice(-3), ['Restart Claude Code (or run /reload-plugins).', 'The ctk plugin is disabled; enable it with: claude plugin enable ctk@ctk-kit', 'Undo any time: ctk uninstall'])
  assert.ok(!text.includes('Try: /ctk:team'))
})

test('options Claude deleted with an uninstalled plugin are re-added when install reinstalls it', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  await runClaude(e.ctx, ['plugin', 'uninstall', 'ctk@ctk-kit', '--scope', 'user', '--json'])
  assert.equal(readJson(e.ctx.paths.settings).pluginConfigs['ctk@ctk-kit'], undefined)
  const r = await runInstall(e.ctx, flags, e.root)
  assert.equal(r.code, 0, r.lines.join('\n'))
  assert.equal(readJson(e.ctx.paths.settings).pluginConfigs['ctk@ctk-kit'].options.maxWorkers, 5)
})

/** A second package location with the same content, as after moving the checkout. */
const moved = (e: ReturnType<typeof makeEnv>, remove: boolean): string => {
  const to = join(e.dir, 'pkg-moved')
  cpSync(e.root, to, { recursive: true })
  if (remove) rmSync(e.root, { recursive: true })
  return to
}
const stubState = (e: ReturnType<typeof makeEnv>) => readJson(join(e.ctx.configDir, 'plugins', 'stub-state.json'))

test('moved checkout, marketplace added by CTK: install re-points it in one transaction and keeps the ledger consistent', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  const to = moved(e, false) // the old path still exists: CTK added the registration, so it may move it
  const calls = e.log().length
  const dry = await runInstall({ ...e.ctx, dryRun: true }, flags, to)
  assert.match(dry.lines.join('\n'), /re-point from .*pkg to .*pkg-moved/)
  assert.deepEqual(mutating(e.log().slice(calls)), [])
  assert.equal(stubState(e).marketplaces[0].path, e.root)
  const r = await runInstall(e.ctx, flags, to)
  assert.equal(r.code, 0, r.lines.join('\n'))
  assert.deepEqual(mutating(e.log().slice(calls)).map(c => c.slice(0, 4).join(' ')), ['plugin marketplace remove ctk-kit', 'plugin marketplace add ' + to, 'plugin install ctk@ctk-kit --scope'])
  assert.equal(stubState(e).marketplaces[0].path, to)
  assert.equal(stubState(e).plugins.length, 1)
  const s = readJson(e.ctx.paths.settings)
  assert.equal(s.pluginConfigs['ctk@ctk-kit'].options.maxWorkers, 5, 'options Claude dropped with the plugin are written again')
  assert.equal(s.enabledPlugins['ctk@ctk-kit'], true)
  assert.deepEqual(loadLedger(e.ctx)?.entries.find(x => x.kind === 'plugin'), { kind: 'plugin', marketplaceAddedByCtk: true, pluginInstalledByCtk: true })
  assert.equal(loadLedger(e.ctx)?.transactions.length, 2)
  const before = snapshot(e.ctx.configDir)
  assert.equal((await runInstall(e.ctx, flags, to)).code, 0)
  assert.deepEqual(snapshot(e.ctx.configDir), before)
})

test('moved checkout, old path gone: install re-points even without a ledger', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  rmSync(e.ctx.paths.ctk, { recursive: true, force: true }) // no ledger: nothing says CTK added it
  const to = moved(e, true)
  const r = await runInstall(e.ctx, flags, to)
  assert.equal(r.code, 0, r.lines.join('\n'))
  assert.equal(stubState(e).marketplaces[0].path, to)
  assert.equal(stubState(e).plugins.length, 1)
})

test('moved checkout, registration not added by CTK and old path still there: conflict, exit 2, nothing changes', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  rmSync(e.ctx.paths.ctk, { recursive: true, force: true })
  const to = moved(e, false)
  const calls = e.log().length
  const r = await runInstall(e.ctx, flags, to)
  assert.equal(r.code, 2)
  assert.match(r.lines.join('\n'), /claude plugin marketplace remove ctk-kit/)
  assert.deepEqual(mutating(e.log().slice(calls)), [])
  assert.equal(stubState(e).marketplaces[0].path, e.root)
})

test('update from a moved checkout re-points too; a foreign registration stays a conflict', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  const to = moved(e, true)
  const u = await runUpdate(e.ctx, to)
  assert.equal(u.code, 0, u.lines.join('\n'))
  assert.equal(stubState(e).marketplaces[0].path, to)
  assert.equal(stubState(e).plugins.length, 1)
  assert.doesNotMatch(u.lines.join('\n'), /already up to date/)
  assert.equal((await runUpdate(e.ctx, to)).code, 0)

  const f = makeEnv(t)
  await runInstall(f.ctx, flags, f.root)
  rmSync(f.ctx.paths.ctk, { recursive: true, force: true })
  const there = moved(f, false)
  const r = await runUpdate(f.ctx, there)
  assert.equal(r.code, 2)
  assert.equal(stubState(f).marketplaces[0].path, f.root)
})

const setEnabled = (e: ReturnType<typeof makeEnv>, enabled: boolean) => {
  const file = join(e.ctx.configDir, 'plugins', 'stub-state.json')
  const state = readJson(file)
  state.plugins[0].enabled = enabled
  writeJson(file, state)
}

test('a disabled plugin is still disabled after install re-points the marketplace', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  setEnabled(e, false)
  const to = moved(e, false)
  const calls = e.log().length
  const dry = await runInstall({ ...e.ctx, dryRun: true }, flags, to)
  assert.match(dry.lines.join('\n'), /reinstall, then disable it again/)
  const r = await runInstall(e.ctx, flags, to)
  assert.equal(r.code, 0, r.lines.join('\n'))
  assert.ok(r.lines.includes('The ctk plugin is disabled; enable it with: claude plugin enable ctk@ctk-kit'))
  assert.ok(!r.lines.join('\n').includes('Try: /ctk:team'))
  assert.equal(stubState(e).plugins.length, 1)
  assert.equal(stubState(e).plugins[0].enabled, false)
  assert.equal(readJson(e.ctx.paths.settings).enabledPlugins['ctk@ctk-kit'], false)
  assert.ok(e.log().slice(calls).some(c => c[1] === 'disable'))
})

test('an enabled plugin stays enabled through a re-point and no disable is issued', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root)
  const to = moved(e, false)
  const calls = e.log().length
  assert.equal((await runInstall(e.ctx, flags, to)).code, 0)
  assert.equal(stubState(e).plugins[0].enabled, true)
  assert.ok(!e.log().slice(calls).some(c => c[1] === 'disable'))
})

test('ctk update never enables a disabled plugin, with or without a re-point', async t => {
  const e = makeEnv(t, {}, { STUB_UPDATE_ENABLES: '1' }) // this stub re-enables on `plugin update`, as a worst case
  await runInstall(e.ctx, flags, e.root)
  setEnabled(e, false)
  bump(e.root, '// statusline v1\n')
  writeJson(join(e.root, 'plugins', 'ctk', '.claude-plugin', 'plugin.json'), { name: 'ctk', version: '0.2.0' })
  const u = await runUpdate(e.ctx, e.root)
  assert.equal(u.code, 0, u.lines.join('\n'))
  assert.ok(e.log().some(c => c[1] === 'update'), 'the plugin update did run')
  assert.equal(stubState(e).plugins[0].enabled, false)

  const f = makeEnv(t)
  await runInstall(f.ctx, flags, f.root)
  setEnabled(f, false)
  const to = moved(f, false)
  assert.equal((await runUpdate(f.ctx, to)).code, 0)
  assert.equal(stubState(f).plugins[0].enabled, false)
})
