// Thin git wrapper: argv arrays only, never a shell, never a credential prompt.
// Credentials are git's own business (helpers, ssh agent); CTK handles none.

import { execFile } from 'node:child_process'

export type GitResult = { code: number; stdout: string; stderr: string }

export class SyncError extends Error {
  readonly exit: number
  constructor(message: string, exit = 1) {
    super(message)
    this.exit = exit
  }
}

/** `ext::` and friends run commands; only plain transports are allowed. */
const gitEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
  ...env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_ALLOW_PROTOCOL: env.GIT_ALLOW_PROTOCOL ?? 'file:git:http:https:ssh',
  LC_ALL: 'C',
})

export const git = (cwd: string, args: string[], env: NodeJS.ProcessEnv): Promise<GitResult> =>
  new Promise(resolve => {
    execFile('git', args, { cwd, env: gitEnv(env), maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (!err) return resolve({ code: 0, stdout, stderr })
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return resolve({ code: 127, stdout: '', stderr: 'git was not found on PATH' })
      resolve({ code: typeof code === 'number' ? code : 1, stdout, stderr })
    })
  })

/** Run git and throw SyncError (exit 1) with git's message on failure. */
export const gitOk = async (cwd: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> => {
  const r = await git(cwd, args, env)
  if (r.code !== 0) {
    const msg = (r.stderr || r.stdout).trim()
    const hint = /tell me who you are|empty ident/i.test(msg) ? ' (set git user.name and user.email)' : ''
    throw new SyncError(`git ${args[0]} failed: ${msg}${hint}`)
  }
  return r.stdout
}
