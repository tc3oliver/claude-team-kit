import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

const ROOT = join(import.meta.dirname, '..')
const read = (rel: string) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as Record<string, any>

/** Files under plugins/ctk that are in the repo but deliberately kept out of the npm package. */
const EXCLUDED = [/^plugins\/ctk\/tests\//, /^plugins\/ctk\/statusline\/test\//, /^plugins\/ctk\/tsconfig\.json$/]

/** npm's own CLI script, found without a shell so this also runs on Windows; null when it cannot be located. */
const npmCli = (): string | null => {
  const node = dirname(process.execPath)
  const candidates = [
    process.env.npm_execpath ?? '',
    join(node, 'node_modules', 'npm', 'bin', 'npm-cli.js'), // Windows layout
    join(node, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), // POSIX layout
  ]
  return candidates.find(c => /\.[cm]?js$/.test(c) && existsSync(c)) ?? null
}

const packFiles = (cli: string): string[] => {
  const out = execFileSync(process.execPath, [cli, 'pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  return (JSON.parse(out) as { files: { path: string }[] }[])[0]?.files.map(f => f.path) ?? []
}

/** Tracked files plus new files git does not ignore: what a commit of this tree would contain. */
const repoFiles = (): string[] | null => {
  try {
    return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'plugins/ctk'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')
      .filter(Boolean)
  } catch {
    return null
  }
}

test('every marketplace entry points at a plugin directory whose plugin.json is valid', () => {
  const market = read('.claude-plugin/marketplace.json')
  assert.equal(market.name, 'ctk-kit')
  assert.ok(Array.isArray(market.plugins) && market.plugins.length > 0)
  for (const entry of market.plugins as { name: string; source: string }[]) {
    assert.match(entry.source, /^\.\/[\w./-]+$/, 'a relative path inside the repo')
    const dir = join(ROOT, entry.source)
    assert.ok(existsSync(dir), `${entry.source} exists`)
    const manifest = JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8')) as Record<string, any>
    assert.equal(manifest.name, entry.name)
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
    assert.ok(typeof manifest.description === 'string' && manifest.description.length > 0)
    for (const [key, spec] of Object.entries(manifest.userConfig as Record<string, any>)) {
      assert.ok(spec.type && spec.title && spec.description && 'default' in spec, `userConfig.${key} is fully described`)
    }
  }
})

test('the plugin version equals the package version', () => {
  assert.equal(read('plugins/ctk/.claude-plugin/plugin.json').version, read('package.json').version)
})

test('npm pack ships the marketplace and exactly the plugin files that are in the repo, minus the excluded set', t => {
  const cli = npmCli()
  if (cli === null) return t.skip('npm-cli.js could not be located next to this node; npm pack is not available to this test')
  const repo = repoFiles()
  if (repo === null) return t.skip('git is not available or this is not a git checkout')
  const packed = packFiles(cli)
  assert.ok(packed.includes('.claude-plugin/marketplace.json'), 'the marketplace ships')
  assert.ok(packed.includes('plugins/ctk/.claude-plugin/plugin.json'), 'the plugin manifest ships')
  const inPack = packed.filter(p => p.startsWith('plugins/ctk/')).sort()
  const expected = repo.filter(p => !EXCLUDED.some(re => re.test(p))).sort()
  assert.deepEqual(inPack.filter(p => !expected.includes(p)), [], 'nothing outside the repo (generated, ignored or stray files) is packed')
  assert.deepEqual(expected.filter(p => !inPack.includes(p)), [], 'every plugin file is packed')
  assert.deepEqual(inPack.filter(p => EXCLUDED.some(re => re.test(p))), [], 'the excluded set stays out')
})
