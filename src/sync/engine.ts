// Git-backed profile sync: init, status, pull, publish, resolve.
// Every operation returns an Outcome (exit code + structured data + human lines); the
// command layer prints it. Nothing here force-pushes or rewrites history.

import { randomBytes } from 'node:crypto'
import { existsSync, readdirSync, renameSync, rmSync, rmdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { Ctx } from '../cli/context.ts'
import { createBackup, ensureDir, readJsonIfExists, readTextIfExists, sha256, toJsonText, writeFileAtomic } from '../core/fsx.ts'
import { deepEqual, flatten, isObject, unflatten, type Json } from '../core/jsonx.ts'
import { isValidProfileName } from '../core/paths.ts'
import { loadEffective, loadUserLayer, saveUserLayer } from '../core/profilestore.ts'
import { parseLayer, PROFILE_SCHEMA_VERSION, type Profile, type ProfileLayer } from '../core/schema.ts'
import { collectSkill, isPlainPath, isSafeRelPath, MANAGED_MARKER, pathProblem, stripControl } from './files.ts'
import { git, gitOk, SyncError } from './git.ts'
import { merge3, type Conflict, type Flat } from './merge3.ts'
import { formatFinding, scanFiles, scanText, type Finding } from './secrets.ts'

export type ApplyResult = { changed: boolean; conflicts: { pointer: string; reason: string }[]; skipped: string[] }
export type SyncDeps = {
  applyProfile: (ctx: Ctx, effective: Profile, opts?: { op: string }) => Promise<ApplyResult>
}

export const defaultDeps: SyncDeps = {
  applyProfile: async (ctx, effective, opts) => (await import('../install/apply.ts')).applyProfile(ctx, effective, opts),
}

export type Outcome = { exit: number; data: Record<string, unknown>; lines: string[] }
type SyncConfig = { remote: string; branch: string }
type Skip = { skill: string; reason: string }

const repoOf = (ctx: Ctx) => ctx.paths.syncRepo
const run = (ctx: Ctx, args: string[]) => git(repoOf(ctx), args, ctx.env)
const runOk = (ctx: Ctx, args: string[]) => gitOk(repoOf(ctx), args, ctx.env)

// ---------- small state files ----------

const writeIfChanged = (path: string, text: string): boolean => {
  if (readTextIfExists(path) === text) return false
  writeFileAtomic(path, text)
  return true
}

const sortedFlat = (f: Flat): Flat => Object.fromEntries(Object.keys(f).sort().map(k => [k, f[k] as Json]))

const loadBase = (ctx: Ctx): Flat => {
  const raw = readJsonIfExists<{ keys?: unknown }>(ctx.paths.syncBase)
  return raw && isObject(raw.keys) ? (raw.keys as Flat) : {}
}
const saveBase = (ctx: Ctx, keys: Flat) =>
  writeIfChanged(ctx.paths.syncBase, toJsonText({ schemaVersion: 1, keys: sortedFlat(keys) }))

const loadConflicts = (ctx: Ctx): Conflict[] => {
  const raw = readJsonIfExists<{ conflicts?: unknown }>(ctx.paths.syncConflicts)
  return raw && Array.isArray(raw.conflicts) ? (raw.conflicts as Conflict[]) : []
}
const saveConflicts = (ctx: Ctx, conflicts: Conflict[]) => {
  if (conflicts.length === 0) {
    if (!existsSync(ctx.paths.syncConflicts)) return false
    rmSync(ctx.paths.syncConflicts)
    return true
  }
  return writeIfChanged(ctx.paths.syncConflicts, toJsonText({ schemaVersion: 1, conflicts }))
}

const loadConfig = (ctx: Ctx): SyncConfig | null => {
  const raw = readJsonIfExists<Partial<SyncConfig>>(ctx.paths.syncConfig)
  if (raw === null) return null
  if (typeof raw.remote !== 'string' || typeof raw.branch !== 'string') throw new SyncError(`${ctx.paths.syncConfig} is malformed`)
  return { remote: raw.remote, branch: raw.branch }
}

const requireReady = (ctx: Ctx): SyncConfig => {
  const cfg = loadConfig(ctx)
  if (!cfg || !existsSync(join(repoOf(ctx), '.git'))) throw new SyncError('sync is not set up: run `ctk sync init --remote <url|path>`')
  assertNoCredentials(cfg.remote)
  if (!isValidProfileName(ctx.profile)) throw new SyncError(`invalid profile name "${ctx.profile}"`)
  return cfg
}

const requireClean = async (ctx: Ctx) => {
  const r = await runOk(ctx, ['status', '--porcelain'])
  if (r.trim() !== '') throw new SyncError(`the profile clone ${repoOf(ctx)} has uncommitted changes; CTK does not touch it until it is clean`)
}

/** Refuse a repo path that reaches through a symlink or a file: reads and writes must stay inside the clone. */
const requirePlain = (root: string, rel: string) => {
  const problem = pathProblem(root, rel)
  if (problem !== null) throw new SyncError(`refusing ${stripControl(rel)}: ${stripControl(problem)} in the profile repo`)
}

const hasCommits = async (ctx: Ctx) => (await run(ctx, ['rev-parse', '-q', '--verify', 'HEAD'])).code === 0

// ---------- profile <-> flat maps ----------

const layerFlat = (layer: ProfileLayer | null): Flat => {
  if (!layer) return {}
  const { schemaVersion: _v, ...rest } = layer
  return flatten(rest)
}
const isProfileKey = (k: string) => k.startsWith('/')
const filterKeys = (f: Flat, pred: (k: string) => boolean): Flat => Object.fromEntries(Object.entries(f).filter(([k]) => pred(k)))
const skillOfKey = (key: string): { name: string; rel: string } => {
  const [, name = '', ...rest] = key.split('/')
  return { name, rel: rest.join('/') }
}

const profileText = (layer: ProfileLayer): string => {
  const { schemaVersion: _v, ...rest } = layer
  return toJsonText({ schemaVersion: PROFILE_SCHEMA_VERSION, ...rest })
}

const loadOurs = (ctx: Ctx): ProfileLayer | null => loadUserLayer(ctx.paths)

// ---------- init ----------

const URLISH = /^[a-z][a-z0-9+.-]*:\/\//i
const SCPISH = /^[\w.-]+@[\w.-]+:/

const NO_CREDENTIALS = 'use a git credential helper or SSH keys instead'

/**
 * A remote URL is stored and printed as typed, so it must not carry a password or token.
 * http(s) userinfo is refused outright: the URL lands in config.json as plaintext, and with
 * GIT_TERMINAL_PROMPT=0 a username-only http(s) URL cannot authenticate anyway. For other
 * schemes userinfo is refused when it holds a password, anything the scanner flags, or a
 * percent-encoding that does not decode (which could hide what follows).
 */
const assertNoCredentials = (remote: string) => {
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)@/i.exec(remote)
  if (m) {
    const scheme = (m[1] ?? '').toLowerCase()
    if (scheme === 'http' || scheme === 'https') throw new SyncError(`the remote URL contains credentials; ${NO_CREDENTIALS}`)
    let decoded: string
    try {
      decoded = decodeURIComponent(m[2] ?? '')
    } catch {
      throw new SyncError(`the remote URL contains credentials; ${NO_CREDENTIALS}`)
    }
    if (decoded.includes(':') || scanText('remote', decoded).length > 0) {
      throw new SyncError(`the remote URL contains credentials; ${NO_CREDENTIALS}`)
    }
  } else if (!SCPISH.test(remote) && /^[^/\\]*:[^/\\]*@/.test(remote)) {
    throw new SyncError(`the remote looks like it contains credentials; ${NO_CREDENTIALS}`)
  }
}

