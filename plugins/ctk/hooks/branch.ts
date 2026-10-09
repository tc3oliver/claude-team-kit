// The git branch for the band, read from .git/HEAD only: no `git` process, no network. Pure apart
// from the `read` it is handed ($.fs.read in the mod); a missing file is "not a repository".

type Read = (path: string) => Promise<string>

const MAX_UP = 40
const ABSOLUTE = /^(?:[\\/]|[A-Za-z]:)/

const parentOf = (dir: string): string | null => {
  const up = dir.replace(/[\\/][^\\/]*[\\/]*$/, '')
  return up === dir || up === '' ? null : up
}

/** The branch name, a 7-character commit id when HEAD is detached, or null when it cannot be told. */
export const parseHead = (head: string): string | null => {
  const text = head.trim()
  const ref = /^ref:\s*(.+)$/.exec(text)
  if (ref) return (ref[1] as string).replace(/^refs\/heads\//, '').trim() || null
  return /^[0-9a-f]{7,64}$/.test(text) ? text.slice(0, 7) : null
}

const tryRead = async (read: Read, path: string): Promise<string | null> => {
  try {
    return await read(path)
  } catch {
    return null
  }
}

/** Walks up from `cwd` to the first `.git` (a directory, or the file a linked worktree has). */
export const readBranch = async (read: Read, cwd: string): Promise<string | null> => {
  let dir: string | null = cwd.replace(/[\\/]+$/, '')
  for (let i = 0; dir !== null && i < MAX_UP; i++, dir = parentOf(dir)) {
    const head = await tryRead(read, `${dir}/.git/HEAD`)
    if (head !== null) return parseHead(head)
    const link = await tryRead(read, `${dir}/.git`)
    const gitdir = link === null ? null : /^gitdir:\s*(.+)$/m.exec(link)?.[1]?.trim()
    if (gitdir) {
      const linked = await tryRead(read, `${ABSOLUTE.test(gitdir) ? gitdir : `${dir}/${gitdir}`}/HEAD`)
      return linked === null ? null : parseHead(linked)
    }
  }
  return null
}
