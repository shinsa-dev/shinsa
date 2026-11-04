import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { join } from 'node:path';
import { Duration, Effect } from 'effect';
import type { GitReadRequest } from '../../src/git/schema.ts';
import { Git } from '../../src/git/service.ts';
import { decodeText, splitRecords } from '../../src/git/text.ts';
import { runGit } from '../helpers/git.ts';
import { createGitRepo, writeFiles } from '../helpers/index.ts';

setDefaultTimeout(30_000);

function readGit(args: string[], cwd: string, options: GitReadRequest = {}) {
  return runGit(Git.use((git) => git.read(args, cwd, options)));
}

describe('Git.read', () => {
  test('reads the raw bytes of a command, untrimmed', async () => {
    const { path } = await createGitRepo({ remote: false, files: { ' spaced.txt': 'a' } });
    const read = await readGit(['ls-files', '-z'], path);
    expect(read).toMatchObject({ ok: true, code: 0, timedOut: false, truncated: false });
    expect(splitRecords(read.bytes)).toEqual([' spaced.txt', 'README.md']);
  });

  test('stops after a number of lines and says it cut the output', async () => {
    const { path } = await createGitRepo({ remote: false, files: { 'lines.txt': 'a\n'.repeat(5_000) } });
    const read = await readGit(['cat-file', 'blob', 'HEAD:lines.txt'], path, { maxLines: 3 });
    expect(read).toMatchObject({ ok: true, truncated: true });
    expect(decodeText(read.bytes).split('\n').length).toBeGreaterThan(3);
    const whole = await readGit(['cat-file', 'blob', 'HEAD:lines.txt'], path, { env: { GIT_PAGER: 'cat' } });
    expect(whole.truncated).toBe(false);
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
      timeout: Duration.millis(50),
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

  test('hands each chunk to its listener as it comes', async () => {
    const { path } = await createGitRepo({ remote: false, files: { 'lines.txt': 'one\ntwo\n' } });
    const chunks: Uint8Array[] = [];
    const read = await readGit(['cat-file', 'blob', 'HEAD:lines.txt'], path, {
      onData: (chunk) => Effect.sync(() => chunks.push(chunk)),
    });
    expect(read.ok).toBe(true);
    expect(decodeText(Buffer.concat(chunks))).toBe('one\ntwo\n');
  });

  test('a read whose caller goes away stops its process', async () => {
    const { path } = await createGitRepo({ remote: false });
    writeFiles(path, { 'slow.sh': 'sleep 5\n' });
    const caller = new AbortController();
    const started = Date.now();
    const pending = runGit(
      Git.use((git) => git.read(['-c', `alias.slow=!sh ${join(path, 'slow.sh')}`, 'slow'], path)),
      { signal: caller.signal }
    );
    setTimeout(() => caller.abort(), 50);
    await expect(pending).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(4000);
  });
});
