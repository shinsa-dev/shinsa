import { Duration, Schema } from 'effect';

export const OAUTH_COOKIE = '__Host-shinsa_oauth';

export const OAUTH_TTL = Duration.minutes(10);

export const SIGN_IN_CODE_TTL = Duration.minutes(1);

export const NATIVE_REDIRECT_LIMIT = 200;

export const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize';

export const NativeSignIn = Schema.Struct({ redirect: Schema.String, challenge: Schema.String });

export type NativeSignIn = typeof NativeSignIn.Type;

const OAuthState = Schema.Struct({
  state: Schema.String,
  verifier: Schema.String,
  returnPath: Schema.optional(Schema.String),
  native: Schema.optional(Schema.NullOr(NativeSignIn)),
});

export const OAuthCookie = Schema.fromJsonString(OAuthState);
