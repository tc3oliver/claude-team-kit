import { parseArgs } from 'node:util'

import { JsonParseError } from '../../core/fsx.ts'
import { ProfileError } from '../../core/schema.ts'
import { defaultDeps, syncInit, syncPublish, syncPull, syncResolve, syncStatus, type Outcome, type SyncDeps } from '../../sync/engine.ts'
import { SyncError } from '../../sync/git.ts'
import { EXIT, type Ctx } from '../context.ts'
import { emit } from '../report.ts'

const USAGE = `usage: ctk sync [pull]
       ctk sync init --remote <url|path> [--branch main]
       ctk sync status
       ctk sync publish [-m <message>]
       ctk sync resolve <pointer> ours|theirs
All subcommands honour --dry-run and --json. Sync never force-pushes and never publishes the device layer.`

/**
 * `argv` is everything after the word "sync". The dependency argument exists so tests can stub
 * `applyProfile`; the router calls `runSync(argv, ctx)`.
 */
export async function runSync(argv: string[], ctx: Ctx, deps: SyncDeps = defaultDeps): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        remote: { type: 'string' },
        branch: { type: 'string' },
        message: { type: 'string', short: 'm' },
        'dry-run': { type: 'boolean' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (e) {
    ctx.err(`error: ${(e as Error).message}\n${USAGE}`)
    return EXIT.error
  }
  const { values, positionals } = parsed
  if (values.help) {
    ctx.out(USAGE)
    return EXIT.ok
  }
  const c: Ctx = { ...ctx, dryRun: ctx.dryRun || values['dry-run'] === true, json: ctx.json || values.json === true }
  const [sub = 'pull', ...rest] = positionals

  try {
    let out: Outcome
    if (sub === 'init') out = await syncInit(c, { remote: values.remote, branch: values.branch })
    else if (sub === 'status') out = await syncStatus(c)
    else if (sub === 'pull') out = await syncPull(c, deps)
    else if (sub === 'publish') out = await syncPublish(c, deps, { message: values.message })
    else if (sub === 'resolve') out = await syncResolve(c, deps, rest[0], rest[1])
    else {
      ctx.err(`error: unknown sync subcommand "${sub}"\n${USAGE}`)
      return EXIT.error
    }
    return emit(c, { code: out.exit, data: { command: `sync ${sub}`, ...out.data }, lines: out.lines })
  } catch (e) {
    if (e instanceof SyncError || e instanceof ProfileError || e instanceof JsonParseError) {
      const code = e instanceof SyncError ? e.exit : EXIT.error
      return emit(c, { code, data: { command: `sync ${sub}`, error: e.message }, lines: [`error: ${e.message}`] })
    }
    throw e
  }
}
