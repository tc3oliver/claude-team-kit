import { describe, expect, test } from 'claude-code/testing'

import { parseHead, readBranch } from '../hooks/branch.ts'

const files = (map: Record<string, string>) => async (path: string) => {
  const hit = map[path]
  if (hit === undefined) throw new Error(`ENOENT ${path}`)
  return hit
}

describe('git branch from .git/HEAD', () => {
  test('a branch, a nested branch name, a detached commit and junk', () => {
    expect(parseHead('ref: refs/heads/main\n')).toBe('main')
    expect(parseHead('ref: refs/heads/feature/band-branch\n')).toBe('feature/band-branch')
    expect(parseHead('0afb91cafc5f438c0fc5d3b0f57f8302ffe0fc70\n')).toBe('0afb91c')
    expect(parseHead('not a head')).toBeNull()
  })

  test('walks up from a subdirectory to the repository', async () => {
    const read = files({ '/repo/.git/HEAD': 'ref: refs/heads/dev\n' })
    expect(await readBranch(read, '/repo/plugins/ctk')).toBe('dev')
  })

  test('a linked worktree follows its gitdir file, relative or absolute', async () => {
    const rel = files({ '/wt/.git': 'gitdir: ../main/.git/worktrees/wt\n', '/wt/../main/.git/worktrees/wt/HEAD': 'ref: refs/heads/topic\n' })
    expect(await readBranch(rel, '/wt/src')).toBe('topic')
    const abs = files({ '/wt/.git': 'gitdir: /main/.git/worktrees/wt\n', '/main/.git/worktrees/wt/HEAD': 'ref: refs/heads/topic\n' })
    expect(await readBranch(abs, '/wt')).toBe('topic')
  })

  test('outside a repository, and with Windows paths', async () => {
    expect(await readBranch(files({}), '/tmp/nowhere')).toBeNull()
    const win = files({ 'C:\\work\\repo/.git/HEAD': 'ref: refs/heads/main\n' })
    expect(await readBranch(win, 'C:\\work\\repo\\src\\')).toBe('main')
  })
})
