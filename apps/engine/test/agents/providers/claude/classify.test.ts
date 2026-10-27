import { describe, expect, test } from 'bun:test';
import type { SDKAssistantMessage, SDKRateLimitInfo, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  createSetupFailure,
  createTransportFailure,
  createTurnEvidence,
  recordAssistantError,
  recordRateLimit,
  resolveClaudeVerdict,
  resolveResetAt,
  type TurnEvidence,
} from '../../../../src/agents/providers/claude/classify.ts';

const NOW = 1_000_000;

function success(overrides: Record<string, unknown> = {}) {
  return {
    type: 'result',
    subtype: 'success',
    result: 'Done.',
    is_error: false,
    ...overrides,
  } as unknown as SDKResultMessage;
}

function failed(subtype: string, errors: string[] = [], overrides: Record<string, unknown> = {}) {
  return { type: 'result', subtype, is_error: true, errors, ...overrides } as unknown as SDKResultMessage;
}

function classify(message: SDKResultMessage, evidence: TurnEvidence = createTurnEvidence()) {
  return resolveClaudeVerdict(message, evidence, NOW);
}

function assistant(
  error: string | undefined,
  extra: Record<string, unknown> = {},
  parent: string | null = null
) {
  return {
    type: 'assistant',
    parent_tool_use_id: parent,
    message: { content: [] },
    error,
    ...extra,
  } as unknown as SDKAssistantMessage;
}

function limit(overrides: Partial<SDKRateLimitInfo> = {}): SDKRateLimitInfo {
  return { status: 'rejected', rateLimitType: 'five_hour', resetsAt: 2_000, ...overrides };
}

describe('a clean result', () => {
  test('completes, and a success that only hit a warning stays completed', () => {
    expect(classify(success())).toEqual({ status: 'completed', failure: null });
    const evidence = createTurnEvidence();
    recordRateLimit(evidence, limit());
    expect(classify(success(), evidence)).toEqual({ status: 'completed', failure: null });
  });
});

describe('terminal reasons', () => {
  const cases: [string, string, string][] = [
    ['prompt_too_long', 'context_window_full', 'no longer fits'],
    ['blocking_limit', 'context_window_full', 'no longer fits'],
    ['rapid_refill_breaker', 'context_window_full', 'filled up again'],
    ['budget_exhausted', 'budget_exhausted', 'budget ran out'],
    ['malformed_tool_use_exhausted', 'malformed_tool_use', 'malformed tool calls'],
    ['image_error', 'image_error', 'image'],
    ['model_error', 'model_error', 'the model returned an error'],
    ['turn_setup_failed', 'setup_failed', 'could not start the turn'],
    ['structured_output_retry_exhausted', 'provider_error', 'structured output'],
    ['tool_deferred_unavailable', 'provider_error', 'deferred tool call'],
    ['api_error', 'provider_error', 'repeated API errors'],
  ];
  for (const [reason, failureClass, text] of cases) {
    test(`${reason} fails the turn as ${failureClass}`, () => {
      const verdict = classify(success({ terminal_reason: reason, is_error: true, result: '' }));
      expect(verdict.status).toBe('failed');
      expect(verdict.failure).toMatchObject({ class: failureClass, code: reason });
      expect(verdict.failure?.message).toContain(text);
    });
  }

  test('a declared reason fails the turn even when the envelope says success', () => {
    expect(classify(success({ terminal_reason: 'prompt_too_long' })).failure?.class).toBe(
      'context_window_full'
    );
  });

  test('an API error keeps the CLI’s own text', () => {
    const verdict = classify(
      success({ terminal_reason: 'api_error', is_error: true, result: 'API Error: 500 boom' })
    );
    expect(verdict.failure).toMatchObject({ class: 'provider_error', message: 'API Error: 500 boom' });
  });

  test('an abort reported as success is an interruption, not a finished turn', () => {
    for (const reason of ['aborted_tools', 'aborted_streaming']) {
      const verdict = classify(success({ terminal_reason: reason }));
      expect(verdict.status).toBe('interrupted');
      expect(verdict.failure).toMatchObject({ class: 'aborted', code: reason });
    }
  });
});

