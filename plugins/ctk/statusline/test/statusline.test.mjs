import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { displayWidth, fmtCountdown, render, resetMs, STATUS_LINE_MARGIN, tierOf, truncateToWidth } from '../ctk-statusline.mjs'

const SCRIPT = fileURLToPath(new URL('../ctk-statusline.mjs', import.meta.url))

const FULL = {
  model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
  context_window: { used_percentage: 42.4, context_window_size: 200000 },
  rate_limits: {
    five_hour: { used_percentage: 23.5, resets_at: 1791500000 },
    seven_day: { used_percentage: 61, resets_at: 1791500000 - (2 * 3600 + 34 * 60) + 3 * 86400 + 12 * 3600 },
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

// 2h34m before the 5-hour window resets, 3d12h before the weekly one.
const NOW = 1791500000 * 1000 - (2 * 3600 + 34 * 60) * 1000
const at = (input, env = {}) => render(input, env, NOW)
const wide = { COLUMNS: '200' }

test('full subscription payload at a wide terminal', () => {
  assert.equal(at(FULL, wide), 'Opus 5.5 │ 5h 24% (2h34m) │ Wk 61% (3d12h) │ Ctx 42% │ $1.23 (12m)')
})

test('abbreviated between 80 and 119 columns', () => {
  assert.equal(at(FULL, { COLUMNS: '100' }), 'Opus 5.5 │ 5h 24% 2h34m │ Wk 61% 3d12h │ Ctx 42% │ $1.23')
  assert.equal(at(FULL, { COLUMNS: '80' }), at(FULL, { COLUMNS: '100' }))
})

test('only the essentials under 80 columns', () => {
  assert.equal(at(FULL, { COLUMNS: '79' }), '5h 24% 2h34m │ Wk 61% 3d12h │ Ctx 42%')
  assert.equal(at(FULL, { COLUMNS: '31' }), '5h 24% 2h34m │ Wk 61% 3d12h')
})

test('no usable terminal width means a safe 80 columns', () => {
  for (const COLUMNS of [undefined, '', 'abc', '0', '-5', 'NaN']) {
    assert.equal(at(FULL, { COLUMNS }), at(FULL, { COLUMNS: '80' }), String(COLUMNS))
  }
  assert.equal(at(FULL), at(FULL, { COLUMNS: '80' }))
})

test('the line fits every width from 1 to 250 columns', () => {
  for (let columns = 1; columns <= 250; columns++) {
    for (const CTK_AMBIGUOUS_WIDTH of ['1', '2']) {
      const line = at(FULL, { COLUMNS: String(columns), CTK_AMBIGUOUS_WIDTH })
      assert.ok(displayWidth(line, CTK_AMBIGUOUS_WIDTH === '2' ? 2 : 1) <= Math.max(1, columns - STATUS_LINE_MARGIN), `${columns}: ${line}`)
    }
  }
})

test('API-key payload without rate_limits shows dashes, not zeros', () => {
  const { rate_limits, ...rest } = FULL
  assert.equal(at(rest, wide), 'Opus 5.5 │ 5h – │ Wk – │ Ctx 42% │ $1.23 (12m)')
})

test('empty object and nulls', () => {
  assert.equal(at({}, wide), '– │ 5h – │ Wk – │ Ctx – │ –')
  assert.equal(at({ context_window: { used_percentage: null } }, wide), '– │ 5h – │ Wk – │ Ctx – │ –')
  assert.equal(at(null, wide), '– │ 5h – │ Wk – │ Ctx – │ –')
})

test('a window with a percentage but no reset time shows without a countdown', () => {
  assert.equal(at({ rate_limits: { five_hour: { used_percentage: 12 } } }, wide), '– │ 5h 12% │ Wk – │ Ctx – │ –')
})

test('a window whose reset time has passed is a dash, not last window’s number', () => {
  const stale = { rate_limits: { five_hour: { used_percentage: 99, resets_at: NOW / 1000 - 60 } } }
  assert.equal(at(stale, wide), '– │ 5h – │ Wk – │ Ctx – │ –')
})

test('the reset time is epoch seconds; milliseconds and ISO strings mean the same instant', () => {
  const secs = 1791500000
  const mk = resets_at => ({ rate_limits: { five_hour: { used_percentage: 10, resets_at } } })
  const want = at(mk(secs), wide)
  assert.ok(want.includes('5h 10% (2h34m)'))
  assert.equal(at(mk(secs * 1000), wide), want)
  assert.equal(at(mk(new Date(secs * 1000).toISOString()), wide), want)
})

test('garbage reset times give no countdown, never a guess', () => {
  for (const resets_at of ['soon', {}, [], null, 0, -1, true]) {
    const out = at({ rate_limits: { five_hour: { used_percentage: 10, resets_at } } }, wide)
    assert.ok(out.includes('5h 10% │'), String(resets_at))
  }
})

test('the countdown follows the clock', () => {
  assert.ok(render(FULL, wide, NOW + 3600_000).includes('5h 24% (1h34m)'))
})

test('percentages are rounded', () => {
  assert.ok(at({ context_window: { used_percentage: 42.5 } }, wide).includes('Ctx 43%'))
})

test('effort is shown after the model when present, in the wide form only', () => {
  assert.equal(at({ ...FULL, effort: { level: 'high' } }, wide), 'Opus 5.5 high │ 5h 24% (2h34m) │ Wk 61% (3d12h) │ Ctx 42% │ $1.23 (12m)')
  assert.ok(at({ ...FULL, effort: { level: 'high' } }, { COLUMNS: '100' }).startsWith('Opus 5.5 │'))
})

test('effort is omitted when absent or not a string', () => {
  assert.equal(at({ ...FULL, effort: {} }, wide), at(FULL, wide))
  assert.equal(at({ ...FULL, effort: { level: null } }, wide), at(FULL, wide))
  assert.equal(at({ ...FULL, effort: { level: 3 } }, wide), at(FULL, wide))
})

test('elapsed time formatting', () => {
  const elapsedOf = ms => at({ cost: { total_cost_usd: 1, total_duration_ms: ms } }, wide).split(' │ ').at(-1)
  assert.equal(elapsedOf(0), '$1.00 (0s)')
  assert.equal(elapsedOf(45_000), '$1.00 (45s)')
  assert.equal(elapsedOf(720_000), '$1.00 (12m)')
  assert.equal(elapsedOf(3_900_000), '$1.00 (1h05m)')
  assert.equal(elapsedOf(-1), '$1.00 (–)')
  assert.equal(elapsedOf('720000'), '$1.00')
})

test('CJK text in the model name counts two cells per character', () => {
  const input = { ...FULL, model: { display_name: '千問三號' } }
  const line = at(input, { COLUMNS: '100' })
  assert.ok(line.startsWith('千問三號 │'))
  for (const columns of [80, 100, 120, 160, 200]) {
    assert.ok(displayWidth(at(input, { COLUMNS: String(columns) })) <= columns, String(columns))
  }
  assert.equal(displayWidth('千問三號'), 8)
})

test('terminal escapes in the model name are removed, not drawn', () => {
  const line = at({ ...FULL, model: { display_name: '\x1b[31mOpus\x1b[0m\x07 5.5' } }, wide)
  assert.ok(line.startsWith('Opus 5.5 │'), line)
  assert.equal(line.includes('\x1b'), false)
})

test('a terminal that draws │ double-wide gets a narrower line', () => {
  const narrow = at(FULL, { COLUMNS: '60' })
  const dbl = at(FULL, { COLUMNS: '60', CTK_AMBIGUOUS_WIDTH: '2' })
  assert.ok(displayWidth(dbl, 2) <= 60)
  assert.ok(displayWidth(narrow, 1) <= 60)
})

test('layout helpers behave', () => {
  assert.equal(truncateToWidth('認證功能分支', 7), '認證功…')
  assert.equal(fmtCountdown(NOW + 30_000, NOW), '<1m')
  assert.equal(fmtCountdown(NOW - 1, NOW), null)
  assert.equal(resetMs('2026-10-09T13:34:00+08:00'), resetMs('2026-10-09T05:34:00Z'))
  assert.equal(tierOf(120), 0)
  assert.equal(tierOf(119), 1)
  assert.equal(tierOf(79), 2)
})

test('no git segment when the workspace is not a repository', t => {
  const dir = tempDir(t)
  assert.equal(at(withDir(dir), wide), at(FULL, wide))
})

test('no git segment without a workspace directory', () => {
  assert.equal(at(FULL, wide), 'Opus 5.5 │ 5h 24% (2h34m) │ Wk 61% (3d12h) │ Ctx 42% │ $1.23 (12m)')
})

test('branch is read from .git/HEAD', t => {
  const dir = makeRepo(t)
  assert.equal(at(withDir(dir), wide), 'Opus 5.5 │ 5h 24% (2h34m) │ Wk 61% (3d12h) │ Ctx 42% │ $1.23 (12m) │ main')
})

test('branch is read from a subdirectory of the repository', t => {
  const dir = makeRepo(t)
  const sub = join(dir, 'nested', 'deeper')
  mkdirSync(sub, { recursive: true })
  assert.ok(at(withDir(sub), wide).endsWith(' │ main'))
})

test('detached HEAD shows the short sha', t => {
  const dir = makeRepo(t)
  git(dir, 'checkout', '-q', '--detach')
  const sha = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
  assert.ok(at(withDir(dir), wide).endsWith(` │ ${sha}`))
})

test('linked worktree reads its own HEAD', t => {
  const dir = makeRepo(t)
  const wt = join(tempDir(t, 'ctk-sl-wt-'), 'wt')
  git(dir, 'worktree', 'add', '-q', '-b', 'feature-wt', wt)
  assert.ok(at(withDir(wt), wide).endsWith(' │ feature-wt'))
})

test('clean tree has no dirty marker', t => {
  const dir = makeRepo(t)
  assert.ok(at(withDir(dir), wide).endsWith(' │ main'))
})

test('untracked files do not mark the tree dirty', t => {
  const dir = makeRepo(t)
  writeFileSync(join(dir, 'untracked.txt'), 'x\n')
  assert.ok(at(withDir(dir), wide).endsWith(' │ main'))
})

test('staged change adds the dirty marker', t => {
  const dir = makeRepo(t)
  writeFileSync(join(dir, 'a.txt'), 'changed\n')
  git(dir, 'add', 'a.txt')
  assert.ok(at(withDir(dir), wide).endsWith(' │ main*'))
})

test('Claude Code indents the status line and keeps two columns free: the line is laid out for COLUMNS - 4', () => {
  assert.equal(STATUS_LINE_MARGIN, 4)
  const full = at(FULL, { COLUMNS: '120' })
  assert.ok(displayWidth(full) <= 116)
  // 96 cells of model name fit a 100-column terminal exactly; one column less cuts it
  const input = { model: { display_name: 'M'.repeat(96) } }
  assert.equal(at(input, { COLUMNS: '100' }), 'M'.repeat(96))
  assert.equal(at(input, { COLUMNS: '99' }), `${'M'.repeat(94)}…`)
})

test('a width too narrow for any figure ends with an ellipsis', () => {
  const line = at(FULL, { COLUMNS: '12' })
  assert.equal(line, '5h 24% …')
  assert.equal(displayWidth(line), 8)
})

test('COLUMNS wider than the line leaves it untouched', () => {
  assert.equal(at(FULL, { COLUMNS: '200' }), at(FULL, { COLUMNS: '400' }))
})

test('styling never splits an ANSI sequence and adds no width', () => {
  const styled = at(FULL, { CTK_COLOR: '1', COLUMNS: '100' })
  assert.ok(styled.startsWith('\x1b[1mOpus 5.5\x1b[22m │ '))
  assert.equal(styled.replace(/\x1b\[[0-9;]*m/g, ''), at(FULL, { COLUMNS: '100' }))
  const narrow = at(FULL, { CTK_COLOR: '1', COLUMNS: '12' })
  assert.equal(narrow, '5h 24% …')
})

test('plain output has no ANSI unless CTK_COLOR=1', () => {
  assert.equal(at(FULL, wide).includes('\x1b'), false)
  assert.equal(at(FULL, { ...wide, CTK_COLOR: '1' }).includes('\x1b['), true)
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
  assert.equal(at(withDir(dir), wide).endsWith(' │ main'), true)
  assert.equal(existsSync(marker), false)
})

test('hostile repo config (filter driver) skips the dirty marker', t => {
  const dir = makeRepo(t)
  const marker = join(tempDir(t, 'ctk-sl-marker-'), 'PWNED')
  git(dir, 'config', 'filter.x.clean', `touch ${marker}; cat`)
  writeFileSync(join(dir, '.gitattributes'), 'a.txt filter=x\n')
  writeFileSync(join(dir, 'a.txt'), 'changed\n')
  assert.ok(at(withDir(dir), wide).endsWith(' │ main'))
  assert.equal(existsSync(marker), false)
})

test('hostile common config reached from a linked worktree skips the dirty marker', t => {
  const dir = makeRepo(t)
  const wt = join(tempDir(t, 'ctk-sl-wt-'), 'wt')
  git(dir, 'worktree', 'add', '-q', '-b', 'feature-wt', wt)
  git(dir, 'config', 'core.fsmonitor', 'false')
  writeFileSync(join(wt, 'a.txt'), 'changed\n')
  assert.ok(at(withDir(wt), wide).endsWith(' │ feature-wt'))
})

test('oversized repo config skips the dirty marker', t => {
  const dir = makeRepo(t)
  appendFileSync(join(dir, '.git', 'config'), `# ${'x'.repeat(65 * 1024)}\n`)
  writeFileSync(join(dir, 'a.txt'), 'changed\n')
  assert.ok(at(withDir(dir), wide).endsWith(' │ main'))
})

test('control characters from HEAD and input are stripped', t => {
  const dir = makeRepo(t)
  writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/ma\x1b[31min\x07\n')
  const line = at({ ...withDir(dir), model: { display_name: 'Op\x1b[2Jus' } }, wide)
  assert.ok(line.startsWith('Opus │ '), line)
  assert.match(line, / │ main\*?$/)
  assert.equal(/[\x00-\x1f\x7f-\x9f]/.test(line), false)
})

test('missing model prints a dash', () => {
  assert.equal(at({ model: {} }, wide).split(' │ ')[0], '–')
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
    env: { ...process.env, COLUMNS: '200', GIT_DIR: join(other, '.git'), GIT_EXTERNAL_DIFF: `touch ${marker}` },
  })
  assert.equal(r.status, 0)
  assert.ok(r.stdout.startsWith('Opus 5.5 │ '), r.stdout)
  assert.ok(r.stdout.endsWith(' │ main\n'), r.stdout)
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
    env: { ...cfgEnv, COLUMNS: '200' },
  })
  assert.ok(r.stdout.endsWith(' │ feature-wt\n'), r.stdout)
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
