import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { ShellLayer } from '../../../apps/engine/src/shell/layers.ts';
import type { Shell } from '../../../apps/engine/src/shell/service.ts';
import { runGit } from './run.ts';

const roots: string[] = [];

function runInShell<A, E>(effect: Effect.Effect<A, E, Shell>) {
  return Effect.runPromise(effect.pipe(Effect.provide(ShellLayer)));
}

async function createRepo() {
  const root = mkdtempSync(join(tmpdir(), 'kit-git-'));
  roots.push(root);
  await runInShell(runGit(['init', '-q', '-b', 'main'], root));
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('runGit', () => {
  test('commits at a fixed time with the author it is given, ignoring the global config', async () => {
    const root = await createRepo();
    const author = { GIT_AUTHOR_NAME: 'Seed', GIT_AUTHOR_EMAIL: 'seed@example.com' };
    const committer = { GIT_COMMITTER_NAME: 'Seed', GIT_COMMITTER_EMAIL: 'seed@example.com' };
    const log = await runInShell(
      Effect.gen(function* () {
        yield* runGit(['commit', '-q', '--allow-empty', '-m', 'first'], root, {
          at: Date.UTC(2026, 0, 12),
          env: { ...author, ...committer },
        });
        return yield* runGit(['log', '-1', '--format=%an %at'], root);
      })
    );
    expect(log).toBe(`Seed ${Date.UTC(2026, 0, 12) / 1000}`);
  });

  test('writes standard input from text or bytes, and into another index', async () => {
    const root = await createRepo();
    const index = join(root, 'other-index');
    const result = await runInShell(
      Effect.gen(function* () {
        const fromText = yield* runGit(['hash-object', '-w', '--stdin'], root, { input: 'hello\n' });
        const fromBytes = yield* runGit(['hash-object', '-w', '--stdin'], root, {
          input: new TextEncoder().encode('hello\n'),
        });
        yield* runGit(['update-index', '--add', '--cacheinfo', `100644,${fromText},hello.txt`], root, {
          index,
        });
        return {
          fromText,
          fromBytes,
          staged: yield* runGit(['ls-files', '--stage'], root, { index }),
          main: yield* runGit(['ls-files'], root),
        };
      })
    );
    expect(result.fromBytes).toBe(result.fromText);
    expect(result.staged).toContain('hello.txt');
    expect(result.main).toBe('');
  });

  test('fails with the command and git’s own message', async () => {
    const root = await createRepo();
    const error = await runInShell(Effect.flip(runGit(['rev-parse', '--verify', 'missing'], root)));
    expect(error._tag).toBe('GitCommandFailed');
    expect(error.command).toBe('git rev-parse --verify missing');
    expect(error.message).toMatch(/^git rev-parse --verify missing: /);
  });

  test('fails the same way when it cannot start git in the folder', async () => {
    const error = await runInShell(Effect.flip(runGit(['status'], join(tmpdir(), 'kit-git-gone'))));
    expect(error._tag).toBe('GitCommandFailed');
    expect(error.code).toBe(127);
  });
});
