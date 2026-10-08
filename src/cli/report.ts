import type { Ctx } from './context.ts'

/** What a command produced: an exit code, a JSON-able payload (--json) and the human lines. */
export type Report = { code: number; data: Record<string, unknown>; lines: string[] }

/** Print a report the way the user asked (one JSON document, or text) and return its exit code. */
export const emit = (ctx: Ctx, r: Report): number => {
  if (ctx.json) ctx.out(JSON.stringify({ exitCode: r.code, ...r.data }, null, 2))
  else for (const l of r.lines) ctx.out(l)
  return r.code
}

export const failure = (message: string, code = 1): Report => ({ code, data: { error: message }, lines: [`error: ${message}`] })
