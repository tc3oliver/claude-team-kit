// What sync may read from or write to a skill directory. Everything else is rejected.

import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join, sep } from 'node:path'

import { sha256 } from '../core/fsx.ts'

export const MANAGED_MARKER = '.ctk-managed'
export const SKILL_EXTENSIONS = ['.md', '.txt', '.json', '.yaml', '.yml', '.mjs', '.js', '.ts', '.sh']
export const MAX_SKILL_FILE_BYTES = 256 * 1024
export const MAX_SKILL_FILES = 100

/** A repo-relative POSIX path with no traversal, no absolute or drive-letter form, no `.git` segment. */
export const isSafeRelPath = (rel: string): boolean => {
  if (rel === '' || rel.includes('\0') || rel.includes('\\') || rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) return false
  return rel.split('/').every(seg => seg !== '' && seg !== '.' && seg !== '..' && seg.toLowerCase() !== '.git')
}

export type SkillFiles = {
  /** relative POSIX path -> utf8 content */
  files: Map<string, string>
  hashes: Record<string, string>
  problems: string[]
}

/**
 * Read a skill directory under the whitelist: regular text files with an allowed extension,
 * at most 256 KiB each and 100 files, no symlinks. A missing directory is an empty skill.
 * Any problem makes the whole skill unusable: callers must not apply or publish it.
 */
export const collectSkill = (dir: string, opts: { ignoreMarker?: boolean } = {}): SkillFiles => {
  const out: SkillFiles = { files: new Map(), hashes: {}, problems: [] }
  let top
  try {
    top = lstatSync(dir)
  } catch {
    return out
  }
  if (!top.isDirectory()) {
    out.problems.push(`${dir}: not a plain directory`)
    return out
  }
  const walk = (abs: string, rel: string) => {
    for (const ent of readdirSync(abs, { withFileTypes: true })) {
      if (out.files.size > MAX_SKILL_FILES) return
      const r = rel === '' ? ent.name : `${rel}/${ent.name}`
      const full = join(abs, ent.name)
      if (rel === '' && ent.name === MANAGED_MARKER && opts.ignoreMarker) continue
      if (ent.isSymbolicLink()) out.problems.push(`${r}: symlinks are not allowed`)
      else if (ent.isDirectory()) walk(full, r)
      else if (!ent.isFile()) out.problems.push(`${r}: not a regular file`)
      else if (!isSafeRelPath(r)) out.problems.push(`${r}: unsafe path`)
      else if (!SKILL_EXTENSIONS.includes(extname(ent.name).toLowerCase())) out.problems.push(`${r}: extension not allowed`)
      else if (lstatSync(full).size > MAX_SKILL_FILE_BYTES) out.problems.push(`${r}: larger than ${MAX_SKILL_FILE_BYTES / 1024} KiB`)
      else {
        const content = readFileSync(full, 'utf8')
        if (content.includes('\0')) out.problems.push(`${r}: not a text file`)
        else {
          out.files.set(r, content)
          out.hashes[r] = sha256(content)
        }
      }
    }
  }
  walk(dir, '')
  if (out.files.size > MAX_SKILL_FILES) out.problems.push(`more than ${MAX_SKILL_FILES} files`)
  return out
}

/** True when every component of `rel` under `root` is a regular directory/file, not a symlink. */
export const isPlainPath = (root: string, rel: string): boolean => {
  let cur = root
  for (const seg of rel.split('/')) {
    cur = join(cur, seg)
    try {
      if (lstatSync(cur).isSymbolicLink()) return false
    } catch {
      return false
    }
  }
  return cur.startsWith(root + sep)
}