const normalizeRemote = (remote: string, cwd: string): string => {
  if (remote.startsWith('-') || /^[a-z0-9]+::/i.test(remote)) throw new SyncError('unsupported remote')
  assertNoCredentials(remote)
  return URLISH.test(remote) || SCPISH.test(remote) ? remote : resolve(cwd, remote)
}

export const syncInit = async (ctx: Ctx, opts: { remote?: string; branch?: string }): Promise<Outcome> => {
  if (!opts.remote) throw new SyncError('sync init needs --remote <url|path>')
  const branch = opts.branch ?? 'main'
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(branch) || branch.includes('..')) throw new SyncError(`invalid branch "${branch}"`)
  const remote = normalizeRemote(opts.remote, ctx.cwd)
  const existing = loadConfig(ctx)
  if (existing) {
    if (existing.remote !== remote || existing.branch !== branch) {
      throw new SyncError(`sync is already set up for ${existing.remote} (${existing.branch}); refusing to switch to ${remote} (${branch})`)
    }
    return { exit: 0, data: { status: 'already-initialized', remote, branch }, lines: [`sync already set up: ${remote} (${branch})`] }
  }
  if (existsSync(repoOf(ctx))) throw new SyncError(`${repoOf(ctx)} exists without a sync config; move it away and re-run`)
  if (ctx.dryRun) return { exit: 0, data: { status: 'dry-run', remote, branch }, lines: [`would clone ${remote} (${branch}) into ${repoOf(ctx)}`] }

  ensureDir(ctx.paths.syncDir)
  const tmp = join(ctx.paths.syncDir, `repo.tmp-${randomBytes(4).toString('hex')}`)
  ensureDir(tmp)
  try {
    const g = (args: string[]) => gitOk(tmp, args, ctx.env)
    await g(['init', '-q'])
    await g(['symbolic-ref', 'HEAD', `refs/heads/${branch}`])
    await g(['remote', 'add', 'origin', remote])
    const ls = await git(tmp, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`], ctx.env)
    if (ls.code !== 0) throw new SyncError(`cannot reach ${remote}: ${ls.stderr.trim()}`)
    let empty = true
    if (ls.stdout.trim() !== '') {
      await g(['fetch', '-q', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`])
      await g(['merge', '-q', '--ff-only', `origin/${branch}`])
      const marker = readJsonIfExists<{ schemaVersion?: unknown }>(join(tmp, 'ctk-profile.json'))
      if (!marker || marker.schemaVersion !== PROFILE_SCHEMA_VERSION) {
        throw new SyncError(`${remote} (${branch}) is not a CTK profile repo: ctk-profile.json is missing or has another schemaVersion`)
      }
      empty = false
    }
    renameSync(tmp, repoOf(ctx))
    writeFileAtomic(ctx.paths.syncConfig, toJsonText({ remote, branch }))
    return {
      exit: 0,
      data: { status: 'initialized', remote, branch, empty },
      lines: [`sync set up: ${remote} (${branch})${empty ? ' - remote is empty; run `ctk sync publish` to create the profile' : ''}`],
    }
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
  }
}

