// Shared fixtures for the sync tests: temp config dirs, local bare repos as remotes, a stub applyProfile.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { devNull, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after } from 'node:test'

import type { Ctx } from '../src/cli/context.ts'
import { runSync } from '../src/cli/commands/sync.ts'
import { ctkPaths } from '../src/core/paths.ts'
import { sha256 } from '../src/core/fsx.ts'
import type { SyncDeps } from '../src/sync/engine.ts'

const dirs: string[] = []
export const tmp = (prefix = 'ctk-'): string => {
  const d = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(d)
  return d
}
export const registerCleanup = () =>
  after(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
  })

export const gitEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
})

export const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, env: gitEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

export const bareRemote = (): string => {
  const dir = join(tmp('ctk-remote-'), 'remote.git')
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '--bare', '--initial-branch=main')
  return dir
}

export type Device = {
  ctx: Ctx
  out: string[]
  err: string[]
  applied: { op: string | undefined; maxWorkers: number }[]
  deps: SyncDeps
  sync: (...argv: string[]) => Promise<number>
  /** last --json document printed by a command */
  json: (...argv: string[]) => Promise<{ code: number; doc: Record<string, unknown> }>
  repo: string
}

export const device = (name: string, over: Partial<Ctx> = {}): Device => {
  const configDir = join(tmp('ctk-cfg-'), '.claude')
  mkdirSync(configDir, { recursive: true })
  const out: string[] = []
  const err: string[] = []
  const applied: Device['applied'] = []
  const ctx: Ctx = {
    configDir,
    paths: ctkPaths(configDir),
    device: name,
    profile: 'default',
    dryRun: false,
    json: false,
    yes: true,
    env: gitEnv(),
    cwd: tmp('ctk-cwd-'),
    out: l => out.push(l),
    err: l => err.push(l),
    ...over,
  }
  const deps: SyncDeps = {
    applyProfile: async (_c, effective, opts) => {
      applied.push({ op: opts?.op, maxWorkers: effective.team.maxWorkers })
      return { changed: true, conflicts: [], skipped: [] }
    },
  }
  return {
    ctx,
    out,
    err,
    applied,
    deps,
    repo: ctx.paths.syncRepo,
    sync: (...argv) => runSync(argv, ctx, deps),
    json: async (...argv) => {
      out.length = 0
      const code = await runSync(argv, { ...ctx, json: true }, deps)
      return { code, doc: JSON.parse(out.join('\n')) as Record<string, unknown> }
    },
  }
}
export const writeProfile = (d: Device, layer: Record<string, unknown>) => {
  mkdirSync(dirname(d.ctx.paths.profile), { recursive: true })
  writeFileSync(d.ctx.paths.profile, `${JSON.stringify({ schemaVersion: 1, ...layer }, null, 2)}\n`)
}
export const readProfile = (d: Device): Record<string, unknown> => JSON.parse(readFileSync(d.ctx.paths.profile, 'utf8')) as Record<string, unknown>

export const writeSkill = (d: Device, name: string, files: Record<string, string>) => {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(d.ctx.paths.skillsDir, name, ...rel.split('/'))
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, content)
  }
}

/** path -> sha + mtime for every file under dir except .git, to prove "no writes". */
export const snapshot = (dir: string): Record<string, string> => {
  const out: Record<string, string> = {}
  const walk = (d: string) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      if (ent.name === '.git') continue
      const full = join(d, ent.name)
      if (ent.isDirectory()) walk(full)
      else out[full] = `${sha256(readFileSync(full))}@${statSync(full).mtimeMs}`
    }
  }
  walk(dir)
  return out
}

export const remoteRefs = (remote: string): string => git(remote, 'for-each-ref')

/** Clone the remote into a scratch working copy to inspect or tamper with its content. */
export const workClone = (remote: string): string => {
  const dir = join(tmp('ctk-work-'), 'w')
  git(tmpdir(), 'clone', '-q', remote, dir)
  return dir
}
