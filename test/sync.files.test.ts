import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { collectSkill, isPlainPath, isSafeRelPath, MAX_SKILL_FILES } from '../src/sync/files.ts'
import { registerCleanup, tmp } from './sync.helpers.ts'

registerCleanup()

// chmod-based fault injection does not work as root or on Windows (POSIX modes are not enforced).
const NO_CHMOD_FIXTURE = process.getuid?.() === 0 ? 'root bypasses file permissions' : process.platform === 'win32' ? 'Windows does not enforce POSIX permission bits' : false

test('whitelist: unsafe relative paths are rejected', () => {
  for (const bad of ['', '/etc/passwd', '../x', 'a/../b', 'a/./b', 'a//b', 'C:/x', 'c:\\x', 'a\\b', '.git/config', 'a/.GIT/x', 'a\0b', 'a:b.md', 'a/\x1b]0;x\x07.md', 'a\x85b.md', 'a\nb.md']) {
    assert.equal(isSafeRelPath(bad), false, JSON.stringify(bad))
  }
  for (const ok of ['SKILL.md', 'references/a.md', '.hidden/x.md', 'a/b/c.json']) assert.equal(isSafeRelPath(ok), true, ok)
})

test('whitelist: a clean skill is collected with hashes; the managed marker is ignored on request', () => {
  const dir = join(tmp(), 'skill')
  mkdirSync(join(dir, 'references'), { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), '# hi\n')
  writeFileSync(join(dir, 'references', 'a.json'), '{}')
  writeFileSync(join(dir, '.ctk-managed'), 'x')
  const r = collectSkill(dir, { ignoreMarker: true })
  assert.deepEqual([...r.files.keys()].sort(), ['SKILL.md', 'references/a.json'])
  assert.deepEqual(r.problems, [])
  assert.equal(Object.keys(r.hashes).length, 2)
  assert.ok(collectSkill(dir).problems.some(p => p.includes('.ctk-managed')))
})

test('whitelist: a missing directory is an empty skill', () => {
  const r = collectSkill(join(tmp(), 'nope'))
  assert.equal(r.files.size, 0)
  assert.deepEqual(r.problems, [])
})

test('whitelist: disallowed extension, oversize, binary, too many files, symlinks', () => {
  const root = tmp()
  const mk = (name: string, fn: (dir: string) => void) => {
    const dir = join(root, name)
    mkdirSync(dir, { recursive: true })
    fn(dir)
    return collectSkill(dir)
  }
  assert.match(mk('ext', d => writeFileSync(join(d, 'run.exe'), 'x')).problems.join(), /extension not allowed/)
  assert.match(mk('noext', d => writeFileSync(join(d, 'Makefile'), 'x')).problems.join(), /extension not allowed/)
  assert.match(mk('big', d => writeFileSync(join(d, 'a.md'), 'x'.repeat(256 * 1024 + 1))).problems.join(), /larger than/)
  assert.deepEqual(mk('edge', d => writeFileSync(join(d, 'a.md'), 'x'.repeat(256 * 1024))).problems, [])
  assert.match(mk('bin', d => writeFileSync(join(d, 'a.md'), 'a\0b')).problems.join(), /not a text file/)
  assert.match(
    mk('many', d => {
      for (let i = 0; i <= MAX_SKILL_FILES; i++) writeFileSync(join(d, `f${i}.md`), 'x')
    }).problems.join(),
    /more than 100 files/,
  )
  assert.deepEqual(
    mk('hundred', d => {
      for (let i = 0; i < MAX_SKILL_FILES; i++) writeFileSync(join(d, `f${i}.md`), 'x')
    }).problems,
    [],
  )
  const target = join(root, 'target.md')
  writeFileSync(target, 'secret')
  assert.match(mk('link', d => symlinkSync(target, join(d, 'a.md'))).problems.join(), /symlinks are not allowed/)
  const linkedDir = join(root, 'linkdir')
  symlinkSync(join(root, 'ext'), linkedDir)
  assert.match(collectSkill(linkedDir).problems.join(), /not a plain directory/)
})

// EACCES exercises the same throw paths as a directory/file removed mid-walk: readdirSync and
// readFileSync failures become problems, never a raw throw out of collectSkill.
test('whitelist: filesystem faults become problems, not raw throws', { skip: NO_CHMOD_FIXTURE }, () => {
  const root = tmp()
  const dir = join(root, 'skill')
  mkdirSync(join(dir, 'sub'), { recursive: true })
  writeFileSync(join(dir, 'a.md'), 'ok\n')
  writeFileSync(join(dir, 'sub', 'b.md'), 'b\n')
  writeFileSync(join(dir, 'c.md'), 'c\n')

  chmodSync(join(dir, 'c.md'), 0o000) // readFileSync throws EACCES
  let r = collectSkill(dir)
  assert.ok(r.problems.some(p => p.includes('c.md') && /unreadable/.test(p)), JSON.stringify(r.problems))
  assert.ok(r.files.has('a.md'), 'the readable files are still collected')

  chmodSync(join(dir, 'c.md'), 0o644)
  chmodSync(join(dir, 'sub'), 0o000) // readdirSync throws EACCES
  r = collectSkill(dir)
  assert.ok(r.problems.some(p => p.includes('sub') && /unreadable/.test(p)), JSON.stringify(r.problems))
  assert.equal(r.files.has('sub/b.md'), false)
  assert.ok(r.files.has('a.md'), 'a partial failure keeps the rest, but the skill stays unusable (problems non-empty)')
  chmodSync(join(dir, 'sub'), 0o755)
  assert.deepEqual(collectSkill(dir).problems, [])
})

test('whitelist: isPlainPath rejects symlinked components and missing files', () => {
  const root = tmp()
  mkdirSync(join(root, 'real'))
  writeFileSync(join(root, 'real', 'f.json'), '{}')
  symlinkSync(join(root, 'real'), join(root, 'link'))
  assert.equal(isPlainPath(root, 'real/f.json'), true)
  assert.equal(isPlainPath(root, 'link/f.json'), false)
  assert.equal(isPlainPath(root, 'real/missing.json'), false)
})
