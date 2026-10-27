import { describe, expect, test } from 'bun:test';
import {
  isMissingThread,
  isUsageLimit,
  resolveCodexFailure,
  resolveErrorCode,
} from '../../../../src/agents/providers/codex/classify.ts';

describe('codex errors become Shinsa failure classes', () => {
  test('each codexErrorInfo maps to the recovery Shinsa runs for it', () => {
    const cases: [unknown, string, string | null][] = [
      ['usageLimitExceeded', 'usage_limit', 'usageLimitExceeded'],
      ['rateLimitExceeded', 'usage_limit', 'rateLimitExceeded'],
      [
        { responseTooManyFailedAttempts: { httpStatusCode: 429 } },
        'usage_limit',
        'responseTooManyFailedAttempts',
      ],
      ['unauthorized', 'auth', 'unauthorized'],
      [{ httpConnectionFailed: { httpStatusCode: 401 } }, 'auth', 'httpConnectionFailed'],
      ['contextWindowExceeded', 'context_window_full', 'contextWindowExceeded'],
      ['sessionBudgetExceeded', 'budget_exhausted', 'sessionBudgetExceeded'],
      ['serverOverloaded', 'overloaded', 'serverOverloaded'],
      ['sandboxError', 'setup_failed', 'sandboxError'],
      ['cyberPolicy', 'model_error', 'cyberPolicy'],
      [
        { responseStreamDisconnected: { httpStatusCode: 502 } },
        'transport_error',
        'responseStreamDisconnected',
      ],
      [
        { responseTooManyFailedAttempts: { httpStatusCode: 500 } },
        'transport_error',
        'responseTooManyFailedAttempts',
      ],
      ['internalServerError', 'provider_error', 'internalServerError'],
      [null, 'provider_error', null],
      [42, 'provider_error', null],
    ];
    for (const [info, failureClass, code] of cases) {
      expect(resolveCodexFailure({ message: 'It broke', codexErrorInfo: info })).toMatchObject({
        class: failureClass,
        code,
      });
    }
  });

  test('the message keeps what codex said, details first', () => {
    expect(
      resolveCodexFailure({
        message: 'Summary',
        additionalDetails: ' The real cause ',
        codexErrorInfo: 'badRequest',
      }).message
    ).toBe('The real cause');
    expect(resolveCodexFailure({ message: 'Too big', codexErrorInfo: 'contextWindowExceeded' }).message).toBe(
      'Codex stopped: the conversation no longer fits the model’s context window. Too big'
    );
    expect(resolveCodexFailure({ codexErrorInfo: 'serverOverloaded' }).message).toBe(
      'Codex’s API is overloaded. It retries shortly.'
    );
    expect(resolveCodexFailure({ codexErrorInfo: { responseStreamDisconnected: {} } }).message).toBe(
      'Codex lost the connection to its API.'
    );
    expect(resolveCodexFailure(null)).toMatchObject({
      class: 'provider_error',
      message: 'Codex stopped with an error.',
    });
    expect(resolveCodexFailure({ message: 'x'.repeat(900) }).message).toHaveLength(500);
  });

  test('a usage limit leaves its reset to the account usage, and nothing else is a usage limit', () => {
    expect(resolveCodexFailure({ codexErrorInfo: 'usageLimitExceeded' })).toMatchObject({
      class: 'usage_limit',
      resetAt: null,
    });
    expect(isUsageLimit(null)).toBe(false);
  });

  test('the codes of every shape, and a resume of a thread codex does not have', () => {
    expect(resolveErrorCode({ responseStreamDisconnected: null })).toBe('responseStreamDisconnected');
    expect(resolveErrorCode({})).toBeNull();
    expect(isMissingThread(new Error('no rollout found for thread id abc'))).toBe(true);
    expect(isMissingThread(new Error('thread abc not found'))).toBe(true);
    expect(isMissingThread(new Error('model not found'))).toBe(false);
    expect(isMissingThread('no rollout found')).toBe(false);
  });
});
