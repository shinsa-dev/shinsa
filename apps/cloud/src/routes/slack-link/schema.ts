import { Duration, type Redacted, Schema } from 'effect';

export const SLACK_USER_SCOPES = [
  'channels:history',
  'groups:history',
  'channels:read',
  'groups:read',
] as const;

export const SLACK_COOKIE = '__Host-shinsa_slack';

export const SLACK_COOKIE_TTL = Duration.minutes(10);

export const SLACK_AUTHORIZE = 'https://slack.com/oauth/v2/authorize';

const Text = Schema.optional(Schema.String);

export const OAuthAnswer = Schema.Struct({
  access_token: Text,
  bot_user_id: Text,
  team: Schema.optional(Schema.Struct({ id: Text, name: Text })),
  authed_user: Schema.optional(Schema.Struct({ id: Text, access_token: Text })),
});

export interface SlackIdentity {
  readonly teamId: string;
  readonly teamName: string;
  readonly userId: string;
  readonly userName: string;
  readonly userToken: Redacted.Redacted<string>;
}
