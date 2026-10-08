import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { EXIT } from '../src/cli/context.ts'
import { bareRemote, device, git, readProfile, registerCleanup, remoteRefs, snapshot, workClone, writeProfile, writeSkill, type Device } from './sync.helpers.ts'

registerCleanup()

const SKILL_MD = '---\nname: alpha\ndescription: test skill\n---\nDo the thing.\n'
const fixture = () => ({ remote: bareRemote(), a: device('laptop'), b: device('desktop') })

/** Device a: profile + a skill, published to an empty remote. */
const seeded = async () => {
  const f = fixture()
  assert.equal(await f.a.sync('init', '--remote', f.remote), 0)
  writeProfile(f.a, { team: { maxWorkers: 5 }, skills: ['alpha'] })
  writeSkill(f.a, 'alpha', { 'SKILL.md': SKILL_MD, 'references/notes.md': 'notes\n' })
  assert.equal(await f.a.sync('publish'), 0, f.a.out.join('\n'))
  return f
}

const headMessage = (remote: string) => git(remote, 'log', '-1', '--format=%B').trim()

test('init: clones an empty remote, is idempotent, refuses a different remote', async () => {
  const { remote, a } = fixture()
  assert.equal(await a.sync('init', '--remote', remote), 0)
  assert.ok(existsSync(join(a.repo, '.git')))
  assert.deepEqual(JSON.parse(readFileSync(a.ctx.paths.syncConfig, 'utf8')), { remote, branch: 'main' })
  assert.equal(await a.sync('init', '--remote', remote), 0)
  assert.match(a.out.join('\n'), /already set up/)
  assert.equal(await a.sync('init', '--remote', bareRemote()), EXIT.error)
  assert.match(a.err.join('\n') + a.out.join('\n'), /refusing to switch/)
  assert.equal(await a.sync('init', '--remote', remote, '--branch', 'other'), EXIT.error)
})

test('init: rejects option-like and command-running remotes, unreachable remotes leave nothing behind', async () => {
  const a = device('laptop')
  assert.equal(await a.sync('init', '--remote=--upload-pack=touch x'), EXIT.error)
  assert.equal(await a.sync('init', '--remote', 'ext::sh -c touch% x'), EXIT.error)
  assert.equal(await a.sync('init', '--remote', join(a.ctx.cwd, 'does-not-exist.git')), EXIT.error)
  assert.equal(existsSync(a.repo), false)
  assert.equal(existsSync(a.ctx.paths.syncConfig), false)
  assert.deepEqual(readdirSync(a.ctx.paths.syncDir), [], 'a failed init removes its scratch clone')
})

test('init: a non-empty remote that is not a CTK profile repo is refused', async () => {
  const remote = bareRemote()
  const w = workClone(remote)
  writeFileSync(join(w, 'README.md'), 'hello\n')
  git(w, 'add', '.')
  git(w, 'commit', '-qm', 'readme')
  git(w, 'push', '-q', 'origin', 'HEAD:refs/heads/main')
  const a = device('laptop')
  assert.equal(await a.sync('init', '--remote', remote), EXIT.error)
  assert.match(a.err.join('\n') + a.out.join('\n'), /not a CTK profile repo/)
  assert.equal(existsSync(a.repo), false)
})

