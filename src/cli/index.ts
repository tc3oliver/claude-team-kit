import { parseArgs } from 'node:util'

import { ctkVersion } from '../core/ledger.ts'
import { isValidProfileName, resolveConfigDir, resolveDevice, ctkPaths } from '../core/paths.ts'
import { runInstall } from '../install/install.ts'
import { rollback, uninstall } from '../install/undo.ts'
import { runUpdate } from '../install/update.ts'
import { runConfig } from './commands/config.ts'
import { runDoctor } from './commands/doctor.ts'
import { runStats } from './commands/stats.ts'
import { EXIT, type Ctx } from './context.ts'
import { emit, failure, type Report } from './report.ts'

const HELP = `ctk - Claude Team Kit

Usage: ctk <command> [options]

Commands:
  install      Install the plugin, status line and settings (--no-statusline, --no-enable-teams)
  doctor       Check the installation (exit 0 ok, 2 warnings, 1 failures)
  sync         Sync the profile through a git repo (init|status|pull|publish|resolve)
  update       Refresh the plugin, re-copy the status line, re-apply the profile
  rollback     Undo the latest transaction (--to <id>: that one and every later one)
  uninstall    Remove what ctk added; keep backups
  stats        Per-session and total team figures
  config       get|set|list|unset <dotted.path> [value] (--device-layer, --no-apply)

Global options:
  --config-dir <dir>   Claude config dir (default: $CLAUDE_CONFIG_DIR, then ~/.claude)
  --profile <name>     Profile name in the profile repo (default: default)
  --device <name>      Device name for device-local overrides (default: hostname)
  --dry-run            Print the plan; write nothing
  --json               Print one JSON document
  --yes                Accept prompts
  -h, --help           Show this help
  -v, --version        Print the version

Exit codes: 0 ok, 1 error, 2 needs attention (conflicts, warnings).
`

