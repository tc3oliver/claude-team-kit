import { lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { EXIT, type Ctx } from '../context.ts'
import { failure, type Report } from '../report.ts'

// Claude Code only lets a user- or project-scoped "Explore" replace the built-in
// agent. A plugin-scoped ctk:explorer does not replace it.
export const EXPLORE_AGENT = `---
name: Explore
description: Fast, read-only codebase search; return concise file:line findings.
model: haiku
tools: Read, Grep, Glob
omitClaudeMd: true
---

Find only the code relevant to the question. Grep and Glob first, then Read
specific ranges. Return file:line references with short explanations, not file
dumps. Do not edit files or make design decisions.
`

type State = 'absent' | 'managed' | 'conflict'

const inspect = (path: string): State => {
  try {
    const info = lstatSync(path)
    if (!info.isFile() || info.isSymbolicLink()) return 'conflict'
    return readFileSync(path, 'utf8') === EXPLORE_AGENT ? 'managed' : 'conflict'
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 'absent'
    throw e
  }
}

const isLink = (path: string): boolean => {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw e
  }
}

/**
 * Opt-in override for Claude Code's built-in Explore. Never overwrite or delete
 * an existing non-CTK agent, and never follow a symlink into another directory.
 * Not part of CTK's install/uninstall transaction or profile sync.
 */
export const runExplore = (ctx: Ctx, args: string[], opts: { user: boolean }): Report => {
  if (args.length !== 1 || !['enable', 'disable', 'status'].includes(args[0] ?? '')) {
    return failure('usage: ctk explore enable|disable|status [--user]')
  }

  const action = args[0] as 'enable' | 'disable' | 'status'
  const scope = opts.user ? 'user' : 'project'
  const root = opts.user ? ctx.configDir : join(ctx.cwd, '.claude')
  const dir = join(root, 'agents')
  const path = join(dir, 'Explore.md')

  // An agents directory linked into a dotfiles repository is a legitimate
  // personal choice, but the safe default is to leave it to the user.
  if (isLink(root) || isLink(dir)) {
    return failure(`refusing to use a symlinked agent directory: ${path}`, EXIT.attention)
  }

  const state = inspect(path)
  const report = (code: number, status: string, message: string): Report => ({
    code,
    data: { command: `explore ${action}`, scope, path, state: status, dryRun: ctx.dryRun },
    lines: [message],
  })

  if (state === 'conflict') {
    return report(EXIT.attention, state, `conflict: ${path} already contains a different Explore agent; left unchanged`)
  }
  if (action === 'status') {
    return report(EXIT.ok, state, `Explore override (${scope}): ${state} at ${path}`)
  }
  if (action === 'enable') {
    if (state === 'managed') return report(EXIT.ok, state, `Explore override already enabled: ${path}`)
    if (ctx.dryRun) return report(EXIT.ok, 'planned', `would create ${path} (Haiku, read-only)`)
    mkdirSync(dirname(path), { recursive: true })
    // Recheck after mkdir: no replacement if another process created the file.
    if (isLink(root) || isLink(dir)) return failure(`refusing to use a symlinked agent directory: ${path}`, EXIT.attention)
    try {
      writeFileSync(path, EXPLORE_AGENT, { flag: 'wx', mode: 0o600 })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
        return report(EXIT.attention, 'conflict', `conflict: ${path} appeared during enable; left unchanged`)
      }
      throw e
    }
    return report(EXIT.ok, 'managed', `enabled Haiku Explore at ${path}; restart Claude Code to load it`)
  }
  if (state === 'absent') return report(EXIT.ok, state, `Explore override already disabled: ${path}`)
  if (ctx.dryRun) return report(EXIT.ok, 'planned', `would remove CTK's Explore override at ${path}`)
  // The file is removed only when its entire contents still match CTK's.
  if (inspect(path) !== 'managed') return report(EXIT.attention, 'conflict', `conflict: ${path} changed during disable; left unchanged`)
  unlinkSync(path)
  return report(EXIT.ok, 'absent', `disabled Haiku Explore at ${path}; restart Claude Code to restore built-in behavior`)
}