test('round trip: publish from one device, pull on another', async () => {
  const { remote, a, b } = await seeded()
  assert.equal(headMessage(remote), 'ctk: update profile default from laptop')
  assert.ok(!/co-authored|generated with/i.test(git(remote, 'log', '--format=%B')))
  const files = git(remote, 'ls-tree', '-r', '--name-only', 'main').trim().split('\n')
  assert.deepEqual(files, ['ctk-profile.json', 'profiles/default.json', 'skills/alpha/SKILL.md', 'skills/alpha/references/notes.md'])

  assert.equal(await b.sync('init', '--remote', remote), 0)
  assert.equal(await b.sync(), 0, b.out.join('\n'))
  assert.equal((readProfile(b).team as { maxWorkers: number }).maxWorkers, 5)
  assert.deepEqual(readProfile(b).skills, ['alpha'])
  assert.equal(readFileSync(join(b.ctx.paths.skillsDir, 'alpha', 'SKILL.md'), 'utf8'), SKILL_MD)
  assert.ok(existsSync(join(b.ctx.paths.skillsDir, 'alpha', '.ctk-managed')))
  assert.deepEqual(b.applied, [{ op: 'sync-pull', maxWorkers: 5 }])
  assert.ok(existsSync(b.ctx.paths.syncBase))
  assert.equal(existsSync(b.ctx.paths.syncConflicts), false)
})

test('idempotent: a second pull and a second publish write nothing', async () => {
  const { remote, a, b } = await seeded()
  await b.sync('init', '--remote', remote)
  assert.equal(await b.sync('pull'), 0)
  const before = snapshot(b.ctx.configDir)
  const calls = b.applied.length
  assert.equal(await b.sync('pull'), 0)
  assert.deepEqual(snapshot(b.ctx.configDir), before)
  assert.equal(b.applied.length, calls, 'applyProfile is not called when nothing changed')

  const refs = remoteRefs(remote)
  const aBefore = snapshot(a.ctx.configDir)
  assert.equal(await a.sync('publish'), 0)
  assert.match(a.out.slice(-1)[0] ?? '', /nothing to publish/)
  assert.equal(remoteRefs(remote), refs)
  assert.deepEqual(snapshot(a.ctx.configDir), aBefore)
})

test('non-overlapping edits on two devices merge without conflict', async () => {
  const { remote, a, b } = await seeded()
  await b.sync('init', '--remote', remote)
  await b.sync('pull')
  // b changes maxWorkers locally; a changes hud.band and publishes
  writeProfile(b, { ...readProfile(b), team: { maxWorkers: 4 } })
  writeProfile(a, { ...readProfile(a), hud: { band: false } })
  assert.equal(await a.sync('publish'), 0)
  assert.equal(await b.sync('pull'), 0, b.out.join('\n'))
  const p = readProfile(b)
  assert.deepEqual(p.team, { maxWorkers: 4 })
  assert.deepEqual(p.hud, { band: false })
  // b publishes its edit; a pulls it
  assert.equal(await b.sync('publish'), 0)
  assert.equal(await a.sync('pull'), 0)
  assert.deepEqual(readProfile(a).team, { maxWorkers: 4 })
  assert.deepEqual(readProfile(a).hud, { band: false })
})

test('a local edit survives a pull that has nothing new (base is the remote state, not the merge)', async () => {
  const { remote, b } = await seeded()
  await b.sync('init', '--remote', remote)
  await b.sync('pull')
  writeProfile(b, { ...readProfile(b), team: { maxWorkers: 2 } })
  assert.equal(await b.sync('pull'), 0)
  assert.deepEqual(readProfile(b).team, { maxWorkers: 2 })
  assert.equal(await b.sync('pull'), 0)
  assert.deepEqual(readProfile(b).team, { maxWorkers: 2 })
})

