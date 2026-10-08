import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { sha256, writeFileAtomic } from '../core/fsx.ts'
import type { FileEntry } from '../core/ledger.ts'
import { pluginSourceDir, toPosix } from '../core/paths.ts'
import { ensureBackup, type Txn } from './txn.ts'

/** Settings commands run through Git Bash on Windows: forward slashes, both paths quoted. */
export const statuslineCommand = (nodePath: string, scriptPath: string): string =>
  `"${toPosix(nodePath)}" "${toPosix(scriptPath)}"`

/** The value written to settings.json `statusLine`. */
export const statuslineSetting = (scriptPath: string, nodePath = process.execPath) => ({
  type: 'command',
  command: statuslineCommand(nodePath, scriptPath),
})

/** Does this settings `statusLine` value run CTK's script (from any node path)? */
export const isCtkStatusLine = (v: unknown): boolean =>
  typeof v === 'object' && v !== null && /\/ctk\/bin\/ctk-statusline\.mjs"?\s*$/.test(toPosix(String((v as { command?: unknown }).command ?? '')))

export const packagedStatusline = (root: string): string => join(pluginSourceDir(root), 'statusline', 'ctk-statusline.mjs')

export type StatuslineStep = 'copy' | 'unchanged' | 'unavailable'

/** What copying the packaged script would do, without doing it. */
export const planStatuslineCopy = (root: string, dest: string): StatuslineStep => {
  const src = packagedStatusline(root)
  if (!existsSync(src)) return 'unavailable'
  return existsSync(dest) && sha256(readFileSync(dest)) === sha256(readFileSync(src)) ? 'unchanged' : 'copy'
}

/** Copy the packaged script to <config>/ctk/bin, recording a file change. Returns what happened. */
export const copyStatusline = (t: Txn, root: string): StatuslineStep => {
  const dest = t.ctx.paths.statusline
  const step = planStatuslineCopy(root, dest)
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
