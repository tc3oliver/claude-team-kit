import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { main } from '../src/cli/index.ts'
import { EXPLORE_AGENT, runExplore } from '../src/cli/commands/explore.ts'
import { makeEnv } from './helpers.ts'

test('project Explore opt-in is dry-run safe, idempotent and reversible', t => {
  const e = makeEnv(t)
  const path = join(e.dir, '.claude', 'agents', 'Explore.md')
  const opts = { user: false }

  assert.equal(runExplore({ ...e.ctx, dryRun: true }, ['enable'], opts).code, 0)
  assert.equal(existsSync(path), false)
  assert.equal(runExplore(e.ctx, ['status'], opts).data.state, 'absent')

  assert.equal(runExplore(e.ctx, ['enable'], opts).code, 0)
  assert.equal(readFileSync(path, 'utf8'), EXPLORE_AGENT)
  assert.match(EXPLORE_AGENT, /^name: Explore$/m)
  assert.match(EXPLORE_AGENT, /^model: haiku$/m)
  assert.match(EXPLORE_AGENT, /^omitClaudeMd: true$/m)
  assert.equal(runExplore(e.ctx, ['enable'], opts).data.state, 'managed')
  assert.equal(runExplore(e.ctx, ['status'], opts).data.state, 'managed')

  assert.equal(runExplore({ ...e.ctx, dryRun: true }, ['disable'], opts).code, 0)
  assert.equal(existsSync(path), true)
  assert.equal(runExplore(e.ctx, ['disable'], opts).code, 0)
  assert.equal(existsSync(path), false)
  assert.equal(runExplore(e.ctx, ['disable'], opts).code, 0)
})

test('user scope uses the selected Claude config directory, not the project', t => {
  const e = makeEnv(t)
  const path = join(e.ctx.configDir, 'agents', 'Explore.md')
  assert.equal(runExplore(e.ctx, ['enable'], { user: true }).code, 0)
  assert.equal(readFileSync(path, 'utf8'), EXPLORE_AGENT)
  assert.equal(existsSync(join(e.dir, '.claude', 'agents', 'Explore.md')), false)
  assert.equal(runExplore(e.ctx, ['disable'], { user: true }).code, 0)
})

test('existing custom Explore remains untouched through enable and disable', t => {
  const e = makeEnv(t)
  const path = join(e.dir, '.claude', 'agents', 'Explore.md')
  mkdirSync(join(e.dir, '.claude', 'agents'), { recursive: true })
  const custom = '---\nname: Explore\nmodel: opus\n---\ncustom\n'
  writeFileSync(path, custom)
  assert.equal(runExplore(e.ctx, ['enable'], { user: false }).code, 2)
  assert.equal(runExplore(e.ctx, ['disable'], { user: false }).code, 2)
  assert.equal(runExplore(e.ctx, ['status'], { user: false }).data.state, 'conflict')
  assert.equal(readFileSync(path, 'utf8'), custom)
})

test('edited managed Explore is never removed', t => {
  const e = makeEnv(t)
  const path = join(e.dir, '.claude', 'agents', 'Explore.md')
  runExplore(e.ctx, ['enable'], { user: false })
  writeFileSync(path, EXPLORE_AGENT + '# local edit\n')
  assert.equal(runExplore(e.ctx, ['disable'], { user: false }).code, 2)
  assert.match(readFileSync(path, 'utf8'), /local edit/)
})

test('symlinked agent directories are refused (and their targets untouched)', t => {
  if (process.platform === 'win32') return t.skip('Windows symlinks may require elevated privileges')
  const e = makeEnv(t)
  const target = join(e.dir, 'unrelated')
  mkdirSync(target)
  mkdirSync(join(e.dir, '.claude'))
  symlinkSync(target, join(e.dir, '.claude', 'agents'))
  assert.equal(runExplore(e.ctx, ['enable'], { user: false }).code, 2)
  assert.equal(existsSync(join(target, 'Explore.md')), false)
})

test('CLI command supports --help, --json, --dry-run, --user and errors', async t => {
  const e = makeEnv(t)
  const out: string[] = []
  const err: string[] = []
  const io = { env: e.ctx.env, cwd: e.dir, out: (s: string) => out.push(s), err: (s: string) => err.push(s), claudeBin: e.stub }
  const base = ['--config-dir', e.ctx.configDir]
  assert.equal(await main([...base, 'explore', '--help'], io), 0)
  assert.match(out.pop() as string, /Usage: ctk explore/)
  assert.equal(await main([...base, 'explore', 'enable', '--user', '--dry-run', '--json'], io), 0)
  assert.equal(JSON.parse(out.pop() as string).state, 'planned')
  assert.equal(existsSync(join(e.ctx.configDir, 'agents', 'Explore.md')), false)
  assert.equal(await main([...base, 'explore', 'enable', '--user', '--json'], io), 0)
  assert.equal(JSON.parse(out.pop() as string).state, 'managed')
  assert.equal(await main([...base, 'explore', 'disable', '--user', '--json'], io), 0)
  assert.equal(JSON.parse(out.pop() as string).state, 'absent')
  assert.equal(await main([...base, 'explore', 'unknown', '--json'], io), 1)
  assert.match(JSON.parse(out.pop() as string).error, /usage/)
  assert.deepEqual(err, [])
})
