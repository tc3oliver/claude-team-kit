import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  assert.equal(render({}), '? · ctx – · 5h – · 7d – · – · –')
  assert.equal(render({ context_window: { used_percentage: null } }), '? · ctx – · 5h – · 7d – · – · –')
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

test('process latency well under the 300 ms debounce', t => {
  const dir = makeRepo(t)
  const stdin = JSON.stringify(withDir(dir))
  const t0 = performance.now()
  for (let i = 0; i < 5; i++) spawnSync(process.execPath, [SCRIPT], { input: stdin })
  const avg = (performance.now() - t0) / 5
  console.log(`avg ${avg.toFixed(1)} ms`)
  assert.ok(avg < 300, `avg ${avg} ms`)
})