// ---------- reading the repo and planning a merge ----------

type Incoming = { text: string; layer: ProfileLayer }

const readIncoming = async (ctx: Ctx): Promise<Incoming | null> => {
  const repo = repoOf(ctx)
  if (!(await hasCommits(ctx))) return null
  requirePlain(repo, 'ctk-profile.json')
  const marker = readJsonIfExists<{ schemaVersion?: unknown }>(join(repo, 'ctk-profile.json'))
  if (!marker || marker.schemaVersion !== PROFILE_SCHEMA_VERSION) throw new SyncError('the profile repo has no valid ctk-profile.json')
  const rel = `profiles/${ctx.profile}.json`
  requirePlain(repo, rel)
  const text = readTextIfExists(join(repo, rel))
  if (text === null) return null
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new SyncError(`${rel} in the profile repo is not valid JSON: ${(e as Error).message}`)
  }
  return { text, layer: parseLayer(raw, rel) }
}

type Plan = {
  layerOurs: ProfileLayer | null
  base: Flat
  /** base restricted to what took part in the merge (skipped skills excluded) */
  baseUsed: Flat
  ours: Flat
  theirs: Flat
  merge: ReturnType<typeof merge3>
  theirsContent: Map<string, string>
  skipped: Skip[]
  rejected: Skip[]
  findings: Finding[]
}

const buildPlan = (ctx: Ctx, incoming: Incoming): Plan => {
  const repo = repoOf(ctx)
  const layerOurs = loadOurs(ctx)
  const base = loadBase(ctx)
  const ours = layerFlat(layerOurs)
  const theirs = layerFlat(incoming.layer)
  const theirsContent = new Map<string, string>()
  const skipped: Skip[] = []
  const rejected: Skip[] = []
  const baseM: Flat = filterKeys(base, isProfileKey)
  const names = new Set([...(layerOurs?.skills ?? []), ...(incoming.layer.skills ?? [])])
  for (const k of Object.keys(base)) if (!isProfileKey(k)) names.add(skillOfKey(k).name)

  for (const name of [...names].sort()) {
    const mine = collectSkill(join(ctx.paths.skillsDir, name), { ignoreMarker: true })
    if (mine.problems.length > 0) {
      skipped.push({ skill: name, reason: `local skill directory unusable: ${mine.problems[0]}` })
      continue
    }
    let theirSide = { files: new Map<string, string>(), hashes: {} as Record<string, string> }
    if (incoming.layer.skills?.includes(name)) {
      requirePlain(repo, `skills/${name}`)
      const incomingSkill = collectSkill(join(repo, 'skills', name))
      if (incomingSkill.problems.length > 0) {
        rejected.push({ skill: name, reason: incomingSkill.problems.slice(0, 3).join('; ') })
        continue
      }
      if (incomingSkill.files.size === 0) {
        skipped.push({ skill: name, reason: 'listed in the profile but missing from the repo' })
        continue
      }
      theirSide = incomingSkill
    }
    for (const [rel, h] of Object.entries(mine.hashes)) ours[`skills/${name}/${rel}`] = h
    for (const [rel, h] of Object.entries(theirSide.hashes)) {
      theirs[`skills/${name}/${rel}`] = h
      theirsContent.set(`skills/${name}/${rel}`, theirSide.files.get(rel) as string)
    }
    for (const [k, v] of Object.entries(base)) if (k.startsWith(`skills/${name}/`)) baseM[k] = v
  }

  const findings = [
    ...scanText(`profiles/${ctx.profile}.json`, incoming.text, { json: true }),
    ...scanFiles([...theirsContent].map(([path, content]) => ({ path, content }))),
  ]
  return { layerOurs, base, baseUsed: baseM, ours, theirs, merge: merge3(baseM, ours, theirs), theirsContent, skipped, rejected, findings }
}

