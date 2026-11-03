import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGit } from './run.ts';

const roots: string[] = [];

function createRepo() {
  const root = mkdtempSync(join(tmpdir(), 'kit-git-'));
  roots.push(root);
  runGit(['init', '-q', '-b', 'main'], root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('runGit', () => {
  test('commits at a fixed time with the author it is given, ignoring the global config', () => {
    const root = createRepo();
    const author = { GIT_AUTHOR_NAME: 'Seed', GIT_AUTHOR_EMAIL: 'seed@example.com' };
    const committer = { GIT_COMMITTER_NAME: 'Seed', GIT_COMMITTER_EMAIL: 'seed@example.com' };
    runGit(['commit', '-q', '--allow-empty', '-m', 'first'], root, {
      at: Date.UTC(2026, 0, 12),
      env: { ...author, ...committer },
    });
    expect(runGit(['log', '-1', '--format=%an %at'], root)).toBe(`Seed ${Date.UTC(2026, 0, 12) / 1000}`);
  });

  test('writes standard input from text or bytes, and into another index', () => {
    const root = createRepo();
    const fromText = runGit(['hash-object', '-w', '--stdin'], root, { input: 'hello\n' });
    const fromBytes = runGit(['hash-object', '-w', '--stdin'], root, {
      input: new TextEncoder().encode('hello\n'),
    });
    expect(fromBytes).toBe(fromText);
    const index = join(root, 'other-index');
    runGit(['update-index', '--add', '--cacheinfo', `100644,${fromText},hello.txt`], root, { index });
    expect(runGit(['ls-files', '--stage'], root, { index })).toContain('hello.txt');
    expect(runGit(['ls-files'], root)).toBe('');
  });

  test('throws with the command and git’s own message when it fails', () => {
    const root = createRepo();
    expect(() => runGit(['rev-parse', '--verify', 'missing'], root)).toThrow(
      /^git rev-parse --verify missing: /
    );
  });
});
