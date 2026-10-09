import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { EXIT } from '../src/cli/context.ts'
import { git, redactUrls } from '../src/sync/git.ts'
import { device, gitEnv, git as plainGit, registerCleanup, tmp } from './sync.helpers.ts'

registerCleanup()

test('redactUrls hides userinfo in any scheme, encoding or shape, and leaves clean text alone', () => {
  assert.equal(redactUrls('https://user:hunter2@example.com/org/repo.git'), 'https://***@example.com/org/repo.git')
  assert.equal(redactUrls('https://ghp_aB3dE6gH9jK2mN5pQ8sT@github.com/o/r'), 'https://***@github.com/o/r')
  assert.equal(redactUrls('https://abc123@example.com/r'), 'https://***@example.com/r')
  assert.equal(redactUrls('https://user%3Apass@example.com/r'), 'https://***@example.com/r')
  assert.equal(redactUrls('ssh://git:pw@host:22/r'), 'ssh://***@host:22/r')
  assert.equal(redactUrls('git://:@host/r'), 'git://***@host/r')
  assert.equal(redactUrls('clone https://u:p@host/r and http://t@host/q'), 'clone https://***@host/r and http://***@host/q')
  // no userinfo: untouched
  assert.equal(redactUrls('https://example.com/org/repo.git'), 'https://example.com/org/repo.git')
  assert.equal(redactUrls('user@example.com'), 'user@example.com')
  assert.equal(redactUrls('a@b without a scheme'), 'a@b without a scheme')
  assert.equal(redactUrls(''), '')
  // an email in prose is not a URL userinfo and must survive
  assert.equal(redactUrls('contact someone@example.com for help'), 'contact someone@example.com for help')
})

// Print the environment git hands to a child process, using a git alias that runs node.
const childEnv = async (name: string, env: NodeJS.ProcessEnv = gitEnv()) => {
  const alias = `alias.ctkenv=!"${process.execPath}" -p "process.env.${name} ?? '<unset>'"`
  const cwd = tmp()
  plainGit(cwd, 'init', '-q') // shell aliases only run inside a repository
  const r = await git(cwd, ['-c', alias, 'ctkenv'], env)
  assert.equal(r.code, 0, r.stderr)
  return r.stdout.trim()
}

test('git helper pins the transport allow-list: plain transports only, never ext or fd', { skip: process.platform === 'win32' ? 'POSIX shell tools (sh, touch) are required' : false }, async () => {
  assert.equal(await childEnv('GIT_ALLOW_PROTOCOL'), 'file:git:http:https:ssh')
  const env = gitEnv()
  delete env.GIT_ALLOW_PROTOCOL
  assert.equal(await childEnv('GIT_ALLOW_PROTOCOL', env), 'file:git:http:https:ssh')
})

test('git helper never prompts and treats pathspecs literally', async () => {
  assert.equal(await childEnv('GIT_TERMINAL_PROMPT'), '0')
  assert.equal(await childEnv('GIT_LITERAL_PATHSPECS'), '1')
})

test('git itself refuses to run an ext:: transport started through the helper', { skip: process.platform === 'win32' ? 'POSIX shell tools (sh, touch) are required' : false }, async () => {
  const marker = join(tmp(), 'ext-ran')
  const dest = join(tmp(), 'clone')
  // git's ext syntax: arguments split on spaces, `% ` is a literal space inside one argument
  for (const url of [`ext::sh -c touch% ${marker}`, `ext::sh -c touch% ${marker} %S`]) {
    const r = await git(tmp(), ['clone', url, dest], gitEnv())
    assert.notEqual(r.code, 0)
    assert.equal(existsSync(marker), false, 'the ext:: command must never run')
    assert.match(r.stderr, /transport 'ext' not allowed/)
  }
})

test('sync init refuses an ext:: remote and runs nothing', { skip: process.platform === 'win32' ? 'POSIX shell tools (sh, touch) are required' : false }, async () => {
  const marker = join(tmp(), 'ext-ran')
  const a = device('laptop')
  assert.equal(await a.sync('init', '--remote', `ext::sh -c touch% ${marker}`), EXIT.error)
  assert.equal(existsSync(marker), false)
  assert.equal(existsSync(a.ctx.paths.syncConfig), false)
  assert.equal(existsSync(a.repo), false)
})