/** Fetch and fast-forward the clone. 'diverged' leaves it untouched. */
const updateClone = async (ctx: Ctx, cfg: SyncConfig): Promise<'ok' | 'empty-remote' | 'diverged'> => {
  const ls = await run(ctx, ['ls-remote', '--heads', 'origin', `refs/heads/${cfg.branch}`])
  if (ls.code !== 0) throw new SyncError(`cannot reach ${cfg.remote}: ${ls.stderr.trim()}`)
  if (ls.stdout.trim() === '') return 'empty-remote'
  await runOk(ctx, ['fetch', '-q', 'origin', `+refs/heads/${cfg.branch}:refs/remotes/origin/${cfg.branch}`])
  const m = await run(ctx, ['merge', '-q', '--ff-only', `origin/${cfg.branch}`])
  return m.code === 0 ? 'ok' : 'diverged'
}

const diffKeys = (a: Flat, b: Flat): string[] =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => Object.hasOwn(a, k) !== Object.hasOwn(b, k) || !deepEqual(a[k], b[k]))

// ---------- applying skill changes locally ----------

const pruneEmpty = (dir: string) => {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) pruneEmpty(join(dir, ent.name))
  }
  if (readdirSync(dir).length === 0) rmdirSync(dir)
}

const tidySkillDir = (dir: string) => {
  if (!existsSync(dir)) return
  pruneEmpty(dir)
  if (existsSync(dir) && readdirSync(dir).join() === MANAGED_MARKER) {
    rmSync(join(dir, MANAGED_MARKER))
    rmdirSync(dir)
  }
}

type SkillOp = { name: string; keys: string[]; blocked: boolean }

const planSkillOps = (ctx: Ctx, appliedKeys: string[]): SkillOp[] => {
  const by = new Map<string, string[]>()
  for (const k of appliedKeys.filter(k => !isProfileKey(k))) {
    const { name } = skillOfKey(k)
    by.set(name, [...(by.get(name) ?? []), k])
  }
  return [...by].map(([name, keys]) => {
    const dir = join(ctx.paths.skillsDir, name)
    return { name, keys, blocked: existsSync(dir) && !existsSync(join(dir, MANAGED_MARKER)) }
  })
}

const writeSkillKey = (ctx: Ctx, key: string, content: string | undefined) => {
  const { name, rel } = skillOfKey(key)
  if (!isSafeRelPath(rel) || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(name)) throw new SyncError(`unsafe skill path ${key}`)
  const dir = join(ctx.paths.skillsDir, name)
  if (content === undefined) {
    rmSync(join(dir, ...rel.split('/')), { force: true })
    tidySkillDir(dir)
    return
  }
  writeFileAtomic(join(dir, ...rel.split('/')), content)
  if (!existsSync(join(dir, MANAGED_MARKER))) writeFileAtomic(join(dir, MANAGED_MARKER), 'managed by ctk sync\n')
}

const skillFilePath = (ctx: Ctx, key: string) => {
  const { name, rel } = skillOfKey(key)
  return join(ctx.paths.skillsDir, name, ...rel.split('/'))
}

// ---------- pull ----------

