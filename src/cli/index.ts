import { parseArgs } from 'node:util'

import { ClaudeCommandError } from '../core/claude.ts'
import { JsonParseError } from '../core/fsx.ts'
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

const GLOBAL_HELP = `Global options:
  --config-dir <dir>   Claude config dir (default: $CLAUDE_CONFIG_DIR, then ~/.claude)
  --profile <name>     Profile name in the profile repo (default: default)
  --device <name>      Device name for device-local overrides (default: hostname)
  --dry-run            Print the plan; write nothing
  --json               Print one JSON document
  --yes                Accept prompts
  -h, --help           Show help (ctk <command> --help for one command)
  -v, --version        Print the version

Exit codes: 0 ok, 1 error, 2 needs attention (conflicts, warnings).`

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

${GLOBAL_HELP}
`

/** Per-command help. `sync` is not listed: it prints its own usage (ctk sync --help). */
const COMMAND_HELP: Record<string, string> = {
  install: `Usage: ctk install [--no-statusline] [--no-enable-teams]

Register the marketplace, install the plugin, copy the status line script and write the managed
settings.json keys, all in one backed-up transaction. Safe to run again: a second run changes nothing.

Options:
  --no-statusline      Do not manage the status line (remembered in the device layer)
  --no-enable-teams    Do not set the agent-teams flag (remembered in the device layer)`,
  doctor: `Usage: ctk doctor

Check Node, Claude Code, the plugin, the marketplace, settings.json, the ledger and the backups.
Each check prints pass, warn or fail with a one-line fix. Exit 0 all pass, 2 warnings, 1 failures.`,
  update: `Usage: ctk update

Refresh the marketplace and plugin when the packaged version changed, re-copy the status line
script if the packaged one changed, and re-apply the profile. A plugin you disabled stays disabled.`,
  rollback: `Usage: ctk rollback [--to <id>]

Undo the latest transaction, restoring the previous values. A value you changed since is kept and
reported. Backups are never deleted.

Options:
  --to <id>            Undo that transaction and every later one`,
  uninstall: `Usage: ctk uninstall

Reverse what ctk added where it is still as ctk left it, uninstall the plugin, and delete
<config>/ctk except backups/, devices/ and sync/. Backups are never deleted.`,
  stats: `Usage: ctk stats

Per-session and total figures from <config>/ctk/stats: spawns, tasks, models (counted by ctk) and
cost, context, limits (measured by Claude Code). No per-worker cost.`,
  config: `Usage: ctk config get|set|list|unset <dotted.path> [value] [--device-layer] [--no-apply]

Read or edit the user layer of the profile (the device layer with --device-layer), then re-apply it
to settings.json unless --no-apply is given. Values are JSON (3, true) or plain strings.

Options:
  --device-layer       Edit the device layer instead of the user layer
  --no-apply           Only write the layer; leave settings.json alone`,
}

const commandHelp = (command: string): string => `${COMMAND_HELP[command]}\n\n${GLOBAL_HELP}\n`

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
    // `ctk help [command]` is the same as `ctk [command] --help`; sync prints its own usage.
    const target = first.command === 'help' ? first.rest[0] : first.command
    if (first.command === 'help' || (help && first.command !== 'sync') || first.command === undefined) {
      io.out(target !== undefined && target in COMMAND_HELP ? commandHelp(target) : HELP)
      return help || first.command === 'help' ? EXIT.ok : EXIT.error
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
    if (first.command === 'sync') return await runSync(help ? [...first.rest, '--help'] : first.rest, ctx)
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
          const head = {
            nothing: 'nothing to uninstall: ctk owns nothing here',
            planned: 'would uninstall ctk',
            removed: `uninstalled ctk (backups kept in ${ctx.paths.backupsDir})`,
            incomplete: 'uninstall incomplete',
          }[r.status]
          const lines = [head, ...undoLines(r.report)]
          return { code: r.code, data: { ...r.report, removedDir: r.removedDir, status: r.status }, lines }
        }
      }
    })()
    return emit(ctx, report)
  } catch (e) {
    const message = explain(e)
    if (wantsJson) io.out(JSON.stringify({ exitCode: EXIT.error, error: message }, null, 2))
    else io.err(`error: ${message}`)
    return EXIT.error
  }
}

/** Every failure a first-time user can hit becomes: the cause, then what to do. Never a stack trace. */
const explain = (e: unknown): string => {
  const message = e instanceof Error ? e.message : String(e)
  if (e instanceof JsonParseError) return `${message}\nctk will not modify ${e.path}; fix it by hand (or move it aside) and run the command again.`
  if (e instanceof ClaudeCommandError) return `${message}\nNothing else was changed and anything ctk had already added is recorded in its ledger, so running the command again is safe.`
  const code = (e as NodeJS.ErrnoException | undefined)?.code
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return `cannot write ${(e as NodeJS.ErrnoException).path ?? 'a file'} (${code}); check its permissions or pick another config dir with --config-dir.`
  return message
}

const undoLines = (r: { reverted: string[]; removed: string[]; conflicts: { key: string; reason: string }[]; notes: string[] }): string[] => [
  ...r.reverted.map(k => (r.removed.includes(k) ? `  removed ${k}` : `  restored ${k}`)),
  ...r.conflicts.map(c => `  conflict: ${c.key}: ${c.reason}`),
  ...r.notes.map(n => `  note: ${n}`),
]