test('conflict: written to conflicts.json, local profile untouched, exit 2; resolve theirs / ours', async () => {
  const { remote, a, b } = await seeded()
  await b.sync('init', '--remote', remote)
  await b.sync('pull')
  writeProfile(b, { ...readProfile(b), team: { maxWorkers: 4 } })
  writeProfile(a, { ...readProfile(a), team: { maxWorkers: 6 } })
  await a.sync('publish')

  const profileBefore = readFileSync(b.ctx.paths.profile, 'utf8')
  const calls = b.applied.length
  assert.equal(await b.sync('pull'), EXIT.attention)
  assert.equal(readFileSync(b.ctx.paths.profile, 'utf8'), profileBefore)
  assert.equal(b.applied.length, calls)
  const file = JSON.parse(readFileSync(b.ctx.paths.syncConflicts, 'utf8')) as { conflicts: { key: string; base: number; ours: number; theirs: number }[] }
  assert.deepEqual(file.conflicts, [{ key: '/team/maxWorkers', base: 5, ours: 4, theirs: 6 }])

  // a second pull reports the same conflict and rewrites nothing
  const snap = snapshot(b.ctx.configDir)
  assert.equal(await b.sync('pull'), EXIT.attention)
  assert.deepEqual(snapshot(b.ctx.configDir), snap)
  assert.equal(await b.sync('status'), EXIT.attention)
  // publish refuses while a conflict is open
  assert.equal(await b.sync('publish'), EXIT.attention)
  assert.match(b.out.join('\n'), /publish aborted/)

  assert.equal(await b.sync('resolve', '/team/maxWorkers', 'theirs'), 0, b.out.join('\n'))
  assert.deepEqual(readProfile(b).team, { maxWorkers: 6 })
  assert.equal(existsSync(b.ctx.paths.syncConflicts), false)
  assert.equal(b.applied.at(-1)?.maxWorkers, 6)
  assert.equal(await b.sync('pull'), 0)

  // resolve ours: keeps the local value and publishes it
  writeProfile(b, { ...readProfile(b), team: { maxWorkers: 3 } })
  writeProfile(a, { ...readProfile(a), team: { maxWorkers: 7 } })
  await a.sync('publish')
  assert.equal(await b.sync('pull'), EXIT.attention)
  assert.equal(await b.sync('resolve', '/team/maxWorkers', 'ours'), 0)
  assert.deepEqual(readProfile(b).team, { maxWorkers: 3 })
  assert.equal(await b.sync('publish'), 0, b.out.join('\n'))
  assert.match(git(remote, 'show', 'main:profiles/default.json'), /"maxWorkers": 3/)
  assert.equal(await b.sync('resolve', '/team/maxWorkers', 'ours'), EXIT.error, 'nothing left to resolve')
})

test('delete vs modify is a conflict', async () => {
  const { remote, a, b } = await seeded()
  await b.sync('init', '--remote', remote)
  await b.sync('pull')
  writeProfile(a, { team: { maxWorkers: 5 }, skills: ['alpha'] }) // a deletes nothing yet; add hud then remove
  writeProfile(b, { ...readProfile(b), team: { maxWorkers: 8 } })
  const { team: _drop, ...withoutTeam } = readProfile(a)
  writeProfile(a, withoutTeam)
  await a.sync('publish')
  assert.equal(await b.sync('pull'), EXIT.attention)
  const c = JSON.parse(readFileSync(b.ctx.paths.syncConflicts, 'utf8')) as { conflicts: Record<string, unknown>[] }
  assert.equal(c.conflicts.length, 1)
  assert.equal(c.conflicts[0]?.key, '/team/maxWorkers')
  assert.equal(Object.hasOwn(c.conflicts[0] ?? {}, 'theirs'), false)
  assert.equal(c.conflicts[0]?.ours, 8)
  assert.equal(await b.sync('resolve', '/team/maxWorkers', 'theirs'), 0)
  assert.equal(readProfile(b).team, undefined)
})

test('pull is fast-forward only: a diverged clone is reported and left unchanged', async () => {
  const { remote, a, b } = await seeded()
  await b.sync('init', '--remote', remote)
  await b.sync('pull')
  // an unpushed commit in b's clone, while the remote moves on
  writeFileSync(join(b.repo, 'local.txt'), 'x')
  git(b.repo, 'add', 'local.txt')
  git(b.repo, 'commit', '-qm', 'local only')
  writeProfile(a, { ...readProfile(a), hud: { band: false } })
  await a.sync('publish')
  const head = git(b.repo, 'rev-parse', 'HEAD')
  assert.equal(await b.sync('pull'), EXIT.attention)
  assert.match(b.out.join('\n'), /diverged/)
  assert.equal(git(b.repo, 'rev-parse', 'HEAD'), head)
  assert.equal(git(b.repo, 'status', '--porcelain'), '')
})