export const syncPull = async (ctx: Ctx, deps: SyncDeps): Promise<Outcome> => {
  const cfg = requireReady(ctx)
  await requireClean(ctx)
  const lines: string[] = []
  const data: Record<string, unknown> = { dryRun: ctx.dryRun }

  if (ctx.dryRun) lines.push('dry run: the remote is not fetched; showing the merge against the clone as it is')
  else {
    const st = await updateClone(ctx, cfg)
    data.remote = st
    if (st === 'diverged') {
      return {
        exit: 2,
        data: { ...data, status: 'diverged' },
        lines: ['the remote history diverged from the local clone; nothing was changed. Inspect ' + repoOf(ctx) + ' or re-initialize sync.'],
      }
    }
  }

  const incoming = await readIncoming(ctx)
  if (!incoming) {
    return { exit: 0, data: { ...data, status: 'noop' }, lines: [...lines, `nothing to pull: profiles/${ctx.profile}.json is not in the repo yet`] }
  }
  const plan = buildPlan(ctx, incoming)

  if (plan.findings.length > 0 || plan.rejected.length > 0) {
    const out = [
      ...plan.findings.map(f => `refused: secret-like content in incoming ${formatFinding(f)}`),
      ...plan.rejected.map(r => `refused: skill ${r.skill} violates the whitelist: ${r.reason}`),
      'nothing was applied',
    ]
    return { exit: 1, data: { ...data, status: 'refused', findings: plan.findings, rejected: plan.rejected }, lines: [...lines, ...out] }
  }

  const { merge } = plan
  const ops = planSkillOps(ctx, merge.applied)
  const blockedKeys = new Set(ops.filter(o => o.blocked).flatMap(o => o.keys))
  const profileMerged = filterKeys(merge.merged, isProfileKey)
  const layerChanged = !deepEqual(profileMerged, filterKeys(plan.ours, isProfileKey))
  const appliedKeys = merge.applied.filter(k => !blockedKeys.has(k))
  const skipped = [...plan.skipped, ...ops.filter(o => o.blocked).map(o => ({ skill: o.name, reason: 'directory exists without the .ctk-managed marker; left untouched' }))]

  data.status = merge.conflicts.length > 0 ? 'conflicts' : appliedKeys.length > 0 ? 'applied' : 'up-to-date'
  data.applied = appliedKeys
  data.conflicts = merge.conflicts
  data.skipped = skipped
  for (const k of appliedKeys) lines.push(`${ctx.dryRun ? 'would apply' : 'applied'} ${k}`)
  for (const c of merge.conflicts) lines.push(`conflict ${c.key}: ours ${JSON.stringify(c.ours)} vs theirs ${JSON.stringify(c.theirs)}`)
  for (const s of skipped) lines.push(`skipped skill ${s.skill}: ${s.reason}`)
  let exit = merge.conflicts.length > 0 || blockedKeys.size > 0 ? 2 : 0

  if (!ctx.dryRun) {
    let newLayer: ProfileLayer | null = null
    if (layerChanged) newLayer = parseLayer(unflatten(profileMerged), 'merged profile')
    const touched = [
      ...(layerChanged ? [ctx.paths.profile] : []),
      ...appliedKeys.filter(k => !isProfileKey(k)).map(k => skillFilePath(ctx, k)),
    ]
    if (touched.length > 0) data.backup = createBackup(ctx.paths.backupsDir, 'sync-pull', touched).id
    if (newLayer) saveUserLayer(ctx.paths, newLayer)
    for (const k of appliedKeys.filter(k => !isProfileKey(k))) writeSkillKey(ctx, k, plan.theirsContent.get(k))

    const conflictKeys = new Set(merge.conflicts.map(c => c.key))
    const newBase: Flat = { ...plan.base }
    for (const k of new Set([...Object.keys(plan.ours), ...Object.keys(plan.theirs), ...Object.keys(plan.baseUsed)])) {
      if (conflictKeys.has(k) || blockedKeys.has(k)) continue
      if (Object.hasOwn(plan.theirs, k)) newBase[k] = plan.theirs[k] as Json
      else delete newBase[k]
    }
    saveBase(ctx, newBase)
    saveConflicts(ctx, merge.conflicts)

    if (layerChanged) {
      const res = await deps.applyProfile(ctx, loadEffective(ctx.paths, ctx.device), { op: 'sync-pull' })
      data.apply = res
      for (const c of res.conflicts) lines.push(`settings conflict ${c.pointer}: ${c.reason}`)
      if (res.conflicts.length > 0) exit = 2
    }
  }
  if (lines.length === 0) lines.push('already up to date')
  return { exit, data, lines }
}

// ---------- publish ----------

/**
 * Tracked `skills/` files no profile in the repo references any more, i.e. what this publish deletes.
 * Every path is checked before it can reach `rmSync`: a crafted tracked entry (`../`, `.git`, an
 * absolute or control-character form) throws instead of deleting something outside the clone.
 */
export const staleSkillPaths = (tracked: string[], planned: Set<string>, ownSkills: Set<string>, otherRefs: Set<string>): string[] =>
  tracked
    .filter(f => {
      const name = f.split('/')[1] ?? ''
      return f.startsWith('skills/') && !planned.has(f) && (ownSkills.has(name) || !otherRefs.has(name))
    })
    .map(f => {
      if (!isSafeRelPath(f)) throw new SyncError(`refusing to remove ${stripControl(f)}: unsafe path in the profile repo; fix or re-clone it`)
      return f
    })

