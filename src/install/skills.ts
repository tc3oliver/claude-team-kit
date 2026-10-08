import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import type { Ctx } from '../cli/context.ts'
import { listFiles, sha256, writeFileAtomic } from '../core/fsx.ts'
import { loadLedger, newLedger, type FileEntry } from '../core/ledger.ts'
import { beginTxn, syncLedger } from './txn.ts'

export const SKILL_MARKER = '.ctk-managed'
const MARKER_TEXT = 'Managed by ctk (Claude Team Kit). Local edits are overwritten by "ctk sync"; remove this file to take the skill over.\n'

export type SkillsResult = {
  written: string[]
  unchanged: string[]
  removed: string[]
  conflicts: { name: string; reason: string }[]
}

/** Hash of a directory's regular files (paths + contents), so a managed skill can be checked for local edits. */
const hashPairs = (pairs: [string, string][]): string =>
  sha256(
    pairs
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([rel, h]) => `${rel}\0${h}\n`)
      .join(''),
  )

export const treeHash = (dir: string): string =>
  hashPairs(listFiles(dir).map(rel => [rel, sha256(readFileSync(join(dir, rel)))]))

const isDir = (p: string): boolean => existsSync(p) && lstatSync(p).isDirectory()

/**
 * Copy `<repoSkillsDir>/<name>/` to `<config>/skills/<name>/` with a `.ctk-managed` marker.
 * A destination directory without the marker is never touched. Managed skills missing from `names`
 * are removed if they are still exactly as CTK wrote them. Previously written content is not backed
 * up: it is reproducible from the profile repo.
 */
export const materializeSkills = async (ctx: Ctx, names: string[], repoSkillsDir: string): Promise<SkillsResult> => {
  const res: SkillsResult = { written: [], unchanged: [], removed: [], conflicts: [] }
  const ledger = loadLedger(ctx) ?? newLedger(ctx)
  const t = beginTxn(ctx, ledger, 'skills')
  const dest = (name: string) => join(ctx.paths.skillsDir, name)
  const entryFor = (path: string) => ledger.entries.find((e): e is FileEntry => e.kind === 'file' && e.path === path) ?? null
  const setEntry = (path: string, after: FileEntry | null) => {
    const before = entryFor(path)
    ledger.entries = ledger.entries.filter(e => e !== before)
    if (after) ledger.entries.push(after)
    t.changes.push({ kind: 'file', path, before, after })
  }

  for (const name of names) {
    const src = join(repoSkillsDir, name)
    const d = dest(name)
    if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(name)) {
      res.conflicts.push({ name, reason: 'not a valid skill name' })
    } else if (!isDir(src)) {
      res.conflicts.push({ name, reason: `${src} is not a directory` })
    } else if (existsSync(d) && !existsSync(join(d, SKILL_MARKER))) {
      res.conflicts.push({ name, reason: `${d} exists and is not managed by ctk; left untouched` })
    } else {
      const files = listFiles(src).filter(f => f !== SKILL_MARKER)
      const wantHash = hashPairs([...files.map((rel): [string, string] => [rel, sha256(readFileSync(join(src, rel)))]), [SKILL_MARKER, sha256(MARKER_TEXT)]])
      if (existsSync(d) && treeHash(d) === wantHash) {
        res.unchanged.push(name)
        continue
      }
      res.written.push(name)
      if (ctx.dryRun) continue
      rmSync(d, { recursive: true, force: true })
      mkdirSync(d, { recursive: true })
      for (const rel of files) {
        mkdirSync(join(d, ...rel.split('/').slice(0, -1)), { recursive: true })
        cpSync(join(src, rel), join(d, ...rel.split('/')))
      }
      writeFileAtomic(join(d, SKILL_MARKER), MARKER_TEXT)
      setEntry(d, { kind: 'file', path: d, sha256: treeHash(d), priorSha256: null })
    }
  }

  const wanted = new Set(names.map(dest))
  for (const e of [...ledger.entries]) {
    if (e.kind !== 'file' || !e.path.startsWith(ctx.paths.skillsDir) || wanted.has(e.path)) continue
    if (!existsSync(join(e.path, SKILL_MARKER)) || treeHash(e.path) !== e.sha256) continue
    res.removed.push(e.path)
    if (ctx.dryRun) continue
    rmSync(e.path, { recursive: true, force: true })
    setEntry(e.path, null)
  }

  if (!ctx.dryRun && t.changes.length > 0) syncLedger(t)
  return res
}
