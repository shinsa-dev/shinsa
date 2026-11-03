import type { DomainError, ShinsaCommand, ShinsaEvent, ShinsaState } from '@shinsa/core';
import { Schema } from 'effect';
import type { Effect } from 'effect';
import type { WebhookCredentials } from '../../secrets/schema.ts';

export class WebhookDeliveryFailed extends Schema.TaggedError<
  WebhookDeliveryFailed,
  { readonly brand: unique symbol }
>()('WebhookDeliveryFailed', { message: Schema.String }) {}

export interface WebhookDefinition {
  readonly state: Effect.Effect<ShinsaState>;
  readonly selectHook: (scheduleId: string) => Effect.Effect<WebhookCredentials | null>;
  readonly now: Effect.Effect<number>;
  readonly newId: Effect.Effect<string>;
  readonly frameId: Effect.Effect<string>;
  readonly dispatch: (
    command: ShinsaCommand,
    id: string
  ) => Effect.Effect<ShinsaEvent[], DomainError | WebhookDeliveryFailed>;
}

export interface WebhookHandle {
  readonly handle: (request: Request, url: URL) => Effect.Effect<Response>;
}
