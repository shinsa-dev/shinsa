import { describe, expect, test } from 'bun:test';
import { BunServices } from '@effect/platform-bun';
import { Effect, Layer } from 'effect';
import { GitHubProcess } from '../../src/github/process/service.ts';
import { PullRequests } from '../../src/github/pulls/service.ts';
import type { GitHubAnswer } from '../../src/github/schema.ts';
import { GitHubCli } from '../../src/github/service.ts';
import { Shell } from '../../src/shell/service.ts';
import { createTempDir, overrideEnv } from '../helpers/index.ts';
import { createRepo } from '../helpers/state.ts';

const answered = (stdout: string, ok = true) => ({
  ok,
  code: ok ? 0 : 1,
  stdout,
  stderr: ok ? '' : stdout,
  timedOut: false,
});

function runWith<A, E>(answer: GitHubAnswer, effect: Effect.Effect<A, E, PullRequests | GitHubCli>) {
  const layer = PullRequests.layer.pipe(
    Layer.provideMerge(GitHubCli.layer),
    Layer.provide(GitHubProcess.layerTest(answer))
  );
  return Effect.runPromise(effect.pipe(Effect.provide(layer)));
}

const view = {
  number: 9,
  url: 'https://github.com/acme/app/pull/9',
  state: 'OPEN',
  mergeable: 'MERGEABLE',
  reviewDecision: null,
  baseRefName: 'feat/base',
  statusCheckRollup: [],
};

describe('GitHubCli over gh', () => {
  test('an answer that breaks its schema is GitHubAnswerInvalid, naming the gh command', async () => {
    const error = await runWith(
      () => answered(JSON.stringify({ ...view, state: 'DRAFT' })),
      Effect.flip(PullRequests.use((pulls) => pulls.readStacked(createRepo({ remote: null }), 9)))
    );
    expect(error._tag).toBe('GitHubAnswerInvalid');
    expect(error.message).toStartWith('gh pr view answered: ');
  });

  test('a stacked pull request is read by its number', async () => {
    const calls: string[][] = [];
    const read = await runWith(
      (args) => {
        calls.push([...args]);
        return answered(JSON.stringify(view));
      },
      PullRequests.use((pulls) => pulls.readStacked(createRepo({ remote: null }), 9))
    );
    expect(read?.pullRequest).toMatchObject({ number: 9, base: 'feat/base', state: 'open', checks: 'none' });
    expect(calls[0]?.slice(0, 3)).toEqual(['pr', 'view', '9']);
  });

  test('an upload answer that is not JSON is no attachment address', async () => {
    const error = await runWith(
      () => answered('<html>'),
      Effect.flip(
        PullRequests.use((pulls) =>
          pulls.upload(createRepo(), 1, { path: '/tmp/a.png', name: 'a.png', contentType: 'image/png' })
        )
      )
    );
    expect(error).toMatchObject({
      _tag: 'GitHubAnswerInvalid',
      message: 'GitHub did not return an attachment address.',
    });
  });

  test('a call cancelled before it starts never runs gh', async () => {
    const stopped = new AbortController();
    stopped.abort();
    const layer = GitHubProcess.layer.pipe(Layer.provide(Shell.layer), Layer.provide(BunServices.layer));
    const result = await Effect.runPromise(
      GitHubProcess.use((gh) =>
        gh.attempt(['api', 'user'], createTempDir(), { signal: stopped.signal })
      ).pipe(Effect.provide(layer))
    );
    expect(result).toMatchObject({ ok: false, code: 130 });
  });

  test('a machine without gh answers that it could not start', async () => {
    const restore = overrideEnv({ PATH: createTempDir() });
    const layer = GitHubProcess.layer.pipe(Layer.provide(Shell.layer), Layer.provide(BunServices.layer));
    try {
      const result = await Effect.runPromise(
        GitHubProcess.use((gh) => gh.attempt(['api', 'user'], createTempDir())).pipe(Effect.provide(layer))
      );
      expect(result).toMatchObject({ ok: false, code: 127 });
    } finally {
      restore();
    }
  });
});
