import type { Ctx } from './context.ts'

/** What a command produced: an exit code, a JSON-able payload (--json) and the human lines. */
export type Report = { code: number; data: Record<string, unknown>; lines: string[] }

/** Print a report the way the user asked (one JSON document, or text) and return its exit code.
 *  Takes only the fields it uses so early failures (before a full Ctx exists) can reuse it. */
export const emit = (ctx: Pick<Ctx, 'json' | 'out'>, r: Report): number => {
  if (ctx.json) ctx.out(JSON.stringify({ exitCode: r.code, ...r.data }, null, 2))
  else for (const l of r.lines) ctx.out(l)
  return r.code
}

export const failure = (message: string, code = 1): Report => ({ code, data: { error: message }, lines: [`error: ${message}`] })
