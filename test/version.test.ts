import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

// One version in every place a user or Claude Code reads it, so a release cannot ship half-bumped.
// It matters more than usual for the plugin: a manifest that pins `version` keeps installed copies
// on that version until the string changes (observed with `claude plugin update`, docs/REVIEW.md),
// so a fix that reaches users needs a new version here first.

const ROOT = join(import.meta.dirname, '..')
const text = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
const json = (rel: string) => JSON.parse(text(rel)) as Record<string, any>

test('package, lockfile and plugin manifest carry the same version', () => {
  const v = json('package.json').version
  assert.match(v, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/)
  assert.equal(json('plugins/ctk/.claude-plugin/plugin.json').version, v)
  const lock = json('package-lock.json')
  assert.equal(lock.version, v)
  assert.equal(lock.packages[''].version, v)
})

test('the marketplace entry does not pin a second version that could disagree with the manifest', () => {
  const entry = json('.claude-plugin/marketplace.json').plugins[0]
  assert.equal(entry.version, undefined)
})

test('the changelog and the release notes are for the current version', () => {
  const v = json('package.json').version
  assert.match(text('CHANGELOG.md'), new RegExp(`^## \\[${v.replace(/\./g, '\\.')}\\]`, 'm'))
  assert.match(text('RELEASE_NOTES.md'), new RegExp(`^# Claude Team Kit ${v.replace(/\./g, '\\.')}`, 'm'))
})

test('a release tag must equal the version, and a 0.x tag is a prerelease', () => {
  const wf = text('.github/workflows/release.yml')
  assert.match(wf, /GITHUB_REF_NAME/)
  assert.match(wf, /prerelease:/)
})
