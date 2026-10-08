import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render } from '../ctk-statusline.mjs'

const SCRIPT = fileURLToPath(new URL('../ctk-statusline.mjs', import.meta.url))

const FULL = {
  model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
  context_window: { used_percentage: 42.4, context_window_size: 200000 },
  rate_limits: {
    five_hour: { used_percentage: 23.5, resets_at: 1791500000 },
    seven_day: { used_percentage: 61 },
  },
  cost: { total_cost_usd: 1.234, total_duration_ms: 720000 },
}

const git = (cwd, ...args) =>
  execFileSync(
    'git',
    ['-c', 'user.name=ctk-test', '-c', 'user.email=ctk-test@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd, stdio: 'ignore' },
  )

const tempDir = (t, prefix = 'ctk-sl-') => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

const makeRepo = t => {
  const dir = tempDir(t)
  git(dir, 'init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'a.txt'), 'a\n')
  git(dir, 'add', 'a.txt')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}

const withDir = dir => ({ ...FULL, workspace: { current_dir: dir } })

test('full subscription payload', () => {
  assert.equal(render(FULL), 'Opus 5.5 · ctx 42% · 5h 24% · 7d 61% · $1.23 · 12m')
})

test('API-key payload without rate_limits', () => {
  const { rate_limits, ...rest } = FULL
  assert.equal(render(rest), 'Opus 5.5 · ctx 42% · 5h – · 7d – · $1.23 · 12m')
})

test('empty object and nulls', () => {
  assert.equal(render({}), '– · ctx – · 5h – · 7d – · – · –')
  assert.equal(render({ context_window: { used_percentage: null } }), '– · ctx – · 5h – · 7d – · – · –')
})

test('effort is shown after the model when present', () => {
  assert.equal(render({ ...FULL, effort: { level: 'high' } }), 'Opus 5.5 high · ctx 42% · 5h 24% · 7d 61% · $1.23 · 12m')
})

test('effort is omitted when absent or not a string', () => {
  assert.equal(render({ ...FULL, effort: {} }), render(FULL))
  assert.equal(render({ ...FULL, effort: { level: null } }), render(FULL))
  assert.equal(render({ ...FULL, effort: { level: 3 } }), render(FULL))
})

test('elapsed time formatting', () => {
  const elapsedOf = ms => render({ cost: { total_duration_ms: ms } }).split(' · ').at(-1)
  assert.equal(elapsedOf(0), '0s')
  assert.equal(elapsedOf(45_000), '45s')
  assert.equal(elapsedOf(720_000), '12m')
  assert.equal(elapsedOf(3_900_000), '1h05m')
  assert.equal(elapsedOf(-1), '–')
  assert.equal(elapsedOf('720000'), '–')
})

test('no git segment when the workspace is not a repository', t => {
  const dir = tempDir(t)
  assert.equal(render(withDir(dir)), render(FULL))
})

test('no git segment without a workspace directory', () => {
  assert.equal(render(FULL), 'Opus 5.5 · ctx 42% · 5h 24% · 7d 61% · $1.23 · 12m')
})

test('branch is read from .git/HEAD', t => {
  const dir = makeRepo(t)
  assert.equal(render(withDir(dir)), 'Opus 5.5 · ctx 42% · 5h 24% · 7d 61% · $1.23 · 12m · main')
})

test('branch is read from a subdirectory of the repository', t => {
  const dir = makeRepo(t)
  const sub = join(dir, 'nested', 'deeper')
  mkdirSync(sub, { recursive: true })
  assert.ok(render(withDir(sub)).endsWith(' · main'))
})

test('detached HEAD shows the short sha', t => {
  const dir = makeRepo(t)
  git(dir, 'checkout', '-q', '--detach')
  const sha = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
  assert.ok(render(withDir(dir)).endsWith(` · ${sha}`))
})

test('linked worktree reads its own HEAD', t => {
  const dir = makeRepo(t)
  const wt = join(tempDir(t, 'ctk-sl-wt-'), 'wt')
  git(dir, 'worktree', 'add', '-q', '-b', 'feature-wt', wt)
  assert.ok(render(withDir(wt)).endsWith(' · feature-wt'))
})

test('clean tree has no dirty marker', t => {
  const dir = makeRepo(t)
  assert.ok(render(withDir(dir)).endsWith(' · main'))
})

test('untracked files do not mark the tree dirty', t => {
  const dir = makeRepo(t)
  writeFileSync(join(dir, 'untracked.txt'), 'x\n')
  assert.ok(render(withDir(dir)).endsWith(' · main'))
})

test('staged change adds the dirty marker', t => {
  const dir = makeRepo(t)
  writeFileSync(join(dir, 'a.txt'), 'changed\n')
  git(dir, 'add', 'a.txt')
  assert.ok(render(withDir(dir)).endsWith(' · main*'))
})

test('COLUMNS truncates from the end with an ellipsis', t => {
  const dir = makeRepo(t)
  const line = render(withDir(dir), { COLUMNS: '20' })
  assert.equal(line, 'Opus 5.5 · ctx 42% …')
  assert.equal([...line].length, 20)
})

test('COLUMNS wider than the line leaves it untouched', () => {
  assert.equal(render(FULL, { COLUMNS: '200' }), render(FULL))
})

test('truncation never splits an ANSI sequence', () => {
  const styled = render(FULL, { CTK_COLOR: '1', COLUMNS: '8' })
  assert.equal(styled, '\x1b[1mOpus 5.\x1b[22m…')
})

test('plain output has no ANSI unless CTK_COLOR=1', () => {
  assert.equal(render(FULL).includes('\x1b'), false)
  assert.equal(render(FULL, { CTK_COLOR: '1' }).includes('\x1b['), true)
})

for (const [label, stdin] of [['valid JSON', JSON.stringify(FULL)], ['garbage', 'not json{'], ['empty', '']]) {
  test(`process: ${label} exits 0 with one line`, () => {
    const r = spawnSync(process.execPath, [SCRIPT], { input: stdin, encoding: 'utf8' })
    assert.equal(r.status, 0)
    assert.equal(r.stdout.split('\n').filter(Boolean).length, 1)
  })
}

test('hostile repo config (fsmonitor) never runs and the branch still shows', t => {
  const dir = makeRepo(t)
  const marker = join(tempDir(t, 'ctk-sl-marker-'), 'PWNED')
  git(dir, 'config', 'core.fsmonitor', `touch ${marker}; false`)
  writeFileSync(join(dir, 'a.txt'), 'changed\n')
  assert.equal(render(withDir(dir)).endsWith(' · main'), true)
  assert.equal(existsSync(marker), false)
})

test('hostile repo config (filter driver) skips the dirty marker', t => {
  const dir = makeRepo(t)
  const marker = join(tempDir(t, 'ctk-sl-marker-'), 'PWNED')
  git(dir, 'config', 'filter.x.clean', `touch ${marker}; cat`)
  writeFileSync(join(dir, '.gitattributes'), 'a.txt filter=x\n')
  writeFileSync(join(dir, 'a.txt'), 'changed\n')
  assert.ok(render(withDir(dir)).endsWith(' · main'))
  assert.equal(existsSync(marker), false)
})

test('hostile common config reached from a linked worktree skips the dirty marker', t => {
  const dir = makeRepo(t)
  const wt = join(tempDir(t, 'ctk-sl-wt-'), 'wt')
  git(dir, 'worktree', 'add', '-q', '-b', 'feature-wt', wt)
  git(dir, 'config', 'core.fsmonitor', 'false')
  writeFileSync(join(wt, 'a.txt'), 'changed\n')
  assert.ok(render(withDir(wt)).endsWith(' · feature-wt'))
})

test('oversized repo config skips the dirty marker', t => {
  const dir = makeRepo(t)
  appendFileSync(join(dir, '.git', 'config'), `# ${'x'.repeat(65 * 1024)}\n`)
  writeFileSync(join(dir, 'a.txt'), 'changed\n')
  assert.ok(render(withDir(dir)).endsWith(' · main'))
})

test('control characters from HEAD and input are stripped', t => {
  const dir = makeRepo(t)
  writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/ma\x1b[31min\x07\n')
  const line = render({ ...withDir(dir), model: { display_name: 'Op\x1b[2Jus' } })
  assert.ok(line.startsWith('Op[2Jus · '))
  assert.match(line, / · ma\[31min\*?$/)
  assert.equal(/[\x00-\x1f\x7f-\x9f]/.test(line), false)
})

test('missing model prints a dash', () => {
  assert.equal(render({ model: {} }).split(' · ')[0], '–')
})

test('inherited GIT_DIR cannot redirect the dirty check', t => {
  const current = makeRepo(t)
  const other = makeRepo(t)
  git(other, 'checkout', '-q', '-b', 'other')
  writeFileSync(join(other, 'a.txt'), 'changed\n')
  git(other, 'add', 'a.txt')
  const marker = join(tempDir(t, 'ctk-sl-marker-'), 'PWNED')
  const r = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify(withDir(current)),
    encoding: 'utf8',
    env: { ...process.env, GIT_DIR: join(other, '.git'), GIT_EXTERNAL_DIFF: `touch ${marker}` },
  })
  assert.equal(r.status, 0)
  assert.equal(r.stdout, 'Opus 5.5 · ctx 42% · 5h 24% · 7d 61% · $1.23 · 12m · main\n')
  assert.equal(existsSync(marker), false)
})

test('system autocrlf (Git for Windows default) does not make a clean worktree look dirty', t => {
  // A global config would override the system one, so both layers are pinned to scratch files.
  const cfgDir = tempDir(t, 'ctk-sl-sys-')
  const sys = join(cfgDir, 'system.gitconfig')
  const global = join(cfgDir, 'global.gitconfig')
  writeFileSync(sys, '[core]\n\tautocrlf = true\n')
  writeFileSync(global, '')
  const cfgEnv = { ...process.env, GIT_CONFIG_SYSTEM: sys, GIT_CONFIG_GLOBAL: global }
  const sysGit = (cwd, ...args) =>
    execFileSync('git', ['-c', 'user.name=ctk-test', '-c', 'user.email=ctk-test@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
      cwd,
      stdio: 'ignore',
      env: cfgEnv,
    })
  const dir = tempDir(t)
  sysGit(dir, 'init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'a.txt'), 'a\n')
  sysGit(dir, 'add', 'a.txt')
  sysGit(dir, 'commit', '-q', '-m', 'init')
  const wt = join(tempDir(t, 'ctk-sl-wt-'), 'wt')
  sysGit(dir, 'worktree', 'add', '-q', '-b', 'feature-wt', wt)
  assert.ok(readFileSync(join(wt, 'a.txt'), 'utf8').includes('\r'), 'autocrlf must have converted the checkout')
  const r = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify(withDir(wt)),
    encoding: 'utf8',
    env: cfgEnv,
  })
  assert.equal(r.stdout, 'Opus 5.5 · ctx 42% · 5h 24% · 7d 61% · $1.23 · 12m · feature-wt\n')
})

test('process latency well under the 300 ms debounce', t => {
  const dir = makeRepo(t)
  const stdin = JSON.stringify(withDir(dir))
  const t0 = performance.now()
  for (let i = 0; i < 5; i++) spawnSync(process.execPath, [SCRIPT], { input: stdin })
  const avg = (performance.now() - t0) / 5
  console.log(`avg ${avg.toFixed(1)} ms`)
  assert.ok(avg < 300, `avg ${avg} ms`)
})
