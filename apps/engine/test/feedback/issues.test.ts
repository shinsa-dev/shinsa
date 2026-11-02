import { describe, expect, test } from 'bun:test';
import { Effect, Layer } from 'effect';
import { FeedbackIssues } from '../../src/feedback/issues/service.ts';
import { GitHubProcess } from '../../src/github/process/service.ts';
import type { GitHubAnswer } from '../../src/github/schema.ts';
import { GitHubCli } from '../../src/github/service.ts';

const answered = (stdout: string, ok = true) => ({
  ok,
  code: ok ? 0 : 1,
  stdout,
  stderr: ok ? '' : stdout,
  timedOut: false,
});

function runWith<A, E>(answer: GitHubAnswer, effect: Effect.Effect<A, E, FeedbackIssues>) {
  const layer = FeedbackIssues.layer.pipe(
    Layer.provide(GitHubCli.layer),
    Layer.provide(GitHubProcess.layerTest(answer))
  );
  return Effect.runPromise(effect.pipe(Effect.provide(layer)));
}

describe('FeedbackIssues over GitHubCli', () => {
  test('files the issue through gh with the body on stdin', async () => {
    const calls: { args: readonly string[]; input: string | undefined }[] = [];
    const issue = await runWith(
      (args, input) => {
        calls.push({ args, input });
        return answered('https://github.com/shinsa-dev/shinsa/issues/7\n');
      },
      FeedbackIssues.use((issues) => issues.file({ source: 'human', title: 'T', body: 'B' }, '/tmp'))
    );
    expect(issue).toEqual({ number: 7, url: 'https://github.com/shinsa-dev/shinsa/issues/7' });
    expect(calls[0]?.args.slice(0, 2)).toEqual(['issue', 'create']);
    expect(calls[0]?.input).toContain('B\n\n---\n');
  });

  test('a failed gh is GitHubFailed, and an answer without a link or a list is FeedbackAnswerInvalid', async () => {
    const failed = await runWith(
      () => answered('HTTP 401: Bad credentials', false),
      Effect.flip(FeedbackIssues.use((issues) => issues.listStates('/tmp')))
    );
    expect(failed._tag).toBe('GitHubFailed');
    const unlinked = await runWith(
      () => answered('Created.'),
      Effect.flip(
        FeedbackIssues.use((issues) => issues.file({ source: 'agent', title: 'T', body: 'B' }, '/tmp'))
      )
    );
    expect(unlinked).toMatchObject({
      _tag: 'FeedbackAnswerInvalid',
      message: 'GitHub answered without the new issue’s link: Created.',
    });
    const unlisted = await runWith(
      () => answered('{}'),
      Effect.flip(FeedbackIssues.use((issues) => issues.listStates('/tmp')))
    );
    expect(unlisted).toMatchObject({
      _tag: 'FeedbackAnswerInvalid',
      message: 'GitHub answered without a list of issues: {}',
    });
  });

  test('an issue whose state or close time is not text reads as open', async () => {
    const states = await runWith(
      () => answered(JSON.stringify([{ number: 5, state: 7, closedAt: 3 }, null])),
      FeedbackIssues.use((issues) => issues.listStates('/tmp'))
    );
    expect(states).toEqual(new Map([[5, null]]));
  });
});
