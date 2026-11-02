import { Duration, Schema } from 'effect';

export const SLACK_USER_SCOPES = ['openid', 'profile'] as const;

export const SLACK_COOKIE = '__Host-shinsa_slack';

export const SLACK_COOKIE_TTL = Duration.minutes(10);

export const SLACK_CONNECT_AUTHORIZE = 'https://slack.com/openid/connect/authorize';

export const SLACK_INSTALL_AUTHORIZE = 'https://slack.com/oauth/v2/authorize';

const Text = Schema.optional(Schema.String);

export const TokenAnswer = Schema.Struct({ access_token: Text });

export const IdentityAnswer = Schema.Struct({
  'https://slack.com/team_id': Text,
  'https://slack.com/user_id': Text,
  'https://slack.com/team_name': Text,
  name: Text,
});

export const InstallAnswer = Schema.Struct({
  access_token: Text,
  bot_user_id: Text,
  team: Schema.optional(Schema.Struct({ id: Text, name: Text })),
  authed_user: Schema.optional(Schema.Struct({ id: Text })),
});

export interface SlackIdentity {
  readonly teamId: string;
  readonly teamName: string;
  readonly userId: string;
  readonly userName: string;
}