export const syncPublish = async (ctx: Ctx, deps: SyncDeps, opts: { message?: string }): Promise<Outcome> => {
  const cfg = requireReady(ctx)
  const pulled = await syncPull(ctx, deps)
  if (pulled.exit !== 0) return { exit: pulled.exit, data: { ...pulled.data, aborted: 'pull' }, lines: [...pulled.lines, 'publish aborted'] }

  const layer = loadOurs(ctx)
  if (!layer) throw new SyncError('there is no local profile to publish; set values with `ctk config set` first')
  const repo = repoOf(ctx)
  const planned = new Map<string, string>()
  requirePlain(repo, 'ctk-profile.json')
  const marker = join(repo, 'ctk-profile.json')
  const markerRaw = existsSync(marker) ? readJsonIfExists<{ schemaVersion?: unknown }>(marker) : null
  if (!markerRaw || markerRaw.schemaVersion !== PROFILE_SCHEMA_VERSION) {
    planned.set('ctk-profile.json', toJsonText({ schemaVersion: PROFILE_SCHEMA_VERSION, name: ctx.profile }))
  }
  planned.set(`profiles/${ctx.profile}.json`, profileText(layer))

  for (const rel of planned.keys()) requirePlain(repo, rel)
  requirePlain(repo, 'profiles')
  const oursFlat = layerFlat(layer)
  const problems: string[] = []
  for (const name of layer.skills ?? []) {
    requirePlain(repo, `skills/${name}`)
    const s = collectSkill(join(ctx.paths.skillsDir, name), { ignoreMarker: true })
    if (s.problems.length > 0) problems.push(...s.problems.map(p => `skill ${name}: ${p}`))
    else if (s.files.size === 0) problems.push(`skill ${name}: listed in the profile but not found in ${ctx.paths.skillsDir}`)
    for (const [rel, content] of s.files) {
      requirePlain(repo, `skills/${name}/${rel}`)
      planned.set(`skills/${name}/${rel}`, content)
    }
    for (const [rel, h] of Object.entries(s.hashes)) oursFlat[`skills/${name}/${rel}`] = h
  }
  if (problems.length > 0) return { exit: 1, data: { status: 'refused', problems }, lines: [...problems.map(p => `refused: ${p}`), 'nothing was published'] }

  const message = opts.message ?? `ctk: update profile ${ctx.profile} from ${ctx.device}`
  const findings = [...scanFiles([...planned].map(([path, content]) => ({ path, content }))), ...scanText('(commit message)', message)]
  if (findings.length > 0) {
    return {
      exit: 1,
      data: { status: 'refused', findings },
      lines: [...findings.map(f => `refused: secret-like content ${formatFinding(f)}`), 'nothing was published; the repo is unchanged'],
    }
  }

  // Skill directories no profile in the repo references any more are removed with this commit.
  // A sibling profile that cannot be read or validated refuses the whole publish: treating it as
  // "references nothing" would delete the skills it vouches for.
  const ownSkills = new Set(layer.skills ?? [])
  const otherRefs = new Set<string>()
  const tracked = (await hasCommits(ctx)) ? (await runOk(ctx, ['ls-files', '-z'])).split('\0').filter(Boolean) : []
  for (const f of tracked.filter(f => /^profiles\/[^/]+\.json$/.test(f) && f !== `profiles/${ctx.profile}.json`)) {
    let text: string | null
    try {
      text = readTextIfExists(join(repo, f))
    } catch (e) {
      throw new SyncError(`cannot read ${stripControl(f)} in the profile repo (${(e as Error).message}); refusing to publish`)
    }
    if (text === null) throw new SyncError(`${stripControl(f)} is tracked but missing from the clone; run \`ctk sync pull\` and publish again`)
    let sibling: ProfileLayer
    try {
      sibling = parseLayer(JSON.parse(text), f)
    } catch (e) {
      throw new SyncError(`${stripControl(f)} in the profile repo is not a valid profile (${(e as Error).message}); refusing to publish`)
    }
    for (const s of sibling.skills ?? []) otherRefs.add(s)
  }
  const stale = staleSkillPaths(tracked, new Set(planned.keys()), ownSkills, otherRefs)
  for (const f of stale) requirePlain(repo, f)
  const changed = [...planned].filter(([p, c]) => readTextIfExists(join(repo, p)) !== c).map(([p]) => p)
  const files = [...changed, ...stale]

  const ahead = (await hasCommits(ctx)) ? await commitsAhead(ctx, cfg) : 0
  if (ahead > 0) {
    const bad = await checkUnpushed(ctx, cfg, p => p === 'ctk-profile.json' || p === `profiles/${ctx.profile}.json` || (p.startsWith('skills/') && ownSkills.has(p.split('/')[1] ?? '')))
    if (bad.length > 0) return { exit: 1, data: { status: 'refused', unpushed: bad }, lines: [...bad.map(b => `refused: unpushed commit ${b}`), 'nothing was pushed'] }
  }
  const data: Record<string, unknown> = { files, scan: 'clean', dryRun: ctx.dryRun, unpushedCommits: ahead }
  if (files.length === 0 && ahead === 0) {
    if (!ctx.dryRun) saveBase(ctx, oursFlat)
    return { exit: 0, data: { ...data, status: 'up-to-date' }, lines: ['nothing to publish: the repo already matches the local profile'] }
  }
  if (ctx.dryRun) {
    return {
      exit: 0,
      data: { ...data, status: 'dry-run' },
      lines: [...files.map(f => `would ${stale.includes(f) ? 'remove' : 'write'} ${f}`), 'secrets scan: clean', `would commit "${message}" and push to ${cfg.remote} (${cfg.branch})`],
    }
  }

  const prev = (await hasCommits(ctx)) ? (await runOk(ctx, ['rev-parse', 'HEAD'])).trim() : null
  try {
    if (files.length > 0) {
      for (const p of changed) writeFileAtomic(join(repo, ...p.split('/')), planned.get(p) as string)
      for (const p of stale) rmSync(join(repo, ...p.split('/')), { force: true })
      await runOk(ctx, ['add', '-A', '--', ...files])
      if ((await run(ctx, ['diff', '--cached', '--quiet'])).code !== 0) await runOk(ctx, ['commit', '-q', '--no-verify', '-m', message])
    }
    const push = await run(ctx, ['push', '-q', 'origin', `HEAD:refs/heads/${cfg.branch}`])
    if (push.code !== 0) throw new SyncError(`push was rejected: ${push.stderr.trim()}\nrun \`ctk sync pull\` and publish again`, 2)
  } catch (e) {
    const failed = await rollbackClone(ctx, prev, files)
    if (failed.length > 0) {
      const why = e instanceof Error ? e.message : String(e)
      throw new SyncError(`${why}\nand the clone could not be restored (${failed.join('; ')}); fix or remove ${repoOf(ctx)} before the next sync`)
    }
    throw e
  }
  saveBase(ctx, oursFlat)
  saveConflicts(ctx, [])
  const head = (await runOk(ctx, ['rev-parse', '--short', 'HEAD'])).trim()
  return { exit: 0, data: { ...data, status: 'published', commit: head }, lines: [...files.map(f => `published ${f}`), `pushed ${head} to ${cfg.branch}`] }
}

