import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { sha256, writeFileAtomic } from '../core/fsx.ts'
import type { FileEntry, Ledger } from '../core/ledger.ts'
import { pluginSourceDir, toPosix } from '../core/paths.ts'
import { ensureBackup, type Txn } from './txn.ts'

const shellSingleQuote = (p: string): string => `'${p.replace(/'/g, `'\\''`)}'`

/**
 * The command settings.json runs. POSIX shells: each path single-quoted, ' escaped as '\''.
 * Windows runs it through Git Bash, which eats backslashes: forward slashes in double quotes, and
 * paths with characters that stay special inside double quotes (" $ ` %) are refused.
 */
export const statuslineCommand = (nodePath: string, scriptPath: string, platform: string = process.platform): string => {
  if (platform !== 'win32') return `${shellSingleQuote(nodePath)} ${shellSingleQuote(scriptPath)}`
  for (const p of [nodePath, scriptPath]) {
    if (/["$`%]/.test(p)) throw new Error(`cannot build a safe status line command for ${p}: the path contains one of " $ \` %`)
  }
  return `"${toPosix(nodePath)}" "${toPosix(scriptPath)}"`
}

/** The value written to settings.json `statusLine`. */
export const statuslineSetting = (scriptPath: string, nodePath = process.execPath, platform: string = process.platform) => ({
  type: 'command',
  command: statuslineCommand(nodePath, scriptPath, platform),
})

/** Does this settings `statusLine` value run CTK's script (from any node path, quoted either way)? */
export const isCtkStatusLine = (v: unknown): boolean =>
  typeof v === 'object' && v !== null && /\/ctk\/bin\/ctk-statusline\.mjs['"]?\s*$/.test(toPosix(String((v as { command?: unknown }).command ?? '')))

export const packagedStatusline = (root: string): string => join(pluginSourceDir(root), 'statusline', 'ctk-statusline.mjs')

/** 'edited' = the script on disk is neither the packaged one nor what CTK last wrote: the user's, never overwritten. */
export type StatuslineStep = 'copy' | 'unchanged' | 'unavailable' | 'edited'

/** The hash CTK recorded when it last wrote the script, or null. */
export const recordedStatuslineSha = (ledger: Ledger, dest: string): string | null =>
  ledger.entries.find((e): e is FileEntry => e.kind === 'file' && e.path === dest)?.sha256 ?? null

/** What copying the packaged script would do, without doing it. */
export const planStatuslineCopy = (root: string, dest: string, ledger: Ledger): StatuslineStep => {
  const src = packagedStatusline(root)
  if (!existsSync(src)) return 'unavailable'
  if (!existsSync(dest)) return 'copy'
  const have = sha256(readFileSync(dest))
  if (have === sha256(readFileSync(src))) return 'unchanged'
  return have === recordedStatuslineSha(ledger, dest) ? 'copy' : 'edited'
}

/** Copy the packaged script to <config>/ctk/bin, recording a file change. Returns what happened. */
export const copyStatusline = (t: Txn, root: string): StatuslineStep => {
  const dest = t.ctx.paths.statusline
  const step = planStatuslineCopy(root, dest, t.ledger)
  if (step !== 'copy') return step
  const content = readFileSync(packagedStatusline(root))
  const before = existsSync(dest) ? sha256(readFileSync(dest)) : null
  ensureBackup(t, [dest])
  writeFileAtomic(dest, content)
  const prev = t.ledger.entries.find((e): e is FileEntry => e.kind === 'file' && e.path === dest) ?? null
  const after: FileEntry = { kind: 'file', path: dest, sha256: sha256(content), priorSha256: before }
  t.ledger.entries = [...t.ledger.entries.filter(e => e !== prev), after]
  t.changes.push({ kind: 'file', path: dest, before: prev, after })
  return 'copy'
}
