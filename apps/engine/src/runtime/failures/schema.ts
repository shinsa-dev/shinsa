import { Duration, Effect, Schedule, Schema } from 'effect';

export const ShippingStepKind = Schema.Literals(['updating', 'pushing', 'opening']);
export type ShippingStepKind = typeof ShippingStepKind.Type;

export class EffectFailed extends Schema.TaggedError<EffectFailed, { readonly brand: unique symbol }>()(
  'EffectFailed',
  {
    message: Schema.String,
    detail: Schema.String,
    retryable: Schema.Boolean,
    delayMs: Schema.NullOr(Schema.Number),
  }
) {}

export class ShippingFailed extends Schema.TaggedError<ShippingFailed, { readonly brand: unique symbol }>()(
  'ShippingFailed',
  {
    step: ShippingStepKind,
    message: Schema.String,
    detail: Schema.String,
    retryable: Schema.Boolean,
    delayMs: Schema.NullOr(Schema.Number),
  }
) {}

export type EffectFailure = EffectFailed | ShippingFailed;

export interface EffectRetryInput {
  readonly failure: EffectFailure;
  readonly processBound: boolean;
}

export const MAX_EFFECT_ATTEMPTS = 5;

const FIRST_EFFECT_BACKOFF = Duration.millis(100);

const MAX_EFFECT_BACKOFF = Duration.seconds(30);

export const NON_FAST_FORWARD =
  'The branch on the remote has commits this branch does not have, so Git refused the push. Someone pushed to it, or GitHub updated it from its base. Bring those commits into the task’s branch, then retry.';

export const EFFECT_BACKOFF = Schedule.min([
  Schedule.exponential(FIRST_EFFECT_BACKOFF),
  Schedule.spaced(MAX_EFFECT_BACKOFF),
]);

export const EFFECT_RETRY = EFFECT_BACKOFF.pipe(
  Schedule.setInputType<EffectRetryInput>(),
  Schedule.while(
    ({ input, attempt }) => attempt < MAX_EFFECT_ATTEMPTS && input.failure.retryable && !input.processBound
  ),
  Schedule.modifyDelay(({ input, duration }) =>
    Effect.succeed(input.failure.delayMs === null ? duration : Duration.millis(input.failure.delayMs))
  )
);