const commitsAhead = async (ctx: Ctx, cfg: SyncConfig): Promise<number> => {
  const r = await run(ctx, ['rev-list', '--count', `origin/${cfg.branch}..HEAD`])
  if (r.code !== 0) return 1 // no remote-tracking ref yet: everything is unpushed
  return Number(r.stdout.trim()) || 0
}

/**
 * Commits the clone holds that the remote does not. Each must touch only whitelisted paths and carry
 * no secret-like content in any version of a file, because a push sends every one of them.
 * Returns one line per problem.
 */
const checkUnpushed = async (ctx: Ctx, cfg: SyncConfig, allowed: (path: string) => boolean): Promise<string[]> => {
  const hasRef = (await run(ctx, ['rev-parse', '-q', '--verify', `refs/remotes/origin/${cfg.branch}`])).code === 0
  const commits = (await runOk(ctx, ['rev-list', '--reverse', hasRef ? `origin/${cfg.branch}..HEAD` : 'HEAD'])).split('\n').filter(Boolean)
  const out: string[] = []
  for (const c of commits) {
    const paths = (await runOk(ctx, ['diff-tree', '-r', '-m', '--root', '--no-commit-id', '--name-only', '-z', c])).split('\0').filter(Boolean)
    for (const path of paths) {
      const label = `${c.slice(0, 8)} ${path}`
      if (!allowed(path) || !isSafeRelPath(path)) {
        out.push(`${label}: path is outside the whitelist`)
        continue
      }
      const blob = await run(ctx, ['show', `${c}:${path}`])
      if (blob.code !== 0) continue // deleted in that commit
      for (const f of scanText(path, blob.stdout)) out.push(`${c.slice(0, 8)} ${formatFinding(f)}`)
    }
  }
  return out
}

/** Put the managed clone back as it was before a failed publish, so the next pull can fast-forward. Returns what failed. */
const rollbackClone = async (ctx: Ctx, prev: string | null, files: string[]): Promise<string[]> => {
  const failed: string[] = []
  const step = async (args: string[]) => {
    const r = await run(ctx, args)
    if (r.code !== 0) failed.push(`git ${args[0]}: ${r.stderr.trim()}`)
  }
  if (prev) await step(['reset', '-q', '--hard', prev])
  else {
    await step(['update-ref', '-d', 'HEAD'])
    await step(['reset', '-q'])
    for (const f of files) {
      try {
        rmSync(join(repoOf(ctx), ...f.split('/')), { force: true })
      } catch (e) {
        failed.push(`remove ${f}: ${(e as Error).message}`)
      }
    }
  }
  return failed
}

// ---------- status ----------