test('publish never force-pushes: a rejected push rolls the clone back and exits 2', async () => {
  const { remote, a } = await seeded()
  writeFileSync(join(remote, 'hooks', 'pre-receive'), '#!/bin/sh\necho rejected by test >&2\nexit 1\n')
  chmodSync(join(remote, 'hooks', 'pre-receive'), 0o755)
  const head = git(a.repo, 'rev-parse', 'HEAD')
  const refs = remoteRefs(remote)
  writeProfile(a, { ...readProfile(a), hud: { band: false } })
  assert.equal(await a.sync('publish'), EXIT.attention)
  assert.equal(git(a.repo, 'rev-parse', 'HEAD'), head)
  assert.equal(git(a.repo, 'status', '--porcelain'), '')
  assert.equal(remoteRefs(remote), refs)
  // the clone is usable afterwards
  assert.equal(await a.sync('pull'), 0)
})

test('a rejected first push leaves an empty, clean clone that can publish later', async () => {
  const { remote, a } = fixture()
  await a.sync('init', '--remote', remote)
  writeFileSync(join(remote, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n')
  chmodSync(join(remote, 'hooks', 'pre-receive'), 0o755)
  writeProfile(a, { team: { maxWorkers: 2 } })
  assert.equal(await a.sync('publish'), EXIT.attention)
  assert.equal(git(a.repo, 'status', '--porcelain'), '')
  assert.equal(existsSync(join(a.repo, 'profiles', 'default.json')), false)
  rmSync(join(remote, 'hooks', 'pre-receive'))
  assert.equal(await a.sync('publish'), 0, a.out.join('\n'))
  assert.match(git(remote, 'show', 'main:profiles/default.json'), /"maxWorkers": 2/)
})

test('dry-run: init, pull and publish write nothing locally or remotely', async () => {
  const { remote } = await seeded()
  const c = device('desktop', { dryRun: true })
  assert.equal(await c.sync('init', '--remote', remote), 0)
  assert.equal(existsSync(c.ctx.paths.ctk), false)

  const b = device('desktop')
  await b.sync('init', '--remote', remote)
  const bDry = { ...b.ctx, dryRun: true }
  const { runSync } = await import('../src/cli/commands/sync.ts')
  const before = snapshot(b.ctx.configDir)
  assert.equal(await runSync(['pull'], bDry, b.deps), 0)
  assert.deepEqual(snapshot(b.ctx.configDir), before)
  assert.deepEqual(b.applied, [])

  await b.sync('pull')
  writeProfile(b, { ...readProfile(b), hud: { band: false } })
  const refs = remoteRefs(remote)
  const snap = snapshot(b.ctx.configDir)
  const out: string[] = []
  assert.equal(await runSync(['publish'], { ...bDry, out: l => out.push(l) }, b.deps), 0)
  assert.match(out.join('\n'), /would write profiles\/default\.json/)
  assert.match(out.join('\n'), /secrets scan: clean/)
  assert.equal(remoteRefs(remote), refs)
  assert.deepEqual(snapshot(b.ctx.configDir), snap)
  assert.equal(git(b.repo, 'status', '--porcelain'), '')
})

test('the device layer is never published', async () => {
  const { remote, a } = await seeded()
  mkdirSync(a.ctx.paths.devicesDir, { recursive: true })
  writeFileSync(a.ctx.paths.deviceFile('laptop'), `${JSON.stringify({ schemaVersion: 1, hud: { statusLine: 'off' }, team: { maxWorkers: 11 } })}\n`)
  writeProfile(a, { ...readProfile(a), hud: { band: false } })
  assert.equal(await a.sync('publish'), 0)
  const all = git(remote, 'log', '-p', '--all')
  assert.ok(!all.includes('statusLine'))
  assert.ok(!all.includes('"maxWorkers": 11'))
  assert.ok(!git(remote, 'ls-tree', '-r', '--name-only', 'main').includes('devices'))
})

test('a secret in a profile value blocks publish and leaves the repo untouched', async () => {
  const { remote, a } = await seeded()
  const refs = remoteRefs(remote)
  const head = git(a.repo, 'rev-parse', 'HEAD')
  const secret = `sk-ant-api03-${'q7Zk3Vn9Xb2LmP4wR8tY1cHd5FgJ6sAe'.repeat(2)}`
  writeProfile(a, { ...readProfile(a), portable: { settings: { model: secret } } })
  assert.equal(await a.sync('publish'), EXIT.error)
  const text = a.out.join('\n') + a.err.join('\n')
  assert.match(text, /anthropic-key/)
  assert.match(text, /profiles\/default\.json:\d+/)
  assert.ok(!text.includes(secret.slice(8, 40)))
  assert.equal(remoteRefs(remote), refs)
  assert.equal(git(a.repo, 'rev-parse', 'HEAD'), head)
  assert.equal(git(a.repo, 'status', '--porcelain'), '')
  assert.ok(!readFileSync(join(a.repo, 'profiles', 'default.json'), 'utf8').includes('sk-ant'))
})

test('a secret in a skill blocks publish', async () => {
  const { remote, a } = await seeded()
  const refs = remoteRefs(remote)
  writeSkill(a, 'alpha', { 'references/env.md': `aws key ${'AKIA'}${'IOSFODNN7EXAMPLE'}\n` })
  assert.equal(await a.sync('publish'), EXIT.error)
  assert.match(a.out.join('\n'), /skills\/alpha\/references\/env\.md:1 aws-access-key/)
  assert.equal(remoteRefs(remote), refs)
  assert.equal(git(a.repo, 'status', '--porcelain'), '')
  assert.ok(!existsSync(join(a.repo, 'skills', 'alpha', 'references', 'env.md')))
})

test('publish refuses skills that break the whitelist (symlink, extension)', async () => {
  const { remote, a } = await seeded()
  const refs = remoteRefs(remote)
  writeSkill(a, 'alpha', { 'bin/tool.exe': 'x' })
  assert.equal(await a.sync('publish'), EXIT.error)
  assert.match(a.out.join('\n'), /extension not allowed/)
  rmSync(join(a.ctx.paths.skillsDir, 'alpha', 'bin', 'tool.exe'), { force: true })
  symlinkSync(join(a.ctx.cwd, 'x'), join(a.ctx.paths.skillsDir, 'alpha', 'link.md'))
  a.out.length = 0
  assert.equal(await a.sync('publish'), EXIT.error)
  assert.match(a.out.join('\n'), /symlinks are not allowed/)
  assert.equal(remoteRefs(remote), refs)
})

/** Push arbitrary content to the remote the way a hostile or buggy second client could. */
const tamper = (remote: string, edit: (w: string) => void) => {
  const w = workClone(remote)
  edit(w)
  git(w, 'add', '-A')
  git(w, 'commit', '-qm', 'tamper')
  git(w, 'push', '-q', 'origin', 'HEAD:refs/heads/main')
}

for (const [name, edit, reason] of [
  ['symlink', (w: string) => symlinkSync('/etc/hosts', join(w, 'skills', 'alpha', 'hosts.md')), /symlinks are not allowed/],
  ['extension', (w: string) => writeFileSync(join(w, 'skills', 'alpha', 'run.exe'), 'x'), /extension not allowed/],
  ['oversize', (w: string) => writeFileSync(join(w, 'skills', 'alpha', 'big.md'), 'x'.repeat(300 * 1024)), /larger than/],
] as const) {
  test(`pull refuses an incoming skill with a ${name} and applies nothing`, async () => {
    const { remote, b } = await seeded()
    await b.sync('init', '--remote', remote)
    tamper(remote, edit)
    const before = snapshot(b.ctx.configDir)
    assert.equal(await b.sync('pull'), EXIT.error)
    assert.match(b.out.join('\n'), reason)
    assert.equal(existsSync(b.ctx.paths.profile), false)
    assert.equal(existsSync(join(b.ctx.paths.skillsDir, 'alpha')), false)
    assert.deepEqual(Object.keys(snapshot(b.ctx.configDir)).filter(k => !k.includes('/sync/repo/')), Object.keys(before).filter(k => !k.includes('/sync/repo/')))
    assert.deepEqual(b.applied, [])
  })
}

test('pull refuses incoming content with a secret', async () => {
  const { remote, b } = await seeded()
  await b.sync('init', '--remote', remote)
  tamper(remote, w => writeFileSync(join(w, 'skills', 'alpha', 'SKILL.md'), `${SKILL_MD}\ntoken = "${'Zx9Qw8Er7Ty6Ui5Op3As'}"\n`))
  assert.equal(await b.sync('pull'), EXIT.error)
  assert.match(b.out.join('\n'), /generic-secret/)
  assert.equal(existsSync(b.ctx.paths.profile), false)
  assert.deepEqual(b.applied, [])
})

test('pull ignores everything outside the whitelist and other profiles', async () => {
  const { remote, b } = await seeded()
  await b.sync('init', '--remote', remote)
  tamper(remote, w => {
    mkdirSync(join(w, 'notes'), { recursive: true })
    writeFileSync(join(w, 'notes', 'evil.sh'), 'rm -rf /\n')
    writeFileSync(join(w, 'profiles', 'other.json'), `${JSON.stringify({ schemaVersion: 1, team: { maxWorkers: 12 } })}\n`)
    mkdirSync(join(w, 'skills', 'unlisted'), { recursive: true })
    writeFileSync(join(w, 'skills', 'unlisted', 'SKILL.md'), 'x')
  })
  assert.equal(await b.sync('pull'), 0)
  assert.deepEqual(readProfile(b).team, { maxWorkers: 5 })
  assert.equal(existsSync(join(b.ctx.paths.skillsDir, 'unlisted')), false)
  assert.equal(existsSync(join(b.ctx.configDir, 'notes')), false)
})

test('skill edits and deletions propagate; an unmanaged local directory is never overwritten', async () => {
  const { remote, a, b } = await seeded()
  await b.sync('init', '--remote', remote)
  await b.sync('pull')
  writeSkill(a, 'alpha', { 'SKILL.md': `${SKILL_MD}more\n` })
  rmSync(join(a.ctx.paths.skillsDir, 'alpha', 'references', 'notes.md'))
  assert.equal(await a.sync('publish'), 0, a.out.join('\n'))
  assert.equal(git(remote, 'ls-tree', '-r', '--name-only', 'main').includes('notes.md'), false)
  assert.equal(await b.sync('pull'), 0)
  assert.equal(readFileSync(join(b.ctx.paths.skillsDir, 'alpha', 'SKILL.md'), 'utf8'), `${SKILL_MD}more\n`)
  assert.equal(existsSync(join(b.ctx.paths.skillsDir, 'alpha', 'references')), false)

  // a third device already has its own unmarked alpha: differing content is a conflict, never overwritten
  const c = device('tablet')
  await c.sync('init', '--remote', remote)
  writeSkill(c, 'alpha', { 'SKILL.md': 'my own skill\n' })
  assert.equal(await c.sync('pull'), EXIT.attention)
  assert.equal(readFileSync(join(c.ctx.paths.skillsDir, 'alpha', 'SKILL.md'), 'utf8'), 'my own skill\n')
  assert.equal(existsSync(join(c.ctx.paths.skillsDir, 'alpha', '.ctk-managed')), false)
  const conflicts = JSON.parse(readFileSync(c.ctx.paths.syncConflicts, 'utf8')) as { conflicts: { key: string }[] }
  assert.ok(conflicts.conflicts.some(x => x.key === 'skills/alpha/SKILL.md'))
  // resolving with theirs into an unmanaged directory is refused
  assert.equal(await c.sync('resolve', 'skills/alpha/SKILL.md', 'theirs'), EXIT.error)
  assert.equal(readFileSync(join(c.ctx.paths.skillsDir, 'alpha', 'SKILL.md'), 'utf8'), 'my own skill\n')
})

test('removing a skill from the profile removes it from the repo unless another profile uses it', async () => {
  const { remote, a } = await seeded()
  writeSkill(a, 'beta', { 'SKILL.md': 'beta\n' })
  writeProfile(a, { ...readProfile(a), skills: ['alpha', 'beta'] })
  await a.sync('publish')
  // another profile in the repo references alpha
  tamper(remote, w => writeFileSync(join(w, 'profiles', 'team.json'), `${JSON.stringify({ schemaVersion: 1, skills: ['alpha'] })}\n`))
  writeProfile(a, { ...readProfile(a), skills: [] })
  assert.equal(await a.sync('publish'), 0, a.out.join('\n'))
  const files = git(remote, 'ls-tree', '-r', '--name-only', 'main')
  assert.ok(files.includes('skills/alpha/SKILL.md'), 'still used by profiles/team.json')
  assert.ok(!files.includes('skills/beta'), 'unreferenced skill removed')
})

test('status reports configuration, pending changes and conflicts', async () => {
  const { remote, a, b } = await seeded()
  const un = device('x')
  assert.deepEqual((await un.json('status')).doc.configured, false)
  assert.equal((await a.json('status')).doc.configured, true)
  await b.sync('init', '--remote', remote)
  const s = await b.json('status')
  assert.equal(s.code, 0)
  assert.equal(s.doc.pendingRemoteChanges, 4, 'profile: maxWorkers + skills list; skill: two files')
  assert.ok(typeof s.doc.head === 'string')
  const pull = await b.json('pull')
  assert.equal(pull.doc.status, 'applied')
  assert.equal((pull.doc.applied as string[]).length, 4)
  assert.equal(pull.doc.command, 'sync pull')
  const after = await b.json('status')
  assert.equal(after.doc.pendingRemoteChanges, 0)
  assert.equal(after.doc.pendingLocalChanges, 0)
  writeProfile(b, { ...readProfile(b), hud: { band: false } })
  assert.equal((await b.json('status')).doc.pendingLocalChanges, 1)
})

test('apply conflicts reported by applyProfile make pull exit 2', async () => {
  const { remote, b } = await seeded()
  await b.sync('init', '--remote', remote)
  b.deps.applyProfile = async () => ({ changed: false, conflicts: [{ pointer: '/model', reason: 'user value present' }], skipped: [] })
  assert.equal(await b.sync('pull'), EXIT.attention)
  assert.match(b.out.join('\n'), /settings conflict \/model/)
})

test('usage errors: unknown subcommand, resolve without arguments, sync before init', async () => {
  const a = device('laptop')
  assert.equal(await a.sync('frobnicate'), EXIT.error)
  assert.equal(await a.sync('pull'), EXIT.error)
  assert.match(a.err.join('\n') + a.out.join('\n'), /not set up/)
  assert.equal(await a.sync('resolve'), EXIT.error)
  assert.equal(await a.sync('--help'), 0)
})

test('publish needs a local profile and a profile repo marker is written once', async () => {
  const { remote, a } = fixture()
  await a.sync('init', '--remote', remote)
  assert.equal(await a.sync('publish'), EXIT.error)
  assert.match(a.err.join('\n') + a.out.join('\n'), /no local profile/)
  writeProfile(a, { team: { maxWorkers: 2 } })
  assert.equal(await a.sync('publish', '-m', 'custom message'), 0)
  assert.equal(headMessage(remote), 'custom message')
  assert.deepEqual(JSON.parse(git(remote, 'show', 'main:ctk-profile.json')), { schemaVersion: 1, name: 'default' })
})
