import type { SDKAssistantMessage, SDKRateLimitInfo, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { RunFailure, RunFailureClass } from '@shinsa/core';

type TurnStatus = 'completed' | 'failed' | 'interrupted';

export interface TurnVerdict {
  status: TurnStatus;
  failure: RunFailure | null;
}

export interface TurnEvidence {
  rejectedLimits: Map<string, number | null>;
  assistantLimit: { type: string; resetAt: number | null } | null;
  accountProblem: { code: string; message: string } | null;
  assistantError: string | null;
}

const MAX_MESSAGE = 500;

const UNKNOWN_SESSION =
  /no conversation found with session id|unknown session|session .* not found|not a valid UUID|--resume requires a valid session|is not a UUID|does not match any session title/i;

const GATEWAY_LIMIT =
  /^API Error: 503 \[[^\]\r\n]+\] \[429\]: \{"type":"error","error":\{"type":"rate_limit_error",[^\r\n]*\} \(reset after (?:(\d+)h ?)?(?:(\d+)m ?)?(?:(\d+)s)?\)/;

const LOGIN_PROMPT =
  /(?:not\s+logged\s+in|please\s+log\s+in|please\s+run\s+(?:`?claude\s+login`?|\/login)|login\s+required|requires\s+login|unauthorized|authentication\s+required|invalid\s+api\s+key[\s\S]{0,120}(?:\/login|claude\s+login|log\s+in))/i;

const TOKEN_FAILURE =
  /(?:authentication[_\s-](?:failed|error)|failed\s+to\s+authenticate|invalid\s+bearer\s+token|(?:invalid|expired|revoked)[\s\S]{0,40}(?:bearer|oauth|access)\s+token|(?:bearer|oauth|access)\s+token[\s\S]{0,40}(?:is\s+)?(?:invalid|expired|revoked)|oauth\s+session[\s\S]{0,40}(?:expired|could\s+not\s+be\s+refreshed))/i;

const CONTEXT_FULL = 'Claude stopped: the conversation no longer fits the model’s context window.';

const SYNTHETIC_MODEL = '<synthetic>';

const STDERR_MARK = '. stderr: ';

const HOOK_NOISE = /^\s*[\w:-]+ hook \[[\s\S]*\] failed: /;

const PROCESS_EXIT = /^Claude Code process exited with code (\S+?)\.?$/;

const PROCESS_SIGNAL = /^Claude Code process terminated by signal (\S+?)\.?$/;

const OUT_OF_CREDITS =
  /(?:credit\s+balance\s+is\s+too\s+low|out\s+of\s+(?:usage\s+)?credits|insufficient\s+credits|extra\s+usage\s+(?:is\s+)?(?:exhausted|used\s+up))/i;

const LIMIT_TEXT = /(?:usage\s+limit\s+reached|hit\s+your\s+(?:usage\s+)?limit)(?:\|(\d{9,11}))?/i;

const ACCOUNT_PROBLEMS: Record<string, string> = {
  authentication_failed: 'Claude is signed out. Run `claude` in a terminal and sign in again.',
  oauth_org_not_allowed:
    'This Claude login is not allowed for the organisation. Sign in with another account.',
  account_on_hold: 'The Claude account is on hold. Check the account, then sign in again.',
  verification_required: 'The Claude account needs to be verified. Sign in again to finish it.',
  billing_error:
    'The Claude account has a billing problem. Fix it in the Claude console, then sign in again.',
};

const TERMINAL_FAILURES: Partial<Record<string, { class: RunFailureClass; message: string }>> = {
  prompt_too_long: { class: 'context_window_full', message: CONTEXT_FULL },
  blocking_limit: { class: 'context_window_full', message: CONTEXT_FULL },
  rapid_refill_breaker: {
    class: 'context_window_full',
    message: 'Claude stopped: the context filled up again too quickly after compaction.',
  },
  budget_exhausted: {
    class: 'budget_exhausted',
    message: 'Claude stopped: the turn’s token budget ran out.',
  },
  malformed_tool_use_exhausted: {
    class: 'malformed_tool_use',
    message: 'Claude gave up after repeated malformed tool calls.',
  },
  image_error: {
    class: 'image_error',
    message: 'Claude stopped: an image in the conversation could not be read.',
  },
  model_error: { class: 'model_error', message: 'Claude stopped: the model returned an error.' },
  turn_setup_failed: { class: 'setup_failed', message: 'Claude could not start the turn.' },
  structured_output_retry_exhausted: {
    class: 'provider_error',
    message: 'Claude could not produce the requested structured output.',
  },
  tool_deferred_unavailable: {
    class: 'provider_error',
    message: 'Claude could not resume a deferred tool call: the tool is no longer available.',
  },
  api_error: { class: 'provider_error', message: 'Claude gave up after repeated API errors.' },
};

const ERROR_SUBTYPES: Partial<Record<string, { class: RunFailureClass; message: string }>> = {
  error_max_budget_usd: {
    class: 'budget_exhausted',
    message: 'Claude stopped: the spending budget ran out.',
  },
  error_max_turns: {
    class: 'budget_exhausted',
    message: 'Claude stopped: it used every turn it was allowed.',
  },
};

export function createTurnEvidence(): TurnEvidence {
  return { rejectedLimits: new Map(), assistantLimit: null, accountProblem: null, assistantError: null };
}

export function resolveResetAt(resetsAt: unknown) {
  const ms = typeof resetsAt === 'number' ? resetsAt * 1000 : Number.NaN;
  return Number.isFinite(ms) && ms > 0 && ms < 8.64e15 ? ms : null;
}

function isOverageAllowed(info: Partial<SDKRateLimitInfo>) {
  return (
    info.overageStatus === 'allowed' ||
    info.overageStatus === 'allowed_warning' ||
    info.isUsingOverage === true ||
    info.overageInUse === true
  );
}

export function recordRateLimit(evidence: TurnEvidence, info: SDKRateLimitInfo) {
  const type = info.rateLimitType ?? 'unknown';
  const overage = isOverageAllowed(info);
  if (info.status === 'rejected' && !overage) {
    evidence.rejectedLimits.set(type, resolveResetAt(info.resetsAt));
    return;
  }
  evidence.rejectedLimits.delete(type);
}

function readBlockedLimit(message: SDKAssistantMessage) {
  const params = (message as { api_error_params?: { rate_limit_info?: Partial<SDKRateLimitInfo> } })
    .api_error_params;
  const info = params?.rate_limit_info;
  if (info?.status !== 'rejected') return { type: 'unknown', resetAt: null };
  if (isOverageAllowed(info)) return null;
  return { type: info.rateLimitType ?? 'unknown', resetAt: resolveResetAt(info.resetsAt) };
}

function readSyntheticText(message: SDKAssistantMessage) {
  const body = message.message as { model?: unknown; content?: unknown };
  if (body.model !== SYNTHETIC_MODEL || !Array.isArray(body.content)) return '';
  return body.content
    .flatMap((block: { type?: unknown; text?: unknown }) =>
      block.type === 'text' && typeof block.text === 'string' ? [block.text] : []
    )
    .join('\n');
}

function isLoginText(text: string) {
  return LOGIN_PROMPT.test(text) || TOKEN_FAILURE.test(text);
}

function createSignedOutProblem() {
  return { code: 'authentication_failed', message: ACCOUNT_PROBLEMS.authentication_failed as string };
}

export function recordAssistantError(evidence: TurnEvidence, message: SDKAssistantMessage) {
  if (message.parent_tool_use_id !== null) return;
  evidence.assistantLimit = message.error === 'rate_limit' ? readBlockedLimit(message) : null;
  const problem = message.error ? ACCOUNT_PROBLEMS[message.error] : undefined;
  if (message.error && problem) evidence.accountProblem = { code: message.error, message: problem };
  if (message.error && !problem && message.error !== 'rate_limit') evidence.assistantError = message.error;
  if (!message.error && isLoginText(readSyntheticText(message)))
    evidence.accountProblem = createSignedOutProblem();
}

function describeProcessEnd(head: string) {
  const exit = PROCESS_EXIT.exec(head);
  if (exit) return `Claude Code stopped unexpectedly (exit code ${exit[1]}).`;
  const signal = PROCESS_SIGNAL.exec(head);
  if (signal) return `Claude Code was stopped by the system (${signal[1]}).`;
  return head;
}

export function cleanProcessError(text: string) {
  const at = text.indexOf(STDERR_MARK);
  if (at === -1) return describeProcessEnd(text);
  const kept = text
    .slice(at + STDERR_MARK.length)
    .split('\n')
    .filter((line) => line.trim() && !HOOK_NOISE.test(line));
  const head = describeProcessEnd(text.slice(0, at));
  return kept.length > 0 ? `${head} It printed: ${kept.join('\n')}` : head;
}

function listErrors(message: SDKResultMessage) {
  const errors = 'errors' in message && Array.isArray(message.errors) ? message.errors : [];
  return errors.filter((error) => typeof error === 'string' && !error.startsWith('[ede_diagnostic]'));
}

function resolveResultText(message: SDKResultMessage) {
  const text = message.subtype === 'success' ? message.result : '';
  return [text, ...listErrors(message)].join('\n').trim();
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

function resolveUsageLimitReset(evidence: TurnEvidence) {
  const times = [...evidence.rejectedLimits.values()];
  const limit = evidence.assistantLimit;
  if (limit && !evidence.rejectedLimits.has(limit.type)) times.push(limit.resetAt);
  if (times.length === 0 || times.some((time) => time === null)) return null;
  return Math.max(...(times as number[]));
}

function hasLimitEvidence(evidence: TurnEvidence) {
  return evidence.rejectedLimits.size > 0 || evidence.assistantLimit !== null;
}

function isUsageLimited(message: SDKResultMessage, evidence: TurnEvidence) {
  if (evidence.accountProblem || !hasLimitEvidence(evidence)) return false;
  const status = message.subtype === 'success' ? message.api_error_status : null;
  const statusFits = message.subtype !== 'success' || status == null || status === 429;
  const reason = message.terminal_reason;
  return statusFits && (reason == null || reason === 'api_error' || reason === 'blocking_limit');
}

function resolveGatewayLimit(message: SDKResultMessage, now: number) {
  if (message.subtype !== 'success' || !message.is_error || message.terminal_reason !== 'api_error')
    return null;
  if (message.api_error_status !== 503) return null;
  const match = GATEWAY_LIMIT.exec(message.result);
  if (!match) return null;
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return seconds > 0 ? now + seconds * 1000 : null;
}

function resolveTextLimit(text: string) {
  if (OUT_OF_CREDITS.test(text)) {
    return createFailure('usage_limit', 'The Claude account is out of usage credits.', 'out_of_credits', {
      retryable: true,
    });
  }
  const limit = LIMIT_TEXT.exec(text);
  if (!limit) return null;
  return createFailure('usage_limit', 'Claude’s usage limit is reached.', 'rate_limit', {
    retryable: true,
    resetAt: resolveResetAt(Number(limit[1])),
  });
}

function isLoginRequired(message: SDKResultMessage) {
  return isLoginText(resolveResultText(message));
}

function resolveApiFailure(message: SDKResultMessage, evidence: TurnEvidence, now: number) {
  const status = message.subtype === 'success' ? (message.api_error_status ?? null) : null;
  const code = status === null ? null : `api_error_${status}`;
  if (!evidence.accountProblem && isLoginRequired(message)) {
    return createFailure('auth', ACCOUNT_PROBLEMS.authentication_failed as string, 'login_required');
  }
  const gatewayReset = resolveGatewayLimit(message, now);
  if (gatewayReset !== null) {
    return createFailure('usage_limit', 'Claude’s API rate limit is reached.', 'api_error_429', {
      retryable: true,
      resetAt: gatewayReset,
    });
  }
  if (evidence.accountProblem)
    return createFailure('auth', evidence.accountProblem.message, evidence.accountProblem.code);
  if (status === 401) return createFailure('auth', ACCOUNT_PROBLEMS.authentication_failed as string, code);
  if (status === 429 || isUsageLimited(message, evidence)) {
    return createFailure('usage_limit', 'Claude’s usage limit is reached.', code ?? 'rate_limit', {
      retryable: true,
      resetAt: resolveUsageLimitReset(evidence),
    });
  }
  const textLimit = resolveTextLimit(resolveResultText(message));
  if (textLimit) return textLimit;
  if (status !== null && status >= 500 && status !== 529) {
    return createFailure(
      'overloaded',
      `Claude’s API had a server error (${status}).`,
      code ?? 'server_error',
      { retryable: true }
    );
  }
  if (status === 529 || evidence.assistantError === 'overloaded') {
    return createFailure('overloaded', 'Claude’s API is overloaded (529).', code ?? 'overloaded', {
      retryable: true,
    });
  }
  if (evidence.assistantError === 'model_not_found') {
    return createFailure(
      'model_error',
      'Claude does not know the model this step asked for.',
      'model_not_found'
    );
  }
  return null;
}

function resolveTextFailure(message: SDKResultMessage) {
  const text = resolveResultText(message);
  if (UNKNOWN_SESSION.test(text)) {
    return createFailure(
      'session_lost',
      'Claude no longer has the session this step tried to resume.',
      'unknown_session'
    );
  }
  if (message.subtype !== 'success' && message.startup_failure_reason) {
    return createFailure('setup_failed', text || 'Claude could not start.', message.startup_failure_reason);
  }
  return null;
}

function resolveDeclaredFailure(message: SDKResultMessage) {
  const reason = message.terminal_reason;
  const declared = (reason ? TERMINAL_FAILURES[reason] : undefined) ?? ERROR_SUBTYPES[message.subtype];
  if (!declared) return null;
  const text = message.subtype === 'success' ? message.result.trim() : '';
  const detail = reason === 'api_error' && text.startsWith('API Error:') ? text : declared.message;
  return createFailure(declared.class, detail, reason ?? message.subtype);
}

const FAILING_STATUSES = new Set([401, 429, 529]);

function isFailedResult(message: SDKResultMessage) {
  if (message.subtype !== 'success' || message.is_error) return true;
  if (FAILING_STATUSES.has(message.api_error_status ?? 0)) return true;
  return Boolean(message.terminal_reason && TERMINAL_FAILURES[message.terminal_reason]);
}

function isAborted(message: SDKResultMessage) {
  return message.terminal_reason === 'aborted_tools' || message.terminal_reason === 'aborted_streaming';
}

export function resolveClaudeVerdict(
  message: SDKResultMessage,
  evidence: TurnEvidence,
  now: number
): TurnVerdict {
  if (isAborted(message)) {
    return {
      status: 'interrupted',
      failure: createFailure(
        'aborted',
        'The agent’s turn was interrupted before it finished.',
        message.terminal_reason ?? null
      ),
    };
  }
  if (!isFailedResult(message) && !evidence.accountProblem) return { status: 'completed', failure: null };
  const errorText = listErrors(message).join('\n').toLowerCase();
  if (message.subtype !== 'success' && errorText.includes('interrupt')) {
    return {
      status: 'interrupted',
      failure: createFailure('aborted', 'The agent’s turn was interrupted.', message.subtype),
    };
  }
  const failure =
    resolveTextFailure(message) ??
    resolveApiFailure(message, evidence, now) ??
    resolveDeclaredFailure(message) ??
    createFailure(
      'provider_error',
      resolveResultText(message) || 'Claude stopped with an error.',
      message.subtype
    );
  return { status: 'failed', failure };
}

export function createTransportFailure(message: string): RunFailure {
  return createFailure('transport_error', message, 'stream_ended', { retryable: true });
}

export function resolveEndedFailure(text: string, evidence: TurnEvidence): RunFailure {
  if (evidence.accountProblem)
    return createFailure('auth', evidence.accountProblem.message, evidence.accountProblem.code);
  if (isLoginText(text))
    return createFailure('auth', ACCOUNT_PROBLEMS.authentication_failed as string, 'login_required');
  return createTransportFailure(text);
}

export function createSetupFailure(message: string): RunFailure {
  return createFailure('setup_failed', message, 'setup_failed');
}
