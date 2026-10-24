import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { decodeText, readGit, splitRecords } from '../../src/git/read.ts';
import { createGitRepo, writeFiles } from '../helpers/index.ts';

describe('readGit', () => {
  test('reads the raw bytes of a command, untrimmed', async () => {
    const { path } = await createGitRepo({ remote: false, files: { ' spaced.txt': 'a' } });
    const read = await readGit(['ls-files', '-z'], path);
    expect(read).toMatchObject({ ok: true, code: 0, timedOut: false, truncated: false });
    expect(splitRecords(read.bytes)).toEqual([' spaced.txt', 'README.md']);
  });

  test('stops at the byte limit and says it cut the output', async () => {
    const { path } = await createGitRepo({ remote: false, files: { 'big.txt': 'x'.repeat(200_000) } });
    const read = await readGit(['cat-file', 'blob', 'HEAD:big.txt'], path, { maxBytes: 10 });
    expect(read).toMatchObject({ ok: true, truncated: true });
    expect(decodeText(read.bytes)).toBe('x'.repeat(10));
  });

  test('a read that runs too long is stopped and marked', async () => {
    const { path } = await createGitRepo({ remote: false });
    writeFiles(path, { 'slow.sh': 'sleep 5\n' });
    const read = await readGit(['-c', `alias.slow=!sh ${join(path, 'slow.sh')}`, 'slow'], path, {
      timeoutMs: 50,
    });
    expect(read).toMatchObject({ ok: false, timedOut: true });
  });

  test('a cancelled read never starts, and one cancelled midway stops', async () => {
    const { path } = await createGitRepo({ remote: false });
    const aborted = new AbortController();
    aborted.abort();
    expect(await readGit(['status'], path, { signal: aborted.signal })).toMatchObject({
      ok: false,
      code: 130,
    });
    writeFiles(path, { 'slow.sh': 'sleep 5\n' });
    const midway = new AbortController();
    const pending = readGit(['-c', `alias.slow=!sh ${join(path, 'slow.sh')}`, 'slow'], path, {
      signal: midway.signal,
    });
    midway.abort();
    expect((await pending).ok).toBe(false);
  });

  test('a folder that is gone is a failed read, not a throw', async () => {
    const read = await readGit(['status'], '/nonexistent/shinsa/folder');
    expect(read).toMatchObject({ ok: false, code: 127 });
    expect(read.stderr).not.toBe('');
  });
});
