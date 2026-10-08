import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { runDoctor } from '../src/cli/commands/doctor.ts'
import { main } from '../src/cli/index.ts'
import { listMarketplaces } from '../src/core/claude.ts'
import { loadLedger, saveLedger } from '../src/core/ledger.ts'
import { runInstall } from '../src/install/install.ts'
import { uninstall } from '../src/install/undo.ts'
import { runUpdate } from '../src/install/update.ts'
import { makeEnv, mutating, readJson, seedNativeInstall, snapshot, writeJson } from './helpers.ts'

const flags = { statusline: true, enableTeams: true }
const GITHUB = { source: 'github', repo: 'tc3oliver/claude-team-kit' }
const stubState = (e: ReturnType<typeof makeEnv>) => readJson(join(e.ctx.configDir, 'plugins', 'stub-state.json'))
const status = (r: Awaited<ReturnType<typeof runDoctor>>, id: string) => (r.data.checks as { id: string; status: string }[]).find(c => c.id === id)?.status

test('a github-source marketplace is read as remote: no local path', async t => {
  const e = makeEnv(t)
  seedNativeInstall(e)
  assert.deepEqual(await listMarketplaces(e.ctx), [{ name: 'ctk-kit', source: 'github', path: null, remote: 'tc3oliver/claude-team-kit' }])
})

test('ctk install over a native (github) install adopts it: no re-point, no conflict, only ctk\'s own keys are added', async t => {
  const e = makeEnv(t)
  seedNativeInstall(e)
  const before = readJson(e.ctx.paths.settings)
  const dry = await runInstall({ ...e.ctx, dryRun: true }, flags, e.root)
  assert.equal(dry.code, 0)
  assert.match(dry.lines.join('\n'), /already registered from github tc3oliver\/claude-team-kit \(a native install; kept as is\)/)
  const r = await runInstall(e.ctx, flags, e.root)
  assert.equal(r.code, 0, r.lines.join('\n'))
  assert.deepEqual(mutating(e.log()), [], 'no marketplace add/remove, no plugin install')
  const s = readJson(e.ctx.paths.settings)
  assert.deepEqual(s.extraKnownMarketplaces, before.extraKnownMarketplaces, 'the marketplace entry is untouched')
  assert.deepEqual(s.enabledPlugins, before.enabledPlugins)
  assert.equal(s.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, '1')
  assert.equal(s.pluginConfigs['ctk@ctk-kit'].options.maxWorkers, 3)
  assert.ok(s.statusLine)
  assert.deepEqual(loadLedger(e.ctx)?.entries.find(x => x.kind === 'plugin'), { kind: 'plugin', marketplaceAddedByCtk: false, pluginInstalledByCtk: false })
  const again = snapshot(e.ctx.configDir)
  assert.equal((await runInstall(e.ctx, flags, e.root)).code, 0)
  assert.deepEqual(snapshot(e.ctx.configDir), again)
})

test('a marketplace CTK registered from a directory and the user later re-registered natively is not re-pointed', async t => {
  const e = makeEnv(t)
  await runInstall(e.ctx, flags, e.root) // ledger: marketplaceAddedByCtk = true
  const stateFile = join(e.ctx.configDir, 'plugins', 'stub-state.json')
  const state = stubState(e)
  state.marketplaces = [{ name: 'ctk-kit', ...GITHUB, installLocation: join(e.dir, 'cache') }]
  writeJson(stateFile, state)
  const calls = e.log().length
  const r = await runInstall(e.ctx, flags, e.root)
  assert.equal(r.code, 0, r.lines.join('\n'))
  assert.deepEqual(mutating(e.log().slice(calls)), [])
})

