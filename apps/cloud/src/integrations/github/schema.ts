import { RemoteUser } from '@shinsa/core';
import { Schema, SchemaTransformation } from 'effect';

export const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

export const GITHUB_USER_URL = 'https://api.github.com/user';

export const TOKEN_REFUSED = 'GitHub did not accept the sign-in. Try again.';

export const USER_REFUSED = 'GitHub did not say who you are. Try again.';

export const TokenAnswer = Schema.Struct({ access_token: Schema.NonEmptyString });

const UserAnswer = Schema.Struct({
  id: Schema.Int,
  login: Schema.NonEmptyString,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  avatar_url: Schema.optional(Schema.NullOr(Schema.String)),
});

export const GitHubUser = UserAnswer.pipe(
  Schema.decodeTo(
    RemoteUser,
    SchemaTransformation.transform({
      decode: (answer) => ({
        id: String(answer.id),
        login: answer.login,
        name: answer.name ? answer.name : null,
        avatarUrl: answer.avatar_url ?? null,
      }),
      encode: (user) => ({
        id: Number(user.id),
        login: user.login,
        name: user.name,
        avatar_url: user.avatarUrl,
      }),
    })
  )
);
