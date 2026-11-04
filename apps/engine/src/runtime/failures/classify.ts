import { Predicate } from 'effect';
import { describeShortFailure } from '../../git/remote/output.ts';
import { PushError } from '../../git/remote/schema.ts';
import { describeError } from '../../log/index.ts';
import {
  EffectFailed,
  type EffectFailure,
  NON_FAST_FORWARD,
  ShippingFailed,
  type ShippingStepKind,
} from './schema.ts';

function isEffectFailure(error: unknown): error is EffectFailure {
  return Predicate.isTagged(error, 'EffectFailed') || Predicate.isTagged(error, 'ShippingFailed');
}

export function resolveEffectFailure(error: unknown): EffectFailure {
  if (isEffectFailure(error)) return error;
  return createEffectFailed(describeError(error));
}

export function resolveShippingFailure(step: ShippingStepKind, error: unknown, networkDelayMs: number) {
  if (Predicate.isTagged(error, 'ShippingFailed')) return error as ShippingFailed;
  if (error instanceof PushError) {
    const message = error.kind === 'non_fast_forward' ? NON_FAST_FORWARD : describeError(error);
    const retryable = error.kind === 'network' || error.kind === 'other';
    const delayMs = error.kind === 'network' ? networkDelayMs : null;
    return new ShippingFailed({ step, message, detail: error.detail, retryable, delayMs });
  }
  const failure = resolveEffectFailure(error);
  return new ShippingFailed({
    step,
    message: failure.message,
    detail: describeShortFailure(failure.message),
    retryable: failure.retryable,
    delayMs: failure.delayMs,
  });
}

export function createEffectFailed(message: string) {
  return new EffectFailed({ message, detail: message, retryable: true, delayMs: null });
}

export function createFinalFailure(message: string) {
  return new EffectFailed({ message, detail: message, retryable: false, delayMs: null });
}
