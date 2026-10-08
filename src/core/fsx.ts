import { createHash, randomBytes } from 'node:crypto'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative } from 'node:path'

export const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex')

export const ensureDir = (dir: string): void => {
  mkdirSync(dir, { recursive: true })
}

/** Owner-only: settings can hold env values, and CTK state is nobody else's business. */
const PRIVATE_FILE = 0o600
const PRIVATE_DIR = 0o700

/**
 * Write via temp file + rename so a crash never leaves a half-written file.
 * An existing file keeps its permission bits (a user's chmod 600 survives); a new file is 0600.
 */
export const writeFileAtomic = (requested: string, data: string | Uint8Array, mode?: number): void => {
  // A symlinked file (e.g. settings.json kept in a dotfiles repo) is written through: the link stays a link.
  let path = requested
  try {
    path = realpathSync(requested)
  } catch {
    // does not exist yet
  }
  ensureDir(dirname(path))
  const tmp = `${path}.ctk-${randomBytes(4).toString('hex')}.tmp`
  const keep = mode ?? (existsSync(path) ? statSync(path).mode & 0o777 : PRIVATE_FILE)
  try {
    writeFileSync(tmp, data, { mode: keep })
    chmodSync(tmp, keep) // writeFileSync's mode is masked by the umask
    renameSync(tmp, path)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
}

export const readTextIfExists = (path: string): string | null => (existsSync(path) ? readFileSync(path, 'utf8') : null)

export class JsonParseError extends Error {
  readonly path: string
  constructor(path: string, cause: unknown) {
    super(`${path} is not valid JSON (${cause instanceof Error ? cause.message : String(cause)}); refusing to modify it`)
    this.path = path
  }
}

/** Parse a JSON file. Missing file -> null. Invalid JSON throws: a file CTK cannot read is never overwritten. */
export const readJsonIfExists = <T = unknown>(path: string): T | null => {
  const text = readTextIfExists(path)
  if (text === null) return null
  try {
    return JSON.parse(text) as T
  } catch (e) {
    throw new JsonParseError(path, e)
  }
}

export const toJsonText = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

export const writeJsonAtomic = (path: string, value: unknown): void => {
  writeFileAtomic(path, toJsonText(value))
}

/** Every regular file under dir, as POSIX-style relative paths, sorted. Symlinks are not followed. */
export const listFiles = (dir: string): string[] => {
  const out: string[] = []
  const walk = (d: string) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, ent.name)
      if (ent.isDirectory()) walk(full)
      else if (ent.isFile()) out.push(relative(dir, full).split('\\').join('/'))
    }
  }
  if (existsSync(dir) && statSync(dir).isDirectory()) walk(dir)
  return out.sort()
}

export type BackupEntry = { path: string; existed: boolean; backup: string | null; sha256: string | null }
export type BackupManifest = { id: string; op: string; createdAt: string; entries: BackupEntry[] }

/**
 * Copy each file (if present) into <backupsDir>/<id>/files/<n> and record a manifest.
 * Backups are never deleted by CTK.
 */
export const createBackup = (backupsDir: string, op: string, files: string[], now = new Date()): BackupManifest => {
  // The random suffix keeps two backups taken in the same millisecond from overwriting each other.
  const id = `${now.toISOString().replace(/[:.]/g, '-')}-${op}-${randomBytes(3).toString('hex')}`
  const root = join(backupsDir, id)
  mkdirSync(join(root, 'files'), { recursive: true, mode: PRIVATE_DIR })
  chmodSync(root, PRIVATE_DIR)
  chmodSync(join(root, 'files'), PRIVATE_DIR)
  const entries: BackupEntry[] = files.map((path, i) => {
    if (!existsSync(path)) return { path, existed: false, backup: null, sha256: null }
    const dest = join(root, 'files', String(i))
    cpSync(path, dest)
    chmodSync(dest, PRIVATE_FILE)
    return { path, existed: true, backup: dest, sha256: sha256(readFileSync(path)) }
  })
  const manifest: BackupManifest = { id, op, createdAt: now.toISOString(), entries }
  writeJsonAtomic(join(root, 'manifest.json'), manifest)
  return manifest
}

/** Restore a backup into a scratch directory and return the file contents' hashes: used to prove a backup is restorable. */
export const verifyBackup = (manifest: BackupManifest): { ok: boolean; problems: string[] } => {
  const problems: string[] = []
  for (const e of manifest.entries) {
    if (!e.existed) continue
    if (e.backup === null || !existsSync(e.backup)) problems.push(`${e.path}: backup copy missing`)
    else if (sha256(readFileSync(e.backup)) !== e.sha256) problems.push(`${e.path}: backup copy differs from the original`)
  }
  return { ok: problems.length === 0, problems }
}
