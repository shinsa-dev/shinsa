import { Context, Effect, Schema } from 'effect';

export class WebhookDeliveryFailed extends Schema.TaggedError<
  WebhookDeliveryFailed,
  { readonly brand: unique symbol }
>()('WebhookDeliveryFailed', { message: Schema.String }) {}

export const WebhookDeliveryId = Context.Reference<Effect.Effect<string>>(
  'shinsa/engine/schedules/webhook/WebhookDeliveryId',
  { defaultValue: () => Effect.sync(() => Bun.randomUUIDv7()) }
);
