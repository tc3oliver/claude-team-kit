import assert from 'node:assert/strict'
import { chmodSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { main } from '../src/cli/index.ts'
import { runInstall } from '../src/install/install.ts'
import { runUpdate } from '../src/install/update.ts'
import { makeEnv, snapshot } from './helpers.ts'

const flags = { statusline: true, enableTeams: true }
const NEXT = ['Restart Claude Code (or run /reload-plugins).', 'Try: /ctk:team <goal>   (status: /ctk-stats)', 'Undo any time: ctk uninstall']

/** Run the real router (installing from the real package) against the stub claude. */
const cli = async (e: ReturnType<typeof makeEnv>, args: string[], env: Record<string, string> = {}) => {
  const out: string[] = []
  const err: string[] = []
  const code = await main([...args, '--config-dir', e.ctx.configDir], { out: l => out.push(l), err: l => err.push(l), env: { ...e.ctx.env, ...env }, cwd: e.dir, claudeBin: e.stub })
  return { code, out, err }
}

const noStack = (lines: string[]) => assert.ok(!lines.join('\n').split('\n').some(l => /^\s+at .*\(.*:\d+:\d+\)/.test(l)), 'no stack trace')

test('claude missing: the cause and the fix, exit 1, for install, update and --json', async t => {
  const e = makeEnv(t, { claudeBin: '/nonexistent/claude' })
  const msg = 'Claude Code was not found. Install it from https://code.claude.com/docs/en/quickstart, then run ctk install again.'
  const r = await runInstall(e.ctx, flags, e.root)
  assert.equal(r.code, 1)
  assert.deepEqual(r.lines, [`error: ${msg}`])
  assert.equal((await runUpdate(e.ctx, e.root)).lines[0], `error: ${msg}`)
  const out: string[] = []
  const code = await main(['install', '--json', '--config-dir', e.ctx.configDir], { out: l => out.push(l), err: l => out.push(l), env: e.ctx.env, cwd: e.dir, claudeBin: '/nonexistent/claude' })
  assert.equal(code, 1)
  assert.equal(JSON.parse(out.join('\n')).error, msg)
})

test('Claude Code older than 2.1.287: says what is unavailable and which version is needed, then installs the rest', async t => {
  const e = makeEnv(t, {}, { STUB_VERSION: '2.1.200' })
  const r = await runInstall(e.ctx, flags, e.root)
  assert.equal(r.code, 0, r.lines.join('\n'))
  const text = r.lines.join('\n')
  assert.match(text, /Claude Code 2\.1\.200 is older than 2\.1\.287, the first release with plugin mods/)
  assert.match(text, /team cap, the team band and stats recording stay inactive/)
  assert.match(text, /needs >= 2\.1\.287/)
  assert.match(text, /skills, agents and the status line still install/)
  assert.equal(r.data.mods, false)
})

test('invalid settings.json: names the file, says ctk will not modify it, exit 1, no stack trace, file untouched', async t => {
  const e = makeEnv(t)
  writeFileSync(e.ctx.paths.settings, '{ "theme": ')
  const before = snapshot(e.ctx.configDir)
  const r = await cli(e, ['install'])
  assert.equal(r.code, 1)
  const text = r.err.join('\n')
  assert.ok(text.includes(e.ctx.paths.settings))
  assert.match(text, /not valid JSON/)
  assert.match(text, /ctk will not modify .*settings\.json; fix it by hand/)
  noStack(r.err)
  assert.deepEqual(snapshot(e.ctx.configDir), before)
})

test('a failing `claude plugin` command shows Claude\'s stderr and says re-running is safe', async t => {
  for (const failing of ['marketplace add', 'install ctk@ctk-kit']) {
    const e = makeEnv(t)
    const r = await cli(e, ['install'], { STUB_FAIL: failing })
    assert.equal(r.code, 1, failing)
    const text = r.err.join('\n')
    assert.match(text, new RegExp(`claude plugin ${failing}.* failed \\(exit 1\\): stub: forced failure`), failing)
    assert.match(text, /running the command again is safe/)
    noStack(r.err)
  }
})

test('config dir not writable: names the path, exit 1', { skip: process.getuid?.() === 0 ? 'root ignores permissions' : false }, async t => {
  const e = makeEnv(t)
  chmodSync(e.ctx.configDir, 0o500)
  try {
    const r = await cli(e, ['install'])
    assert.equal(r.code, 1)
    assert.ok(r.err.join('\n').includes(`the Claude config dir ${e.ctx.configDir} is not writable`))
    noStack(r.err)
  } finally {
    chmodSync(e.ctx.configDir, 0o700)
  }
})

test('an incomplete package (plugin/ or .claude-plugin/ missing) is named, exit 1, nothing runs', async t => {
  for (const rel of ['.claude-plugin', join('plugin', 'ctk', '.claude-plugin')]) {
    const e = makeEnv(t)
    rmSync(join(e.root, rel), { recursive: true })
    const r = await runInstall(e.ctx, flags, e.root)
    assert.equal(r.code, 1)
    assert.match(r.lines[0] as string, /is incomplete \(missing .*\)/)
    assert.ok((r.lines[0] as string).includes(e.root))
    assert.equal((await runUpdate(e.ctx, e.root)).code, 1)
    assert.deepEqual(e.log(), [], 'claude was never run')
  }
})

test('a successful install ends with exactly the three next-step lines; the no-op path prints them once', async t => {
  const e = makeEnv(t)
  const r = await runInstall(e.ctx, flags, e.root)
  assert.deepEqual(r.lines.slice(-3), NEXT)
  assert.equal(r.lines.filter(l => NEXT.includes(l)).length, 3)
  assert.deepEqual(r.data.nextSteps, NEXT)
  const again = await runInstall(e.ctx, flags, e.root)
  assert.match(again.lines.join('\n'), /already installed; nothing to change\./)
  assert.deepEqual(again.lines.slice(-3), NEXT)
  assert.equal(again.lines.filter(l => NEXT.includes(l)).length, 3)
  const dry = await runInstall({ ...e.ctx, dryRun: true }, flags, e.root)
  assert.equal(dry.lines.filter(l => NEXT.includes(l)).length, 0, 'a dry run installs nothing, so no next steps')
})
