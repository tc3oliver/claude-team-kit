import type { CtkPaths } from '../core/paths.ts'

/** Everything a command needs. Tests build one with captured out/err and a temp configDir. */
export type Ctx = {
  configDir: string
  paths: CtkPaths
  device: string
  /** Profile name inside the profile repo (profiles/<name>.json). Default "default". */
  profile: string
  dryRun: boolean
  json: boolean
  yes: boolean
  env: NodeJS.ProcessEnv
  cwd: string
  out: (line: string) => void
  err: (line: string) => void
  /** Absolute path of the claude binary to drive; undefined = resolve `claude` from PATH. */
  claudeBin?: string
}

/** Exit codes shared by every command. */
export const EXIT = { ok: 0, error: 1, attention: 2 } as const