const GLOBAL = {
  'config-dir': { type: 'string' },
  profile: { type: 'string' },
  device: { type: 'string' },
  'dry-run': { type: 'boolean' },
  json: { type: 'boolean' },
  yes: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const

const OPTIONS = {
  ...GLOBAL,
  'no-statusline': { type: 'boolean' },
  'no-enable-teams': { type: 'boolean' },
  to: { type: 'string' },
  'device-layer': { type: 'boolean' },
  'no-apply': { type: 'boolean' },
} as const

export type Io = { out: (line: string) => void; err: (line: string) => void; env: NodeJS.ProcessEnv; cwd: string; claudeBin?: string }

const processIo = (): Io => ({ out: l => console.log(l), err: l => console.error(l), env: process.env, cwd: process.cwd() })

/** The first positional is the command; for `sync` everything else (minus global options) is handed on untouched. */
const splitSync = (args: string[]): { command: string | undefined; rest: string[] } => {
  const { tokens } = parseArgs({ args, options: GLOBAL, strict: false, allowPositionals: true, tokens: true })
  const drop = new Set<number>()
  let command: string | undefined
  for (const t of tokens) {
    if (t.kind === 'positional' && command === undefined) {
      command = t.value
      drop.add(t.index)
    } else if (t.kind === 'option' && t.name in GLOBAL) {
      drop.add(t.index)
      if (GLOBAL[t.name as keyof typeof GLOBAL].type === 'string' && t.inlineValue === false) drop.add(t.index + 1)
    }
  }
  return { command, rest: args.filter((_, i) => !drop.has(i)) }
}

const runSync = async (argv: string[], ctx: Ctx): Promise<number> => {
  // `.ts` when running from source (tests), `.js` when compiled; the specifier is computed so the build does not need sync.ts to exist.
  const ext = import.meta.url.endsWith('.ts') ? '.ts' : '.js'
  let mod: { runSync: (argv: string[], ctx: Ctx) => Promise<number> }
  try {
    mod = await import(`./commands/sync${ext}`)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') return emit(ctx, failure('sync is not available in this build'))
    throw e
  }
  return mod.runSync(argv, ctx)
}

export async function main(argv: string[], io: Io = processIo()): Promise<number> {
  const wantsJson = argv.includes('--json')
  try {
    const first = splitSync(argv)
    const known = ['install', 'doctor', 'sync', 'update', 'rollback', 'uninstall', 'stats', 'config']
    const help = argv.includes('--help') || argv.includes('-h')
    if (argv.includes('--version') || argv.includes('-v')) {
      io.out(ctkVersion())
      return EXIT.ok
    }
    if (help || first.command === undefined) {
      io.out(HELP)
      return help ? EXIT.ok : EXIT.error
    }
    if (!known.includes(first.command)) {
      io.err(`unknown command "${first.command}"\n`)
      io.err(HELP)
      return EXIT.error
    }
    const { values, positionals } = first.command === 'sync' ? { values: parseArgs({ args: argv, options: GLOBAL, strict: false, allowPositionals: true }).values, positionals: [] } : parseArgs({ args: argv, options: OPTIONS, strict: true, allowPositionals: true })
    const configDir = resolveConfigDir(values['config-dir'] as string | undefined, io.env)
    const profile = (values.profile as string | undefined) ?? 'default'
    if (!isValidProfileName(profile)) throw new Error(`invalid profile name "${profile}" (lowercase letters, digits, - and _)`)
    const ctx: Ctx = {
      configDir,
      paths: ctkPaths(configDir),
      device: resolveDevice(values.device as string | undefined),
      profile,
      dryRun: values['dry-run'] === true,
      json: values.json === true,
      yes: values.yes === true,
      env: io.env,
      cwd: io.cwd,
      out: io.out,
      err: io.err,
      ...(io.claudeBin ? { claudeBin: io.claudeBin } : {}),
    }
    const v = values as Record<string, string | boolean | undefined>
    if (first.command === 'sync') return await runSync(first.rest, ctx)
    const report: Report = await (async () => {
      switch (first.command) {
        case 'install':
          return runInstall(ctx, { statusline: v['no-statusline'] !== true, enableTeams: v['no-enable-teams'] !== true })
        case 'update':
          return runUpdate(ctx)
        case 'doctor':
          return runDoctor(ctx)
        case 'stats':
          return runStats(ctx)
        case 'config':
          return runConfig(ctx, positionals.slice(1), { deviceLayer: v['device-layer'] === true, noApply: v['no-apply'] === true })
        case 'rollback': {
          const r = await rollback(ctx, v.to as string | undefined)
          if (r.error) return failure(r.error)
          const lines = r.undone.length === 0 ? r.report.notes : [`${ctx.dryRun ? 'would roll back' : 'rolled back'} ${r.undone.join(', ')}`, ...undoLines(r.report)]
          return { code: r.code, data: { undone: r.undone, ...r.report }, lines }
        }
        default: {
          const r = await uninstall(ctx)
          const head = ctx.dryRun ? 'would uninstall ctk' : r.removedDir ? `uninstalled ctk (backups kept in ${ctx.paths.backupsDir})` : 'uninstall incomplete'
          const lines = [head, ...undoLines(r.report)]
          return { code: r.code, data: { ...r.report, removedDir: r.removedDir }, lines }
        }
      }
    })()
    return emit(ctx, report)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (wantsJson) io.out(JSON.stringify({ exitCode: EXIT.error, error: message }, null, 2))
    else io.err(`error: ${message}`)
    return EXIT.error
  }
}

const undoLines = (r: { reverted: string[]; conflicts: { key: string; reason: string }[]; notes: string[] }): string[] => [
  ...r.reverted.map(k => `  restored ${k}`),
  ...r.conflicts.map(c => `  conflict: ${c.key}: ${c.reason}`),
  ...r.notes.map(n => `  note: ${n}`),
]
