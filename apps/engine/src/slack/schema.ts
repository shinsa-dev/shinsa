import type { DomainError, MachineCredentials, ShinsaEffect, TaskOwner } from '@shinsa/core';
import type { NotFound, Revoked, SlackFailed } from '@shinsa/core/remote/errors';
import { Context, Duration, Schema } from 'effect';
import type { Effect } from 'effect';
import type { RemoteUnreachable } from '../remote/client/schema.ts';
import type { EngineStopped } from '../runtime/engine/schema.ts';

export const SLACK_EVENT_BODY_LIMIT_BYTES = 1024 * 1024;

export const SlackBodyText = Schema.fromJsonString(Schema.Unknown);

export type SlackEffect<Kind extends ShinsaEffect['kind']> = Extract<ShinsaEffect, { kind: Kind }>;

export interface SlackInput {
  readonly credentials: Effect.Effect<MachineCredentials | null>;
  readonly appOrigin: string;
  readonly resolveActor: (userId: string) => Effect.Effect<TaskOwner | null>;
}

export const SlackStatusInterval = Context.Reference<Duration.Duration>(
  'shinsa/engine/slack/SlackStatusInterval',
  {
    defaultValue: () => Duration.seconds(5),
  }
);

export class SlackRequestUnreadable extends Schema.TaggedError<
  SlackRequestUnreadable,
  { readonly brand: unique symbol }
>()('SlackRequestUnreadable', { message: Schema.String }) {}

export type SlackRefusal = DomainError | EngineStopped;

export type SlackRelayFailure = RemoteUnreachable | SlackFailed;

export type SlackLinksFailure = DomainError | NotFound | RemoteUnreachable | Revoked;