describe('error subtypes', () => {
  test('budget subtypes are budget failures; an interrupted execution is an interruption', () => {
    expect(classify(failed('error_max_budget_usd')).failure).toMatchObject({ class: 'budget_exhausted' });
    expect(classify(failed('error_max_turns')).failure?.message).toContain('every turn');
    const interrupted = classify(failed('error_during_execution', ['Request interrupted by user']));
    expect(interrupted).toMatchObject({ status: 'interrupted', failure: { class: 'aborted' } });
  });

  test('any other failure is a provider error with the CLI’s text, minus its diagnostics', () => {
    const verdict = classify(failed('error_during_execution', ['[ede_diagnostic] noise', 'Tool crashed']));
    expect(verdict.failure).toMatchObject({
      class: 'provider_error',
      message: 'Tool crashed',
      code: 'error_during_execution',
    });
    expect(classify(failed('error_during_execution')).failure?.message).toBe('Claude stopped with an error.');
  });

  test('a startup failure is a setup failure', () => {
    const verdict = classify(
      failed('error_during_execution', ['bad flag'], { startup_failure_reason: 'invalid_flag' })
    );
    expect(verdict.failure).toMatchObject({
      class: 'setup_failed',
      code: 'invalid_flag',
      message: 'bad flag',
    });
    const bare = classify(failed('error_during_execution', [], { startup_failure_reason: 'unknown' }));
    expect(bare.failure?.message).toBe('Claude could not start.');
  });

  test('a session the CLI cannot find is a lost session (Paperclip’s patterns)', () => {
    for (const text of [
      'No conversation found with session ID: abc',
      'unknown session abc',
      'Session abc not found',
      '--resume requires a valid session ID',
    ]) {
      expect(classify(failed('error_during_execution', [text])).failure).toMatchObject({
        class: 'session_lost',
      });
    }
    expect(
      classify(success({ is_error: true, result: 'No conversation found with session ID: x' })).failure?.class
    ).toBe('session_lost');
  });
});

describe('API failures', () => {
  test('529 is an overloaded API and can be retried', () => {
    const verdict = classify(success({ api_error_status: 529, is_error: true, result: 'overloaded' }));
    expect(verdict.failure).toMatchObject({ class: 'overloaded', code: 'api_error_529', retryable: true });
    const evidence = createTurnEvidence();
    recordAssistantError(evidence, assistant('overloaded'));
    expect(classify(success({ is_error: true, result: 'x' }), evidence).failure).toMatchObject({
      class: 'overloaded',
      code: 'overloaded',
    });
  });

  test('429 is a usage limit even without a rate-limit event', () => {
    const verdict = classify(success({ api_error_status: 429, result: '' }));
    expect(verdict).toMatchObject({
      status: 'failed',
      failure: { class: 'usage_limit', code: 'api_error_429', resetAt: null },
    });
  });

  test('a rejected rate limit carries the latest reset across every spent window', () => {
    const evidence = createTurnEvidence();
    recordRateLimit(evidence, limit({ rateLimitType: 'five_hour', resetsAt: 2_000 }));
    recordRateLimit(evidence, limit({ rateLimitType: 'seven_day', resetsAt: 5_000 }));
    const verdict = classify(
      success({ is_error: true, terminal_reason: 'api_error', result: 'limit' }),
      evidence
    );
    expect(verdict.failure).toMatchObject({ class: 'usage_limit', resetAt: 5_000_000, retryable: true });
  });

  test('an unknown reset time leaves the reset unknown, and a window that frees up is forgotten', () => {
    const evidence = createTurnEvidence();
    recordRateLimit(evidence, limit({ resetsAt: undefined }));
    expect(classify(success({ is_error: true, result: 'x' }), evidence).failure?.resetAt).toBeNull();
    recordRateLimit(evidence, limit({ status: 'allowed' }));
    expect(evidence.rejectedLimits.size).toBe(0);
    recordRateLimit(evidence, limit({ overageStatus: 'allowed' }));
    expect(evidence.rejectedLimits.size).toBe(0);
  });

  test('a blocked assistant message counts as limit evidence, unless overage still covers it', () => {
    const evidence = createTurnEvidence();
    recordAssistantError(
      evidence,
      assistant('rate_limit', {
        api_error_params: {
          rate_limit_info: { status: 'rejected', rateLimitType: 'seven_day_opus', resetsAt: 9_000 },
        },
      })
    );
    expect(classify(success({ is_error: true, result: 'x' }), evidence).failure).toMatchObject({
      class: 'usage_limit',
      resetAt: 9_000_000,
    });
    const covered = createTurnEvidence();
    recordAssistantError(
      covered,
      assistant('rate_limit', {
        api_error_params: { rate_limit_info: { status: 'rejected', isUsingOverage: true } },
      })
    );
    expect(covered.assistantLimit).toBeNull();
    const bare = createTurnEvidence();
    recordAssistantError(bare, assistant('rate_limit'));
    expect(bare.assistantLimit).toEqual({ type: 'unknown', resetAt: null });
    recordRateLimit(
      bare,
      limit({ rateLimitType: 'unknown' as SDKRateLimitInfo['rateLimitType'], resetsAt: 3_000 })
    );
    expect(classify(failed('error_during_execution'), bare).failure).toMatchObject({
      class: 'usage_limit',
      resetAt: 3_000_000,
    });
  });

  test('limit evidence does not turn a context-window stop with another status into a usage limit', () => {
    const evidence = createTurnEvidence();
    recordRateLimit(evidence, limit());
    const verdict = classify(
      success({ is_error: true, api_error_status: 400, terminal_reason: 'prompt_too_long' }),
      evidence
    );
    expect(verdict.failure?.class).toBe('context_window_full');
  });

  test('an LLM gateway’s 503 that wraps a 429 is a usage limit with its reset time', () => {
    const verdict = classify(
      success({
        is_error: true,
        terminal_reason: 'api_error',
        api_error_status: 503,
        result:
          'API Error: 503 [gateway] [429]: {"type":"error","error":{"type":"rate_limit_error","message":"slow"}} (reset after 1h 2m 3s)',
      })
    );
    expect(verdict.failure).toMatchObject({
      class: 'usage_limit',
      resetAt: NOW + 3_723_000,
      code: 'api_error_429',
    });
    const noReset = classify(
      success({
        is_error: true,
        terminal_reason: 'api_error',
        api_error_status: 503,
        result: 'API Error: 503 other',
      })
    );
    expect(noReset.failure?.class).toBe('provider_error');
    const zero = classify(
      success({
        is_error: true,
        terminal_reason: 'api_error',
        api_error_status: 503,
        result:
          'API Error: 503 [g] [429]: {"type":"error","error":{"type":"rate_limit_error"}} (reset after 0s)',
      })
    );
    expect(zero.failure?.class).toBe('provider_error');
  });

  test('a signed-out or blocked account is an auth failure, and it wins over limit evidence', () => {
    const cases: [string, string][] = [
      ['authentication_failed', 'signed out'],
      ['oauth_org_not_allowed', 'not allowed'],
      ['account_on_hold', 'on hold'],
      ['verification_required', 'verified'],
      ['billing_error', 'billing problem'],
    ];
    for (const [error, text] of cases) {
      const evidence = createTurnEvidence();
      recordRateLimit(evidence, limit());
      recordAssistantError(evidence, assistant(error));
      const verdict = classify(success({ is_error: true, result: 'x' }), evidence);
      expect(verdict.failure).toMatchObject({ class: 'auth', code: error });
      expect(verdict.failure?.message).toContain(text);
    }
    expect(classify(success({ api_error_status: 401, is_error: true, result: '' })).failure).toMatchObject({
      class: 'auth',
      code: 'api_error_401',
    });
  });

  test('an unknown model is a model error; a subagent’s errors are not the turn’s', () => {
    const evidence = createTurnEvidence();
    recordAssistantError(evidence, assistant('model_not_found'));
    expect(classify(success({ is_error: true, result: 'x' }), evidence).failure).toMatchObject({
      class: 'model_error',
      code: 'model_not_found',
    });
    const nested = createTurnEvidence();
    recordAssistantError(nested, assistant('authentication_failed', {}, 'toolu_1'));
    expect(nested.accountProblem).toBeNull();
    recordAssistantError(nested, assistant(undefined));
    expect(nested).toEqual(createTurnEvidence());
  });
});

