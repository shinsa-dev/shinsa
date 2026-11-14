import { describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGitRepo, createTempDir } from '../helpers/index.ts';
import { createTask } from '../helpers/state.ts';
import { openStrategy } from './harness.ts';

function writer(path: string, text: string) {
  return () => {
    writeFileSync(path, text);
    return true;
  };
}

describe('your edits from the Code tab', () => {
  test('a worktree takes the edit as it is', async () => {
    const { repo, path } = await createGitRepo({ files: { 'a.txt': 'a\n' } });
    await openStrategy(createTempDir()).writeEdit(
      repo,
      createTask({ worktreePath: path }),
      'a.txt',
      writer(join(path, 'a.txt'), 'b\n')
    );
    expect(readFileSync(join(path, 'a.txt'), 'utf8')).toBe('b\n');
  });
});
