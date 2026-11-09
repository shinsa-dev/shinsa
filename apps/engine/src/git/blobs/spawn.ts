import { READ_ENV } from '../schema.ts';
import type { BatchChild } from './schema.ts';

export function spawnCatFile(repoPath: string): BatchChild {
  return Bun.spawn(['git', 'cat-file', '--batch-command'], {
    cwd: repoPath,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'ignore',
    detached: true,
    env: { ...Bun.env, ...READ_ENV },
  });
}
