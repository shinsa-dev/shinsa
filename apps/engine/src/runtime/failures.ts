import type { ShippingStepKind } from '@shinsa/core';
import { describeShortFailure, PushError, type PushFailureKind } from '../git/push.ts';
import { describeError } from '../log/index.ts';

export interface EffectRetryPolicy {
  retryable: boolean;
  delayMs: number | null;
}

const NON_FAST_FORWARD =
  'The branch on the remote has commits this branch does not have, so Git refused the push. Someone pushed to it, or GitHub updated it from its base. Bring those commits into the task’s branch, then retry.';

const DEFAULT_POLICY: EffectRetryPolicy = { retryable: true, delayMs: null };

const FINAL_POLICY: EffectRetryPolicy = { retryable: false, delayMs: null };

export class EffectError extends Error {
  readonly detail: string;
  readonly policy: EffectRetryPolicy;

  constructor(message: string, detail: string, policy: EffectRetryPolicy) {
    super(message);
    this.detail = detail;
    this.policy = policy;
  }
}

function resolvePushPolicy(kind: PushFailureKind, networkDelayMs: number): EffectRetryPolicy {
  if (kind === 'network') return { retryable: true, delayMs: networkDelayMs };
  return kind === 'other' ? DEFAULT_POLICY : FINAL_POLICY;
}

export class ShippingError extends EffectError {
  readonly step: ShippingStepKind;

  constructor(step: ShippingStepKind, error: unknown, networkDelayMs: number) {
    const push = error instanceof PushError ? error : null;
    const message = push?.kind === 'non_fast_forward' ? NON_FAST_FORWARD : describeError(error);
    super(
      message,
      push?.detail ?? describeShortFailure(message),
      push ? resolvePushPolicy(push.kind, networkDelayMs) : DEFAULT_POLICY
    );
    this.step = step;
  }
}

export function resolveRetryPolicy(error: unknown) {
  return error instanceof EffectError ? error.policy : DEFAULT_POLICY;
}

export function resolveShippingError(step: ShippingStepKind, error: unknown, networkDelayMs: number) {
  return error instanceof ShippingError ? error : new ShippingError(step, error, networkDelayMs);
}
