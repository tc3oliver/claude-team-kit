import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { MODS_MIN_VERSION } from '../src/core/claude.ts'

// The agent install path (INSTALL.md and the README prompt) must stay native-first, stay consistent with
// docs/INSTALLATION.md, and never tell an agent to run remote code.

const ROOT = join(import.meta.dirname, '..')
const text = (f: string) => readFileSync(join(ROOT, f), 'utf8')
const readme = text('README.md')
const guide = text('INSTALL.md')
const reference = text('docs/INSTALLATION.md')

/** Fenced code blocks of a markdown file. */
const fences = (md: string): string[] => [...md.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].map(m => m[1] as string)

test('the README offers both installs, the agent prompt first and the manual one complete', () => {
  const install = readme.slice(readme.indexOf('\n## Install\n'), readme.indexOf('\n## Your first team'))
  assert.ok(install.includes('### Manual install'), 'manual install keeps its own heading')
  assert.ok(install.includes('### Install with your AI Agent'))
  assert.ok(install.indexOf('### Install with your AI Agent') < install.indexOf('### Manual install'), 'the prompt comes first, the native commands stay in the install section')
  for (const cmd of ['/plugin marketplace add tc3oliver/claude-team-kit', '/plugin install ctk@ctk-kit', '/reload-plugins', '/ctk-doctor', 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS']) {
    assert.ok(install.slice(install.indexOf('### Manual install')).includes(cmd), `manual install shows ${cmd}`)
  }
})

test('the README prompt is one copyable block that points at INSTALL.md and states the safety rules', () => {
  const block = fences(readme).find(b => b.startsWith('Install Claude Team Kit'))
  assert.ok(block, 'a text block starting with the instruction')
  assert.ok(block.length < 1400, `the prompt stays short (${block.length} characters)`)
  assert.match(block, /https:\/\/raw\.githubusercontent\.com\/tc3oliver\/claude-team-kit\/main\/INSTALL\.md/)
  for (const must of [/native Plugin Manager/, /claude plugin/, /no `curl \| bash`/, /no `npm install`/, /claude --version/, /wait for my yes/, /merge only/, /Do not uninstall or disable anything else, including OMC/, /\/reload-plugins/, /\/ctk-doctor/]) {
    assert.match(block, must)
  }
  assert.ok(existsSync(join(ROOT, 'INSTALL.md')))
})

test('INSTALL.md only runs the native Plugin Manager and never remote code', () => {
  const code = fences(guide).join('\n')
  assert.doesNotMatch(code, /\b(curl|wget|npx|iex|Invoke-WebRequest)\b|npm (i|install|ci)\b|\|\s*(ba|z)?sh\b|\bsudo\b/)
  assert.doesNotMatch(code, /uninstall|marketplace remove|plugin disable/, 'the checklist never removes or disables anything')
  for (const rule of [/native Plugin Manager/, /no `curl \| bash`/i, /Merge, never overwrite/, /Do not uninstall or disable any other plugin, including Oh My Claude Code \(OMC\)/, /Do not read credentials/, /cannot run slash commands/]) {
    assert.match(guide, rule)
  }
})

test('every plugin command in INSTALL.md is one docs/INSTALLATION.md shows too', () => {
  const lines = fences(guide).flatMap(b => b.split('\n')).map(l => l.trim()).filter(l => /^(claude plugin|\/plugin|\/reload-plugins)/.test(l))
  assert.ok(lines.length >= 6, 'the extractor found the install commands')
  const norm = (l: string) => l.replace(/#v?\d+\.\d+\.\d+/, '#<tag>')
  for (const l of lines) assert.ok(reference.includes(norm(l)) || reference.includes(l.replace(/#v?\d+\.\d+\.\d+/, '')) || reference.includes(`#<tag>`) && /marketplace add/.test(l), `docs/INSTALLATION.md shows: ${l}`)
})

test('INSTALL.md agrees with the reference on the version, the flags and the guard words', () => {
  assert.ok(guide.includes(MODS_MIN_VERSION), 'the minimum Claude Code version is the one the code checks')
  assert.ok(reference.includes(MODS_MIN_VERSION))
  for (const flag of ['CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS', 'CLAUDE_CODE_ENABLE_TODO_TOOLS']) {
    assert.ok(guide.includes(flag) && reference.includes(flag), flag)
  }
  assert.match(guide, /\| `ready` \(`available`\)/)
  assert.match(guide, /\| `ON` \(`active`\)/)
  assert.match(guide, /\| `ERR` \|/)
  assert.match(guide, /`ready` after an install is correct/)
  assert.ok(guide.includes('restart Claude Code') && guide.includes('/reload-plugins'), 'reload and restart are both named')
})

test('the install docs point at the current release, never an older tag', () => {
  const v = (JSON.parse(text('package.json')) as { version: string }).version
  for (const doc of ['INSTALL.md', 'docs/INSTALLATION.md']) {
    const body = text(doc)
    // any literal release tag pinned in a `marketplace add …#vX.Y.Z` example must be the current one
    for (const m of body.matchAll(/claude-team-kit#v(\d+\.\d+\.\d+)/g)) {
      assert.equal(m[1], v, `${doc} pins an old release tag #v${m[1]}; use #v${v} or <release-tag>`)
    }
    assert.ok(body.includes(`v${v}`), `${doc} names the current release v${v}`)
  }
  // the agent checklist must never tell an agent an older version is "already installed, skip the install"
  assert.doesNotMatch(guide, /listed at \*\*0\.1\.[012]\*\*/)
  // and must show the update path, not a reinstall, for an already-installed older version
  assert.match(guide, /plugin update ctk@ctk-kit/)
})

test('INSTALL.md marks the platforms that were not tried', () => {
  for (const row of [/\| macOS \| Verified/, /\| Linux, Windows \| \*\*Tested in CI only\*\*/, /Windows Terminal, VS Code terminal \| \*\*Not verified\*\*/, /\| WSL \| \*\*Not verified\*\*/]) assert.match(guide, row)
})

test('the agent install path adds no runtime dependency and no always-on context', () => {
  const pkg = JSON.parse(text('package.json')) as { files: string[]; dependencies?: Record<string, string> }
  assert.ok(pkg.files.includes('INSTALL.md'), 'ships in the npm package')
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), ['zod'], 'the agent install path adds no runtime dependency')
  assert.equal(existsSync(join(ROOT, 'plugins', 'ctk', 'INSTALL.md')), false, 'nothing in the plugin directory, so nothing in a session')
})
