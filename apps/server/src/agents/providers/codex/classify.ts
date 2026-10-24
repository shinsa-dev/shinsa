import type { RunFailure, RunFailureClass } from '@shinsa/core';

export interface CodexTurnError {
  message?: string | null;
  codexErrorInfo?: unknown;
  additionalDetails?: string | null;
}

const MAX_MESSAGE = 500;

const SIGNED_OUT = 'Codex is signed out. Run `codex login` in a terminal and sign in again.';

const MISSING_THREAD = /no rollout found|no such thread|unknown thread|thread .*not found|does not exist/i;

const USAGE_CODES = new Set(['usageLimitExceeded', 'rateLimitExceeded']);

const TRANSPORT_CODES = new Set([
  'httpConnectionFailed',
  'responseStreamConnectionFailed',
  'responseStreamDisconnected',
  'responseTooManyFailedAttempts',
]);

const DECLARED: Partial<Record<string, { class: RunFailureClass; message: string }>> = {
  contextWindowExceeded: {
    class: 'context_window_full',
    message: 'Codex stopped: the conversation no longer fits the model’s context window.',
  },
  sessionBudgetExceeded: {
    class: 'budget_exhausted',
    message: 'Codex stopped: the session’s budget ran out.',
  },
  serverOverloaded: { class: 'overloaded', message: 'Codex’s API is overloaded. It retries shortly.' },
  sandboxError: { class: 'setup_failed', message: 'Codex could not run its sandbox.' },
  cyberPolicy: { class: 'model_error', message: 'The model refused the request.' },
  misalignmentPolicyViolation: { class: 'model_error', message: 'The model refused the request.' },
};

export function resolveErrorCode(info: unknown) {
  if (typeof info === 'string') return info;
  if (!info || typeof info !== 'object') return null;
  return Object.keys(info)[0] ?? null;
}

function resolveHttpStatus(info: unknown) {
  if (!info || typeof info !== 'object') return null;
  const data = Object.values(info)[0] as { httpStatusCode?: unknown } | null | undefined;
  return typeof data?.httpStatusCode === 'number' ? data.httpStatusCode : null;
}

function resolveText(error: CodexTurnError | null) {
  const details = error?.additionalDetails?.trim();
  return details || error?.message?.trim() || '';
}

function createFailure(
  failureClass: RunFailureClass,
  message: string,
  code: string | null,
  extra: Partial<RunFailure> = {}
): RunFailure {
  return {
    class: failureClass,
    message: message.slice(0, MAX_MESSAGE),
    code,
    retryable: null,
    resetAt: null,
    ...extra,
  };
}

export function isUsageLimit(error: CodexTurnError | null) {
  const info = error?.codexErrorInfo;
  const code = resolveErrorCode(info);
  return (code !== null && USAGE_CODES.has(code)) || resolveHttpStatus(info) === 429;
}

export function resolveCodexFailure(error: CodexTurnError | null): RunFailure {
  const info = error?.codexErrorInfo;
  const code = resolveErrorCode(info);
  const text = resolveText(error);
  if (isUsageLimit(error)) {
    const message =
      code === 'rateLimitExceeded' ? 'Codex’s rate limit is reached.' : 'Codex’s usage limit is reached.';
    return createFailure('usage_limit', message, code, { retryable: true });
  }
  if (code === 'unauthorized' || resolveHttpStatus(info) === 401)
    return createFailure('auth', SIGNED_OUT, code);
  const declared = code ? DECLARED[code] : undefined;
  if (declared)
    return createFailure(declared.class, text ? `${declared.message} ${text}` : declared.message, code);
  if (code && TRANSPORT_CODES.has(code)) {
    return createFailure('transport_error', text || 'Codex lost the connection to its API.', code, {
      retryable: true,
    });
  }
  return createFailure('provider_error', text || 'Codex stopped with an error.', code);
}

export function isMissingThread(error: unknown) {
  return error instanceof Error && MISSING_THREAD.test(error.message);
}

export function createLostSession(): RunFailure {
  return createFailure(
    'session_lost',
    'Codex no longer has the thread this step tried to resume.',
    'unknown_session'
  );
}

export function createSetupFailure(message: string, code = 'setup_failed'): RunFailure {
  return createFailure('setup_failed', message, code);
}

export function createTransportFailure(message: string): RunFailure {
  return createFailure('transport_error', message, 'stream_ended', { retryable: true });
}

export function createInterruption(): RunFailure {
  return createFailure('aborted', 'The agent’s turn was interrupted before it finished.', 'interrupted');
}
