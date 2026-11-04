import { describe, expect, it } from 'bun:test';
import { ConfigProvider, Duration, Effect, Fiber, Redacted } from 'effect';
import { TestClock } from 'effect/testing';
import {
  describeNotaryRejection,
  describeRetryFailure,
  NOTARY_SUBMIT_DELAYS,
  parseNotarySubmission,
  resolveNotaryCredentials,
  retryStep,
  STAPLE_DELAYS,
  serializeRetryWarning,
  warnRetry,
} from './release-retry.ts';
import type { RetryFailure } from './release/schema.ts';

const DELAYS = [Duration.millis(10), Duration.millis(20), Duration.millis(40)];

function failTimes(count: number, value: string) {
  const attempts: number[] = [];
  const step = Effect.suspend(() => {
    attempts.push(attempts.length + 1);
    if (attempts.length <= count) return Effect.fail({ message: `lost ${attempts.length}` });
    return Effect.succeed(value);
  });
  return { attempts, step };
}

function runRetry<A>(step: Effect.Effect<A, { readonly message: string }>, delays = DELAYS) {
  const failures: RetryFailure[] = [];
  const retried = retryStep({
    label: 'Staple',
    delays,
    onRetry: (failure) => Effect.sync(() => failures.push(failure)),
  })(step);
  const result = Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(Effect.result(retried));
      yield* TestClock.adjust('1 minute');
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer()))
  );
  return result.then((outcome) => ({ outcome, failures }));
}

describe('retryStep', () => {
  it('returns the first success without waiting', async () => {
    const { step, attempts } = failTimes(0, 'stapled');
    const { outcome, failures } = await runRetry(step);
    expect(outcome).toMatchObject({ _tag: 'Success', success: 'stapled' });
    expect(attempts).toEqual([1]);
    expect(failures).toEqual([]);
  });

  it('waits each delay in turn and recovers after failures', async () => {
    const { step, attempts } = failTimes(2, 'stapled');
    const { outcome, failures } = await runRetry(step);
    expect(outcome).toMatchObject({ _tag: 'Success', success: 'stapled' });
    expect(attempts).toEqual([1, 2, 3]);
    expect(
      failures.map(({ attempt, attempts: total, delay, label }) => ({ attempt, total, delay, label }))
    ).toEqual([
      { attempt: 1, total: 4, delay: 10, label: 'Staple' },
      { attempt: 2, total: 4, delay: 20, label: 'Staple' },
    ]);
  });

  it('fails with the last error once every attempt failed', async () => {
    const { step, attempts } = failTimes(4, 'never');
    const { outcome, failures } = await runRetry(step);
    expect(outcome).toMatchObject({ _tag: 'Failure', failure: { message: 'lost 4' } });
    expect(attempts).toEqual([1, 2, 3, 4]);
    expect(failures.map((failure) => failure.delay)).toEqual([10, 20, 40]);
  });

  it('tries once when there are no delays', async () => {
    const { step, attempts } = failTimes(1, 'never');
    const { outcome } = await runRetry(step, []);
    expect(outcome).toMatchObject({ _tag: 'Failure', failure: { message: 'lost 1' } });
    expect(attempts).toEqual([1]);
  });

  it('gives notarizing three attempts and stapling five', () => {
    expect(NOTARY_SUBMIT_DELAYS.length + 1).toBe(3);
    expect(STAPLE_DELAYS.length + 1).toBe(5);
  });
});

describe('describeRetryFailure', () => {
  const failure = { label: 'Staple', attempt: 2, attempts: 5, delay: 30_000 };

  it('names the attempt, the error and the wait', () => {
    expect(
      describeRetryFailure({
        ...failure,
        error: { message: 'xcrun stapler failed (68): The network connection was lost.' },
      })
    ).toBe(
      'Staple failed on attempt 2 of 5 (xcrun stapler failed (68): The network connection was lost.). Trying again in 30s.'
    );
  });
});

describe('serializeRetryWarning', () => {
  const failure = {
    label: 'Validate the staple',
    attempt: 1,
    attempts: 5,
    delay: 15_000,
    error: { message: 'Error 68' },
  };

  it('writes a warning annotation on GitHub Actions', () => {
    expect(serializeRetryWarning(failure, true)).toBe(
      '::warning title=Validate the staple::Validate the staple failed on attempt 1 of 5 (Error 68). Trying again in 15s.\n'
    );
  });

  it('writes the plain line anywhere else', () => {
    expect(serializeRetryWarning(failure, false)).toBe(
      'Validate the staple failed on attempt 1 of 5 (Error 68). Trying again in 15s.\n'
    );
  });

  it('prints the warning for where it runs', async () => {
    const lines: unknown[] = [];
    const original = console.log;
    console.log = (line: unknown) => {
      lines.push(line);
    };
    await Effect.runPromise(
      warnRetry(failure).pipe(
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ GITHUB_ACTIONS: 'true' })))
      )
    );
    await Effect.runPromise(
      warnRetry(failure).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))))
    );
    console.log = original;
    expect(lines).toEqual([
      '::warning title=Validate the staple::Validate the staple failed on attempt 1 of 5 (Error 68). Trying again in 15s.',
      'Validate the staple failed on attempt 1 of 5 (Error 68). Trying again in 15s.',
    ]);
  });
});

function resolveCredentialsFrom(env: Record<string, string>) {
  return Effect.runPromise(
    resolveNotaryCredentials().pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))))
  );
}

describe('resolveNotaryCredentials', () => {
  it('reads the three Apple secrets, the password redacted', async () => {
    const credentials = await resolveCredentialsFrom({
      APPLE_ID: 'me@example.com',
      APPLE_APP_SPECIFIC_PASSWORD: 'pw',
      APPLE_TEAM_ID: 'TEAM',
    });
    expect({ ...credentials, password: Redacted.value(credentials.password) }).toEqual({
      appleId: 'me@example.com',
      password: 'pw',
      teamId: 'TEAM',
    });
    expect(String(credentials.password)).not.toContain('pw');
  });

  it('names the missing ones', async () => {
    await expect(resolveCredentialsFrom({ APPLE_ID: 'me@example.com', APPLE_TEAM_ID: '' })).rejects.toThrow(
      'Set APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID to notarize the app (docs/release.md).'
    );
  });
});

describe('parseNotarySubmission', () => {
  it('reads the id and the status', async () => {
    expect(
      await Effect.runPromise(
        parseNotarySubmission('{"id":"abc","status":"Accepted","message":"Processing complete"}')
      )
    ).toEqual({ id: 'abc', status: 'Accepted' });
  });

  it('refuses output that is not a submission', async () => {
    await expect(Effect.runPromise(parseNotarySubmission('null'))).rejects.toThrow(
      'notarytool did not return a submission id and status: null'
    );
    await expect(Effect.runPromise(parseNotarySubmission('{"id":"abc"}\n'))).rejects.toThrow(
      'notarytool did not return a submission id and status: {"id":"abc"}'
    );
  });
});

describe('describeNotaryRejection', () => {
  it("names the submission, its status and Apple's log", () => {
    expect(describeNotaryRejection({ id: 'abc', status: 'Invalid' }, '{"issues":[]}\n')).toBe(
      'Apple did not accept submission abc: its status is Invalid.\n{"issues":[]}'
    );
  });
});
