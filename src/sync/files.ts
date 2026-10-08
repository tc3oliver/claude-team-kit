// What sync may read from or write to a skill directory. Everything else is rejected.

import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join, sep } from 'node:path'

import { sha256 } from '../core/fsx.ts'

export const MANAGED_MARKER = '.ctk-managed'
export const SKILL_EXTENSIONS = ['.md', '.txt', '.json', '.yaml', '.yml', '.mjs', '.js', '.ts', '.sh']
export const MAX_SKILL_FILE_BYTES = 256 * 1024
export const MAX_SKILL_FILES = 100

const CONTROL = /[\x00-\x1f\x7f-\x9f]/
const CONTROL_ALL = /[\x00-\x1f\x7f-\x9f]/g

/** Remove terminal control characters from text that came from outside before it is printed. */
export const stripControl = (s: string): string => s.replace(CONTROL_ALL, '')

/** A repo-relative POSIX path with no traversal, no absolute or drive-letter form, no `.git` segment. */
export const isSafeRelPath = (rel: string): boolean => {
  if (rel === '' || CONTROL.test(rel) || rel.includes('\\') || rel.includes(':') || rel.startsWith('/')) return false
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
      const shown = stripControl(r)
      if (rel === '' && ent.name === MANAGED_MARKER && opts.ignoreMarker) continue
      if (ent.isSymbolicLink()) out.problems.push(`${shown}: symlinks are not allowed`)
      else if (ent.isDirectory()) walk(full, r)
      else if (!ent.isFile()) out.problems.push(`${shown}: not a regular file`)
      else if (!isSafeRelPath(r)) out.problems.push(`${shown}: unsafe path`)
      else if (!SKILL_EXTENSIONS.includes(extname(ent.name).toLowerCase())) out.problems.push(`${shown}: extension not allowed`)
      else if (lstatSync(full).size > MAX_SKILL_FILE_BYTES) out.problems.push(`${shown}: larger than ${MAX_SKILL_FILE_BYTES / 1024} KiB`)
      else {
        const content = readFileSync(full, 'utf8')
        if (content.includes('\0')) out.problems.push(`${shown}: not a text file`)
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

/**
 * Null when every EXISTING component of `rel` under `root` is a regular directory or file.
 * A missing component is fine (the caller will create it); a symlink anywhere on the way is not.
 */
export const symlinkOnPath = (root: string, rel: string): string | null => {
  let cur = root
  for (const seg of rel.split('/')) {
    cur = join(cur, seg)
    try {
      if (lstatSync(cur).isSymbolicLink()) return seg
    } catch {
      return null
    }
  }
  return null
}
