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

/** Variables that would redirect git away from the clone CTK passes as cwd. */
const REDIRECTS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR', 'GIT_NAMESPACE', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']

/** `ext::` and friends run commands; only plain transports are allowed. */
const gitEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const out: NodeJS.ProcessEnv = { ...env }
  for (const k of REDIRECTS) delete out[k]
  return {
    ...out,
    GIT_TERMINAL_PROMPT: '0',
    GIT_LITERAL_PATHSPECS: '1',
    GIT_ALLOW_PROTOCOL: env.GIT_ALLOW_PROTOCOL ?? 'file:git:http:https:ssh',
    LC_ALL: 'C',
  }
}

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

/** Hide any `userinfo@` in a URL inside printed text, whatever the scheme or encoding. */
export const redactUrls = (text: string): string => text.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, '$1***@')