describe('helpers', () => {
  test('reset times are seconds from the CLI and are kept in a sane range', () => {
    expect(resolveResetAt(10)).toBe(10_000);
    expect(resolveResetAt('10')).toBeNull();
    expect(resolveResetAt(-1)).toBeNull();
    expect(resolveResetAt(9e15)).toBeNull();
  });

  test('a dead stream and a missing claude have their own classes', () => {
    expect(createTransportFailure('gone')).toMatchObject({
      class: 'transport_error',
      code: 'stream_ended',
      retryable: true,
    });
    expect(createSetupFailure('no claude')).toMatchObject({ class: 'setup_failed', message: 'no claude' });
  });

  test('failure messages are kept short', () => {
    const verdict = classify(failed('error_during_execution', ['x'.repeat(2_000)]));
    expect(verdict.failure?.message).toHaveLength(500);
  });
});

describe('a login that needs signing in again (Paperclip detectClaudeLoginRequired)', () => {
  test('a failed turn that asks to log in, or reports a dead token, is an auth failure even with limit evidence', () => {
    const evidence = createTurnEvidence();
    recordRateLimit(evidence, limit());
    for (const text of [
      'Invalid API key · Please run /login',
      'Not logged in · Please run /login',
      'Failed to authenticate. API Error: 401 Invalid bearer token',
      'Your OAuth access token is expired.',
      'authentication_error: the token was revoked',
    ]) {
      const verdict = classify(success({ is_error: true, result: text }), evidence);
      expect(verdict.failure).toMatchObject({ class: 'auth', code: 'login_required' });
    }
    expect(
      classify(failed('error_during_execution', ['Please run `claude login` first.'])).failure?.class
    ).toBe('auth');
  });

  test('a bare invalid key, or a successful turn that mentions a token, is not a login problem', () => {
    expect(classify(success({ is_error: true, result: 'Invalid API key' })).failure?.class).toBe(
      'provider_error'
    );
    expect(classify(success({ result: 'The access token is expired, so I refreshed it.' })).status).toBe(
      'completed'
    );
  });

  test('an account problem the assistant named keeps its own message', () => {
    const evidence = createTurnEvidence();
    recordAssistantError(evidence, assistant('billing_error'));
    const verdict = classify(success({ is_error: true, result: 'Not logged in' }), evidence);
    expect(verdict.failure).toMatchObject({ class: 'auth', code: 'billing_error' });
  });
});