export const syncStatus = async (ctx: Ctx): Promise<Outcome> => {
  const cfg = loadConfig(ctx)
  if (!cfg || !existsSync(join(repoOf(ctx), '.git'))) {
    return { exit: 0, data: { configured: false }, lines: ['sync is not set up: run `ctk sync init --remote <url|path>`'] }
  }
  const conflicts = loadConflicts(ctx)
  const data: Record<string, unknown> = { configured: true, remote: cfg.remote, branch: cfg.branch, conflicts: conflicts.length }
  const lines = [`remote ${cfg.remote} (${cfg.branch}), profile ${ctx.profile}`]
  if (await hasCommits(ctx)) {
    data.head = (await runOk(ctx, ['rev-parse', '--short', 'HEAD'])).trim()
    const counts = await run(ctx, ['rev-list', '--left-right', '--count', `HEAD...origin/${cfg.branch}`])
    if (counts.code === 0) {
      const [a = '0', b = '0'] = counts.stdout.trim().split(/\s+/)
      data.ahead = Number(a)
      data.behind = Number(b)
      lines.push(`clone at ${String(data.head)}: ${a} unpushed commit(s), ${b} not yet merged (as of the last fetch)`)
    }
    const incoming = await readIncoming(ctx)
    if (incoming) {
      const plan = buildPlan(ctx, incoming)
      const local = diffKeys(plan.ours, plan.baseUsed).length
      data.pendingLocalChanges = local
      data.pendingRemoteChanges = plan.merge.applied.length
      lines.push(`${local} local key(s) differ from the last sync; ${plan.merge.applied.length} remote change(s) to pull`)
    } else lines.push(`profiles/${ctx.profile}.json is not in the repo yet`)
  } else lines.push('the repo has no commits yet')
  if (conflicts.length > 0) lines.push(`${conflicts.length} unresolved conflict(s): ${conflicts.map(c => c.key).join(', ')} (see \`ctk sync resolve <key> ours|theirs\`)`)
  return { exit: conflicts.length > 0 ? 2 : 0, data, lines }
}

// ---------- resolve ----------

export const syncResolve = async (ctx: Ctx, deps: SyncDeps, key: string | undefined, side: string | undefined): Promise<Outcome> => {
  requireReady(ctx)
  if (!key || (side !== 'ours' && side !== 'theirs')) throw new SyncError('usage: ctk sync resolve <pointer> ours|theirs')
  const conflicts = loadConflicts(ctx)
  const c = conflicts.find(x => x.key === key)
  if (!c) throw new SyncError(`no unresolved conflict for ${key}`)
  const theirsPresent = Object.hasOwn(c, 'theirs')
  if (ctx.dryRun) return { exit: 0, data: { status: 'dry-run', key, side }, lines: [`would keep ${side} for ${key}`] }

  if (side === 'theirs') {
    if (isProfileKey(key)) {
      const flat = layerFlat(loadOurs(ctx))
      if (theirsPresent) flat[key] = c.theirs as Json
      else delete flat[key]
      const layer = parseLayer(unflatten(flat), 'resolved profile')
      createBackup(ctx.paths.backupsDir, 'sync-resolve', [ctx.paths.profile])
      saveUserLayer(ctx.paths, layer)
      await deps.applyProfile(ctx, loadEffective(ctx.paths, ctx.device), { op: 'sync-resolve' })
    } else {
      if (!isSafeRelPath(key)) throw new SyncError(`unsafe conflict key ${key}`)
      const { name } = skillOfKey(key)
      const dir = join(ctx.paths.skillsDir, name)
      if (existsSync(dir) && !existsSync(join(dir, MANAGED_MARKER))) throw new SyncError(`${dir} is not CTK-managed; refusing to overwrite it`)
      let content: string | undefined
      if (theirsPresent) {
        content = isPlainPath(repoOf(ctx), key) ? (readTextIfExists(join(repoOf(ctx), ...key.split('/'))) ?? undefined) : undefined
        if (content === undefined || scanText(key, content).length > 0) throw new SyncError(`the repo copy of ${key} is missing or unsafe; run \`ctk sync pull\``)
        if (sha256(content) !== c.theirs) throw new SyncError(`${key} changed in the repo since the conflict was recorded; run \`ctk sync pull\``)
      }
      createBackup(ctx.paths.backupsDir, 'sync-resolve', [skillFilePath(ctx, key)])
      writeSkillKey(ctx, key, content)
    }
  }
  const base = loadBase(ctx)
  if (theirsPresent) base[key] = c.theirs as Json
  else delete base[key]
  saveBase(ctx, base)
  saveConflicts(ctx, conflicts.filter(x => x.key !== key))
  return { exit: 0, data: { status: 'resolved', key, side }, lines: [`resolved ${key}: kept ${side}`] }
}
