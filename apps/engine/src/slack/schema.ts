import type { DomainError, MachineCredentials, ShinsaEffect, TaskOwner } from '@shinsa/core';
import type {
  NotFound,
  PostNotYours,
  Revoked,
  SlackBlocksRefused,
  SlackFailed,
  SlackNotInstalled,
  SlackNotLinked,
} from '@shinsa/core/remote/errors';
import { Context, Duration, Schema } from 'effect';
import type { Effect } from 'effect';
import type { RemoteUnreachable } from '../remote/client/schema.ts';
import type { EngineStopped } from '../runtime/engine/schema.ts';
import { WEBHOOK_RATE_LIMIT_PER_MINUTE } from '../schedules/schema.ts';

export const SLACK_EVENT_BODY_LIMIT_BYTES = 1024 * 1024;

export const SlackBodyText = Schema.fromJsonString(Schema.Unknown);

export type SlackEffect<Kind extends ShinsaEffect['kind']> = Extract<ShinsaEffect, { kind: Kind }>;

export interface SlackInput {
  readonly credentials: Effect.Effect<MachineCredentials | null>;
  readonly appOrigin: string;
  readonly resolveActor: (userId: string) => Effect.Effect<TaskOwner | null>;
  readonly isOwner: (userId: string) => Effect.Effect<boolean>;
}

export const SLACK_MESSAGE_RATE_LIMITED = `More than ${WEBHOOK_RATE_LIMIT_PER_MINUTE} messages a minute were posted, so the rest of this minute's were skipped.`;

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

export type SlackNotifyRefusal =
  | NotFound
  | Revoked
  | SlackNotLinked
  | SlackNotInstalled
  | PostNotYours
  | SlackBlocksRefused;

export const SLACK_REMOTE_OFF_PROBLEM = 'Remote access is off, so Shinsa cannot reach Slack.';

export const SLACK_UNREACHABLE_PROBLEM = 'app.shinsa.dev could not be reached.';

export type SlackLinksFailure = DomainError | NotFound | RemoteUnreachable | Revoked;
