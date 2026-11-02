import { describe, expect, it } from 'bun:test';
import {
  describeNotaryRejection,
  describeRetryFailure,
  NOTARY_SUBMIT_DELAYS,
  parseNotarySubmission,
  type RetryFailure,
  resolveNotaryCredentials,
  retryStep,
  STAPLE_DELAYS,
  serializeRetryWarning,
} from './release-retry.ts';

function createRecorder() {
  const waits: number[] = [];
  const failures: RetryFailure[] = [];
  return {
    waits,
    failures,
    options: {
      label: 'Staple',
      delays: [10, 20, 40],
      sleep: async (milliseconds: number) => {
        waits.push(milliseconds);
      },
      onRetry: (failure: RetryFailure) => {
        failures.push(failure);
      },
    },
  };
}

function failTimes(count: number, value: string) {
  const attempts: number[] = [];
  return {
    attempts,
    step: async (attempt: number) => {
      attempts.push(attempt);
      if (attempts.length <= count) throw new Error(`lost ${attempt}`);
      return value;
    },
  };
}

describe('retryStep', () => {
  it('returns the first success without waiting', async () => {
    const recorder = createRecorder();
    const { step, attempts } = failTimes(0, 'stapled');
    expect(await retryStep(step, recorder.options)).toBe('stapled');
    expect(attempts).toEqual([1]);
    expect(recorder.waits).toEqual([]);
    expect(recorder.failures).toEqual([]);
  });

  it('waits each delay in turn and recovers after failures', async () => {
    const recorder = createRecorder();
    const { step, attempts } = failTimes(2, 'stapled');
    expect(await retryStep(step, recorder.options)).toBe('stapled');
    expect(attempts).toEqual([1, 2, 3]);
    expect(recorder.waits).toEqual([10, 20]);
    expect(
      recorder.failures.map(({ attempt, attempts: total, delay, label }) => ({
        attempt,
        total,
        delay,
        label,
      }))
    ).toEqual([
      { attempt: 1, total: 4, delay: 10, label: 'Staple' },
      { attempt: 2, total: 4, delay: 20, label: 'Staple' },
    ]);
  });

  it('throws the last error once every attempt failed', async () => {
    const recorder = createRecorder();
    const { step, attempts } = failTimes(4, 'never');
    await expect(retryStep(step, recorder.options)).rejects.toThrow('lost 4');
    expect(attempts).toEqual([1, 2, 3, 4]);
    expect(recorder.waits).toEqual([10, 20, 40]);
  });

  it('tries once when there are no delays', async () => {
    const recorder = createRecorder();
    const { step, attempts } = failTimes(1, 'never');
    await expect(retryStep(step, { ...recorder.options, delays: [] })).rejects.toThrow('lost 1');
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
    expect(describeRetryFailure({ ...failure, error: new Error('Failed with exit code 68') })).toBe(
      'Staple failed on attempt 2 of 5 (Failed with exit code 68). Trying again in 30s.'
    );
  });

  it("adds a shell error's output", () => {
    const error = Object.assign(new Error('Failed with exit code 68'), {
      stderr: Buffer.from('The network connection was lost.\n'),
    });
    expect(describeRetryFailure({ ...failure, error })).toContain(
      '(Failed with exit code 68: The network connection was lost.)'
    );
  });

  it('skips empty output and describes errors that are not Error objects', () => {
    const error = Object.assign(new Error('Failed'), { stderr: '  ' });
    expect(describeRetryFailure({ ...failure, error })).toContain('(Failed)');
    expect(describeRetryFailure({ ...failure, error: 'timed out' })).toContain('(timed out)');
  });
});

describe('serializeRetryWarning', () => {
  const failure = { label: 'Validate the staple', attempt: 1, attempts: 5, delay: 15_000, error: 'Error 68' };

  it('writes a warning annotation on GitHub Actions', () => {
    expect(serializeRetryWarning(failure, { GITHUB_ACTIONS: 'true' })).toBe(
      '::warning title=Validate the staple::Validate the staple failed on attempt 1 of 5 (Error 68). Trying again in 15s.\n'
    );
  });

  it('writes the plain line anywhere else', () => {
    expect(serializeRetryWarning(failure, {})).toBe(
      'Validate the staple failed on attempt 1 of 5 (Error 68). Trying again in 15s.\n'
    );
  });
});

describe('resolveNotaryCredentials', () => {
  it('reads the three Apple secrets', () => {
    expect(
      resolveNotaryCredentials({
        APPLE_ID: 'me@example.com',
        APPLE_APP_SPECIFIC_PASSWORD: 'pw',
        APPLE_TEAM_ID: 'TEAM',
      })
    ).toEqual({ appleId: 'me@example.com', password: 'pw', teamId: 'TEAM' });
  });

  it('names the missing ones', () => {
    expect(() => resolveNotaryCredentials({ APPLE_ID: 'me@example.com', APPLE_TEAM_ID: '' })).toThrow(
      'Set APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID to notarize the app (docs/release.md).'
    );
  });
});

describe('parseNotarySubmission', () => {
  it('reads the id and the status', () => {
    expect(parseNotarySubmission('{"id":"abc","status":"Accepted","message":"Processing complete"}')).toEqual(
      {
        id: 'abc',
        status: 'Accepted',
      }
    );
  });

  it('refuses output that is not a submission', () => {
    expect(() => parseNotarySubmission('null')).toThrow('notarytool did not answer with an object.');
    expect(() => parseNotarySubmission('{"id":"abc"}\n')).toThrow(
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