test('ctk update leaves a natively installed plugin to Claude Code, even when the packaged version differs', async t => {
  const e = makeEnv(t)
  seedNativeInstall(e)
  await runInstall(e.ctx, flags, e.root)
  writeJson(join(e.root, 'plugins', 'ctk', '.claude-plugin', 'plugin.json'), { name: 'ctk', version: '9.9.9' })
  const calls = e.log().length
  const u = await runUpdate(e.ctx, e.root)
  assert.equal(u.code, 0, u.lines.join('\n'))
  assert.equal((u.data.steps as { plugin: string }).plugin, 'native')
  assert.match(u.lines.join('\n'), /installed natively: update it with \/plugin update ctk@ctk-kit/)
  assert.deepEqual(mutating(e.log().slice(calls)), [])
  const before = snapshot(e.ctx.configDir)
  assert.equal((await runUpdate(e.ctx, e.root)).code, 0)
  assert.deepEqual(snapshot(e.ctx.configDir), before)
})

test('ctk uninstall after adopting a native install removes only what ctk added and leaves the plugin and marketplace', async t => {
  const e = makeEnv(t)
  seedNativeInstall(e)
  const original = readJson(e.ctx.paths.settings)
  await runInstall(e.ctx, flags, e.root)
  const r = await uninstall(e.ctx)
  assert.equal(r.code, 0, JSON.stringify(r.report))
  assert.equal(stubState(e).plugins.length, 1, 'the plugin is still installed')
  assert.equal(stubState(e).marketplaces.length, 1)
  assert.equal(JSON.stringify(readJson(e.ctx.paths.settings)), JSON.stringify(original))
  const text = r.report.notes.join('\n')
  assert.match(text, /left plugin ctk@ctk-kit installed: ctk did not install it\. Remove it in Claude Code with: \/plugin uninstall ctk@ctk-kit \(and \/plugin marketplace remove ctk-kit\)/)
})

test('doctor on a native install without a ledger: plugin and marketplace ok, ledger info, flag and status line checks unchanged', async t => {
  const e = makeEnv(t)
  seedNativeInstall(e)
  writeFileSync(join(e.ctx.configDir, '.claude.json'), '{}')
  const r = await runDoctor(e.ctx)
  const text = r.lines.join('\n')
  assert.equal(status(r, 'plugin'), 'pass')
  assert.match(text, /ctk@ctk-kit 0\.1\.0 installed and enabled; installed natively \(no ctk ledger\)/)
  assert.equal(status(r, 'marketplace'), 'pass')
  assert.match(text, /marketplace ctk-kit registered \(github tc3oliver\/claude-team-kit\)/)
  assert.equal(status(r, 'ledger'), 'info')
  assert.equal(status(r, 'agent-teams'), 'warn')
  assert.equal(status(r, 'statusline'), 'warn')
  assert.equal(r.code, 2)
})

test('ctk uninstall without a ledger says ctk owns nothing, how to remove a native install, and where the mod\'s stats stay behind', async t => {
  const e = makeEnv(t)
  seedNativeInstall(e)
  mkdirSync(e.ctx.paths.statsDir, { recursive: true })
  writeFileSync(join(e.ctx.paths.statsDir, 's1.json'), '{}')
  const before = snapshot(e.ctx.configDir)
  const out: string[] = []
  const code = await main(['uninstall', '--config-dir', e.ctx.configDir], { out: l => out.push(l), err: l => out.push(l), env: e.ctx.env, cwd: e.dir, claudeBin: e.stub })
  assert.equal(code, 0)
  const text = out.join('\n')
  assert.equal(out[0], 'nothing to uninstall: ctk owns nothing here')
  assert.ok(!/incomplete/.test(text))
  assert.match(text, /no ledger: ctk owns nothing here and changed nothing/)
  assert.match(text, /\/plugin uninstall ctk@ctk-kit \(and \/plugin marketplace remove ctk-kit\)/)
  assert.ok(text.includes(e.ctx.paths.statsDir))
  assert.match(text, process.platform === 'win32' ? /rmdir \/s \/q/ : /delete them with: rm -rf '/)
  assert.deepEqual(snapshot(e.ctx.configDir), before, 'nothing was changed')
  assert.ok(existsSync(join(e.ctx.paths.statsDir, 's1.json')))

  const none = makeEnv(t)
  const out2: string[] = []
  await main(['uninstall', '--config-dir', none.ctx.configDir], { out: l => out2.push(l), err: l => out2.push(l), env: none.ctx.env, cwd: none.dir, claudeBin: none.stub })
  assert.match(out2.join('\n'), /no stats directory at /)
})
