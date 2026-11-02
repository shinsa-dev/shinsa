import { type Redacted, Schema } from 'effect';

export const SLACK_API_ORIGIN = 'https://slack.com/api';

export const SLACK_JSON = 'application/json; charset=utf-8';

export const SLACK_BOT_SCOPES = [
  'app_mentions:read',
  'channels:history',
  'groups:history',
  'chat:write',
  'reactions:write',
  'users:read',
] as const;

export class SlackCallFailed extends Schema.TaggedError<SlackCallFailed>()('SlackCallFailed', {
  method: Schema.String,
  code: Schema.String,
}) {}

export type SlackBody =
  | { readonly form: Readonly<Record<string, string>> }
  | { readonly json: Readonly<Record<string, unknown>> }
  | { readonly empty: true };

export interface SlackCall {
  readonly token?: Redacted.Redacted<string>;
  readonly body: SlackBody;
}

export const Envelope = Schema.Struct({ ok: Schema.Boolean, error: Schema.optional(Schema.String) });

const NonEmpty = Schema.optional(Schema.NullOr(Schema.String));

export const UserInfo = Schema.Struct({
  user: Schema.Struct({
    name: NonEmpty,
    profile: Schema.optional(Schema.Struct({ display_name: NonEmpty, real_name: NonEmpty })),
  }),
});
