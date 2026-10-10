import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

import { EXIT } from '../src/cli/context.ts'
import { staleSkillPaths } from '../src/sync/engine.ts'
import { bareRemote, tmp, device, git, readProfile, registerCleanup, remoteRefs, snapshot, workClone, writeProfile, writeSkill, type Device } from './sync.helpers.ts'

registerCleanup()

// chmod-based fault injection does not work as root or on Windows (POSIX modes are not enforced).
const NO_CHMOD_FIXTURE = process.getuid?.() === 0 ? 'root bypasses file permissions' : process.platform === 'win32' ? 'Windows does not enforce POSIX permission bits' : false

// Git for Windows checks symlinks out as plain files unless core.symlinks is on (needs a privilege),
// and Windows file names cannot hold control characters: those fixtures cannot exist there.
const NO_SYMLINK_FIXTURE = process.platform === 'win32' ? 'symlink fixtures need core.symlinks and a privilege on Windows' : false
const NO_CONTROL_NAMES = process.platform === 'win32' ? 'Windows file names cannot contain control characters' : false

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

// The unreadable root has to be the skill's PARENT (lstat on a chmod-000 dir itself succeeds), so
// nothing is published first: pull would otherwise plan a deletion it cannot write.
test('publish refuses a skill root that cannot be read (EACCES), not an empty skill', { skip: NO_CHMOD_FIXTURE }, async () => {
  const f = fixture()
  assert.equal(await f.a.sync('init', '--remote', f.remote), 0)
  writeProfile(f.a, { team: { maxWorkers: 5 }, skills: ['beta'] })
  writeSkill(f.a, 'beta', { 'SKILL.md': SKILL_MD })
  try {
    chmodSync(f.a.ctx.paths.skillsDir, 0o000)
    f.a.out.length = 0
    assert.equal(await f.a.sync('publish'), EXIT.error)
    assert.match(f.a.out.join('\n'), /skill beta: .*directory unreadable \(EACCES\)/)
    assert.match(f.a.out.join('\n'), /nothing was published/)
  } finally {
    chmodSync(f.a.ctx.paths.skillsDir, 0o755)
  }
  assert.equal(remoteRefs(f.remote), '', 'the remote was not touched')
  assert.equal(await f.a.sync('publish'), 0, f.a.out.join('\n'))
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
  test(`pull refuses an incoming skill with a ${name} and applies nothing`, { skip: name === 'symlink' && NO_SYMLINK_FIXTURE }, async () => {
    const { remote, b } = await seeded()
    await b.sync('init', '--remote', remote)
    tamper(remote, edit)
    const before = snapshot(b.ctx.configDir)
    assert.equal(await b.sync('pull'), EXIT.error)
    assert.match(b.out.join('\n'), reason)
    assert.equal(existsSync(b.ctx.paths.profile), false)
    assert.equal(existsSync(join(b.ctx.paths.skillsDir, 'alpha')), false)
    const outsideClone = (m: Record<string, string>) => Object.keys(m).filter(k => !k.replaceAll('\\', '/').includes('/sync/repo/'))
    assert.deepEqual(outsideClone(snapshot(b.ctx.configDir)), outsideClone(before))
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

const SIBLING = `${JSON.stringify({ schemaVersion: 1, skills: ['alpha'] })}\n`

/** A tracked profiles/<other>.json that cannot be read/validated must refuse the whole publish (fail closed). */
const siblingRefusal = async (name: string, sibling: string, breakIt: (a: Device) => void) => {
  const { remote, a } = await seeded()
  tamper(remote, w => writeFileSync(join(w, 'profiles', 'team.json'), sibling))
  writeProfile(a, { ...readProfile(a), skills: [] })
  assert.equal(await a.sync('pull'), 0, name) // publish's own pull would move HEAD; settle it first
  // Without this, git reports the broken sibling as an uncommitted change and requireClean refuses
  // before the sibling check runs; assume-unchanged isolates the branch under test.
  git(a.repo, 'update-index', '--assume-unchanged', 'profiles/team.json')
  breakIt(a)
  const refs = remoteRefs(remote)
  const head = git(a.repo, 'rev-parse', 'HEAD')
  assert.equal(await a.sync('publish'), EXIT.error, name)
  assert.match(a.out.join('\n') + a.err.join('\n'), /profiles\/team\.json/, name)
  // nothing deleted, committed or pushed
  const files = git(remote, 'ls-tree', '-r', '--name-only', 'main')
  assert.ok(files.includes('skills/alpha/SKILL.md'), name)
  assert.ok(files.includes('skills/alpha/references/notes.md'), name)
  assert.equal(remoteRefs(remote), refs, name)
  assert.equal(git(a.repo, 'rev-parse', 'HEAD'), head, name)
  assert.equal(existsSync(join(a.repo, 'skills', 'alpha', 'SKILL.md')), true, name)
}

test('publish refuses when a tracked sibling profile is invalid JSON (its skills are not deleted)', async () => {
  await siblingRefusal('invalid JSON', '{not json\n', () => {})
})

test('publish refuses when a tracked sibling profile fails the schema', async () => {
  await siblingRefusal('bad schema', `${JSON.stringify({ schemaVersion: 99, skills: ['alpha'] })}\n`, () => {})
})

test('publish refuses when a tracked sibling profile is missing from the checkout', async () => {
  await siblingRefusal('missing', SIBLING, a => rmSync(join(a.repo, 'profiles', 'team.json')))
})

test('publish refuses when a tracked sibling profile is unreadable (permissions)', { skip: NO_CHMOD_FIXTURE }, async () => {
  await siblingRefusal('unreadable', SIBLING, a => chmodSync(join(a.repo, 'profiles', 'team.json'), 0o000))
})

test('a valid sibling profile still keeps its skill on publish', async () => {
  const { remote, a } = await seeded()
  tamper(remote, w => writeFileSync(join(w, 'profiles', 'team.json'), SIBLING))
  writeProfile(a, { ...readProfile(a), skills: [] })
  assert.equal(await a.sync('publish'), 0, a.out.join('\n'))
  const files = git(remote, 'ls-tree', '-r', '--name-only', 'main')
  assert.ok(files.includes('skills/alpha/SKILL.md'), 'still referenced by profiles/team.json')
})

test('staleSkillPaths: unsafe tracked paths are refused, safe ones filtered', () => {
  const planned = new Set(['skills/keep/SKILL.md'])
  const ownSkills = new Set(['keep'])
  // a crafted `..` path in the tracked list must throw, not reach rmSync
  assert.throws(
    () => staleSkillPaths(['skills/keep/SKILL.md', 'skills/../../etc/passwd'], planned, ownSkills, new Set(['etc'])),
    /unsafe/,
  )
  assert.throws(() => staleSkillPaths(['skills/.git/config'], planned, ownSkills, new Set()), /unsafe/)
  // normal filtering: planned files stay, other profiles' skills stay, own unreferenced skills go
  const tracked = ['ctk-profile.json', 'profiles/default.json', 'profiles/team.json', 'skills/keep/SKILL.md', 'skills/theirs/SKILL.md', 'skills/mine/old.md']
  const stale = staleSkillPaths(tracked, planned, new Set(['mine', 'keep']), new Set(['theirs']))
  assert.deepEqual(stale, ['skills/mine/old.md'])
  // an unknown skill nobody references is also stale
  assert.deepEqual(staleSkillPaths(['skills/ghost/SKILL.md'], new Set(), new Set(), new Set()), ['skills/ghost/SKILL.md'])
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

// ---------- round 2 ----------

const treeOf = (dir: string) => Object.keys(snapshot(dir)).sort()

test('a symlinked profiles/ in the remote is a refusal on pull, and nothing is written outside the clone', { skip: NO_SYMLINK_FIXTURE }, async () => {
  const { remote, a } = fixture()
  const outside = tmp('ctk-outside-')
  writeFileSync(join(outside, 'default.json'), `${JSON.stringify({ schemaVersion: 1, team: { maxWorkers: 9 } })}\n`)
  tamper(remote, w => {
    writeFileSync(join(w, 'ctk-profile.json'), `${JSON.stringify({ schemaVersion: 1, name: 'x' })}\n`)
    symlinkSync(outside, join(w, 'profiles'))
  })
  await a.sync('init', '--remote', remote)
  const before = treeOf(outside)
  assert.equal(await a.sync('pull'), EXIT.error)
  assert.match(a.out.join('\n'), /"profiles" is a symlink/)
  writeProfile(a, { team: { maxWorkers: 2 } })
  assert.equal(await a.sync('publish'), EXIT.error)
  assert.deepEqual(treeOf(outside), before)
  assert.equal(existsSync(a.ctx.paths.profile), true)
  assert.deepEqual(a.applied, [])
})

test('a symlinked skills/ in the remote cannot redirect publish writes outside the clone', { skip: NO_SYMLINK_FIXTURE }, async () => {
  const { remote, a } = fixture()
  const outside = tmp('ctk-outside-')
  tamper(remote, w => {
    writeFileSync(join(w, 'ctk-profile.json'), `${JSON.stringify({ schemaVersion: 1, name: 'x' })}\n`)
    mkdirSync(join(w, 'profiles'))
    writeFileSync(join(w, 'profiles', 'default.json'), `${JSON.stringify({ schemaVersion: 1 })}\n`)
    symlinkSync(outside, join(w, 'skills'))
  })
  await a.sync('init', '--remote', remote)
  writeProfile(a, { skills: ['alpha'] })
  writeSkill(a, 'alpha', { 'SKILL.md': SKILL_MD })
  const refs = remoteRefs(remote)
  assert.equal(await a.sync('publish'), EXIT.error)
  assert.match(a.out.join('\n') + a.err.join('\n'), /"skills" is a symlink/)
  assert.deepEqual(treeOf(outside), [])
  assert.equal(remoteRefs(remote), refs)
})

test('a symlinked skills/<name> in the remote is refused on pull', { skip: NO_SYMLINK_FIXTURE }, async () => {
  const { remote, b } = await seeded()
  const outside = tmp('ctk-outside-')
  tamper(remote, w => {
    rmSync(join(w, 'skills', 'alpha'), { recursive: true })
    symlinkSync(outside, join(w, 'skills', 'alpha'))
  })
  await b.sync('init', '--remote', remote)
  assert.equal(await b.sync('pull'), EXIT.error)
  assert.match(b.out.join('\n') + b.err.join('\n'), /is a symlink/)
  assert.equal(existsSync(b.ctx.paths.profile), false)
})

test('git calls ignore GIT_DIR and friends from the environment', async () => {
  const other = tmp('ctk-other-')
  git(other, 'init', '-q')
  const otherHead = git(other, 'rev-parse', '--git-dir').trim()
  const remote = bareRemote()
  const env = { GIT_DIR: join(other, '.git'), GIT_WORK_TREE: other, GIT_INDEX_FILE: join(other, 'idx'), GIT_NAMESPACE: 'x', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.bare', GIT_CONFIG_VALUE_0: 'true' }
  const a = device('laptop', { env: { ...device('x').ctx.env, ...env } })
  assert.equal(await a.sync('init', '--remote', remote), 0, a.out.join('\n') + a.err.join('\n'))
  writeProfile(a, { team: { maxWorkers: 2 } })
  assert.equal(await a.sync('publish'), 0, a.out.join('\n'))
  assert.equal(git(remote, 'rev-list', '--count', 'main').trim(), '1')
  assert.equal(git(other, 'rev-parse', '--git-dir').trim(), otherHead)
  assert.equal(git(other, 'for-each-ref').trim(), '', 'the other repo has no refs')
  assert.equal(git(other, 'remote').trim(), '', 'no remote was added to it')
  assert.deepEqual(readdirSync(other).filter(f => f !== '.git'), [], 'nothing was checked out into it')
})

test('publish refuses unpushed commits that touch non-whitelisted paths and pushes nothing', async () => {
  const { remote, a } = await seeded()
  writeFileSync(join(a.repo, 'evil.sh'), 'echo hi\n')
  git(a.repo, 'add', 'evil.sh')
  git(a.repo, 'commit', '-qm', 'hand made')
  const refs = remoteRefs(remote)
  writeProfile(a, { ...readProfile(a), hud: { band: false } })
  assert.equal(await a.sync('publish'), EXIT.error)
  assert.match(a.out.join('\n'), /evil\.sh: path is outside the whitelist/)
  assert.equal(remoteRefs(remote), refs)
  assert.equal(await a.sync('publish', '--dry-run'), EXIT.error, 'dry-run reports it too')
})

test('publish refuses an unpushed commit whose intermediate version holds a secret', async () => {
  const { remote, a } = await seeded()
  const file = join(a.repo, 'skills', 'alpha', 'SKILL.md')
  writeFileSync(file, `${SKILL_MD}\nAKIA${'IOSFODNN7EXAMPLE'}\n`)
  git(a.repo, 'commit', '-qam', 'oops')
  writeFileSync(file, SKILL_MD)
  git(a.repo, 'commit', '-qam', 'fixed')
  const refs = remoteRefs(remote)
  assert.equal(await a.sync('publish'), EXIT.error)
  assert.match(a.out.join('\n'), /aws-access-key/)
  assert.equal(remoteRefs(remote), refs)
})

test('publish pushes a clean unpushed commit when the profile is otherwise current', async () => {
  const { remote, a } = await seeded()
  writeSkill(a, 'alpha', { 'SKILL.md': `${SKILL_MD}edit\n` })
  await a.sync('publish')
  // simulate a push that failed after the commit: make the remote forget it, keep the commit locally
  const w = workClone(remote)
  git(w, 'reset', '-q', '--hard', 'HEAD~1')
  git(w, 'push', '-q', '--force', 'origin', 'HEAD:refs/heads/main')
  git(a.repo, 'fetch', '-q', 'origin')
  assert.equal(await a.sync('publish'), 0, a.out.join('\n'))
  assert.match(git(remote, 'show', 'main:skills/alpha/SKILL.md'), /edit/)
})

test('terminal escape sequences in remote file names are neither accepted nor printed', { skip: NO_CONTROL_NAMES }, async () => {
  const { remote, b } = await seeded()
  await b.sync('init', '--remote', remote)
  const evil = 'x\x1b]0;pwned\x07.md'
  tamper(remote, w => writeFileSync(join(w, 'skills', 'alpha', evil), 'x'))
  assert.equal(await b.sync('pull'), EXIT.error)
  const text = b.out.join('\n') + b.err.join('\n')
  assert.match(text, /unsafe path/)
  assert.ok(!/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(text), JSON.stringify(text))
  const j = await b.json('pull')
  assert.ok(!JSON.stringify(j.doc).includes('\\u001b'), 'the JSON document is sanitized too')
})

test('control characters in a remote path echoed by git are not printed', async () => {
  const c = device('tablet')
  assert.equal(await c.sync('init', '--remote', join(c.ctx.cwd, 'no\x1b[31mpe.git')), EXIT.error)
  assert.match(c.out.join('\n'), /cannot reach/)
  assert.ok(!/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(c.out.join('\n') + c.err.join('\n')))
})

for (const [what, make] of [
  ['skills', (w: string) => writeFileSync(join(w, 'skills'), 'not a directory\n')],
  ['profiles', (w: string) => writeFileSync(join(w, 'profiles'), 'not a directory\n')],
] as const) {
  test(`a plain file where ${what}/ belongs is a clean refusal, not a raw filesystem error`, async () => {
    const { remote, a } = fixture()
    tamper(remote, w => {
      writeFileSync(join(w, 'ctk-profile.json'), `${JSON.stringify({ schemaVersion: 1, name: 'x' })}\n`)
      if (what === 'skills') {
        mkdirSync(join(w, 'profiles'))
        writeFileSync(join(w, 'profiles', 'default.json'), `${JSON.stringify({ schemaVersion: 1 })}\n`)
      }
      make(w)
    })
    await a.sync('init', '--remote', remote)
    writeProfile(a, { skills: ['alpha'] })
    writeSkill(a, 'alpha', { 'SKILL.md': SKILL_MD })
    const refs = remoteRefs(remote)
    assert.equal(await a.sync('publish'), EXIT.error)
    assert.match(a.out.join('\n') + a.err.join('\n'), new RegExp(`"${what}" is not a directory`))
    assert.equal(remoteRefs(remote), refs)
  })
}

test('a failed rollback is reported, not swallowed', async () => {
  const { a } = await seeded()
  writeProfile(a, { ...readProfile(a), hud: { band: false } })
  // a stale index lock makes `git add` fail, and then the rollback's `git reset` fails as well
  writeFileSync(join(a.repo, '.git', 'index.lock'), '')
  assert.equal(await a.sync('publish'), EXIT.error)
  assert.match(a.out.join('\n') + a.err.join('\n'), /could not be restored/)
  rmSync(join(a.repo, '.git', 'index.lock'))
})

test('init rejects remote URLs that carry credentials and stores nothing', async () => {
  const a = device('laptop')
  const tok = 'ghp_' + 'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0eF3hJ6'
  for (const remote of [
    'https://user:hunter2@example.com/org/repo.git',
    'https://oauth2:abc@example.com/org/repo.git',
    `https://${tok}@github.com/org/repo.git`,
    `https://${'Zk3Vn9Xb2LmP4wR8tY1c'}@example.com/org/repo.git`,
    `ssh://git:secretpw@example.com/org/repo.git`,
    'user:pass@example.com:org/repo.git',
    // http(s) userinfo is refused even when it looks like a plain user name or low-entropy hex
    'https://someone@example.com/org/repo.git',
    'https://abc123@example.com/org/repo.git',
    'https://9f86d081884c7d659a2feaa0@example.com/org/repo.git',
    // percent-encoding is decoded before the check
    'https://user%3Apass@example.com/org/repo.git',
    'ssh://user%3Asecretpw@example.com/org/repo.git',
    // malformed or truncated encodings are refused safely, not parsed leniently
    'ssh://%E0%A4%A@example.com/org/repo.git',
    'https://%zz@example.com/org/repo.git',
  ]) {
    a.out.length = 0
    a.err.length = 0
    assert.equal(await a.sync('init', '--remote', remote), EXIT.error, remote)
    const text = a.out.join('\n') + a.err.join('\n')
    assert.match(text, /credential helper or SSH keys/, remote)
    assert.ok(!text.includes('hunter2') && !text.includes(tok) && !text.includes('secretpw'), 'the secret is not echoed')
    assert.ok(!text.includes('abc123') && !text.includes('someone') && !text.includes('%E0%A4%A'), 'the userinfo is not echoed')
  }
  assert.equal(existsSync(a.ctx.paths.syncConfig), false)
  assert.equal(existsSync(a.repo), false)
})

test('init accepts remotes without userinfo secrets (git@host:path, ssh://git@host, plain https)', async () => {
  const a = device('laptop')
  // unreachable on purpose: the point is that the URL passes validation and fails only on connect
  for (const remote of ['git@127.0.0.1:org/repo.git', 'ssh://git@127.0.0.1:1/org/repo.git', 'https://127.0.0.1:1/org/repo.git']) {
    a.out.length = 0
    a.err.length = 0
    assert.equal(await a.sync('init', '--remote', remote), EXIT.error)
    assert.match(a.out.join('\n') + a.err.join('\n'), /cannot reach/, remote)
  }
})

test('credentials in an already stored remote are refused and never printed', async () => {
  const { remote, a } = fixture()
  await a.sync('init', '--remote', remote)
  writeFileSync(a.ctx.paths.syncConfig, `${JSON.stringify({ remote: 'https://user:hunter2@example.com/r.git', branch: 'main' })}\n`)
  assert.equal(await a.sync('pull'), EXIT.error)
  assert.equal(await a.sync('publish'), EXIT.error)
  const status = await a.json('status')
  assert.ok(!JSON.stringify(status.doc).includes('hunter2'))
  assert.ok(!a.out.join('\n').includes('hunter2'))
})

// The v0.1.2 breaking change made a stored userinfo remote unusable; init must migrate it in place
// (keeping the clone, its history and unpushed commits) or the upgrade instruction is a dead end.
test('init migrates a stored credential remote in place; everything else stays refused', async () => {
  const { remote, a } = fixture()
  assert.equal(await a.sync('init', '--remote', remote), 0)
  writeProfile(a, { team: { maxWorkers: 5 }, skills: ['alpha'] })
  writeSkill(a, 'alpha', { 'SKILL.md': SKILL_MD })
  assert.equal(await a.sync('publish'), 0, a.out.join('\n'))

  // reproduce the v0.1.1 state: config.json AND the clone's origin carry a userinfo URL
  const clean = pathToFileURL(remote).href
  const creds = clean.replace('file://', 'file://user:hunter2@')
  git(a.repo, 'remote', 'set-url', 'origin', creds)
  writeFileSync(a.ctx.paths.syncConfig, `${JSON.stringify({ remote: creds, branch: 'main' })}\n`)
  git(a.repo, 'commit', '-q', '--allow-empty', '-m', 'local unpushed')
  const headBefore = git(a.repo, 'rev-parse', 'HEAD').trim()
  const profileBefore = readProfile(a)

  // (a) every command that would operate through the remote fails closed, names the migration,
  // and never echoes the credential
  for (const argv of [['pull'], ['publish'], ['resolve', 'team.maxWorkers', 'ours']]) {
    a.out.length = 0
    a.err.length = 0
    assert.equal(await a.sync(...argv), EXIT.error, argv.join(' '))
    const text = a.out.join('\n') + a.err.join('\n')
    assert.match(text, /credentials/, argv.join(' '))
    assert.match(text, /sync init --remote/, `the message points at the migration: ${argv.join(' ')}`)
    assert.ok(!text.includes('hunter2') && !text.includes('user:hunter2'), argv.join(' '))
  }
  // status is read-only and never hands the remote to git: it stays usable and prints it redacted
  a.out.length = 0
  a.err.length = 0
  assert.equal(await a.sync('status'), 0, a.out.join('\n') + a.err.join('\n'))
  assert.match(a.out.join('\n'), /\*\*\*@/)
  assert.ok(!a.out.join('\n').includes('hunter2'))
  // the refused commands touched neither the clone nor the profile
  assert.equal(git(a.repo, 'rev-parse', 'HEAD').trim(), headBefore)
  assert.equal(git(a.repo, 'remote', 'get-url', 'origin').trim(), creds)
  assert.deepEqual(readProfile(a), profileBefore)

  // (c) a different repo (or branch) is still refused, with the stored credential redacted
  a.out.length = 0
  a.err.length = 0
  assert.equal(await a.sync('init', '--remote', pathToFileURL(bareRemote()).href), EXIT.error)
  const refused = a.out.join('\n') + a.err.join('\n')
  assert.match(refused, /refusing to switch/)
  assert.ok(!refused.includes('hunter2'), 'the refusal redacts the stored remote')
  assert.equal(await a.sync('init', '--remote', clean, '--branch', 'other'), EXIT.error)
  assert.equal(git(a.repo, 'remote', 'get-url', 'origin').trim(), creds)

  // (b) init with exactly the stored URL minus the userinfo migrates in place
  a.out.length = 0
  a.err.length = 0
  assert.equal(await a.sync('init', '--remote', clean), 0, a.out.join('\n') + a.err.join('\n'))
  assert.ok(!a.out.join('\n').includes('hunter2'), 'no credential in the migration output')
  assert.deepEqual(JSON.parse(readFileSync(a.ctx.paths.syncConfig, 'utf8')), { remote: clean, branch: 'main' })
  assert.equal(git(a.repo, 'remote', 'get-url', 'origin').trim(), clean)
  assert.equal(git(a.repo, 'rev-parse', 'HEAD').trim(), headBefore, 'history survives: nothing was re-cloned')
  assert.equal(git(a.repo, 'rev-list', '--count', 'origin/main..HEAD').trim(), '1', 'the unpushed commit survives')
  assert.deepEqual(readProfile(a), profileBefore, 'the user profile is untouched')

  // the dead end is gone: the fail-closed commands work again on the migrated remote
  assert.equal(await a.sync('status'), 0, a.out.join('\n'))
  assert.equal(await a.sync('pull'), 0, a.out.join('\n'))
})
