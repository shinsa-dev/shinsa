import { REMOTE_PATHS, type RemoteUser } from '@shinsa/core';
import { SignInFailed } from '@shinsa/core/remote/errors';
import { Context, Effect, Layer, Redacted, Schema } from 'effect';
import { HttpClient, type HttpClientError, HttpClientRequest, HttpClientResponse } from 'effect/http';
import { CloudConfig } from '../config/config.ts';

const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

const GITHUB_USER_URL = 'https://api.github.com/user';

const TokenAnswer = Schema.Struct({ access_token: Schema.NonEmptyString });

const UserAnswer = Schema.Struct({
  id: Schema.Int,
  login: Schema.NonEmptyString,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  avatar_url: Schema.optional(Schema.NullOr(Schema.String)),
});

const resolveUser = (answer: typeof UserAnswer.Type): RemoteUser => ({
  id: String(answer.id),
  login: answer.login,
  name: answer.name ? answer.name : null,
  avatarUrl: answer.avatar_url ?? null,
});

const refuseWith =
  (message: string) =>
  <A, R>(effect: Effect.Effect<A, HttpClientError.HttpClientError | Schema.SchemaError, R>) =>
    effect.pipe(
      Effect.catchTags({
        HttpClientError: (error) =>
          error.reason._tag === 'TransportError'
            ? Effect.die(error)
            : Effect.fail(new SignInFailed({ message })),
        SchemaError: () => Effect.fail(new SignInFailed({ message })),
      })
    );

export class GitHub extends Context.Service<
  GitHub,
  {
    signIn(code: string, verifier: Redacted.Redacted<string>): Effect.Effect<RemoteUser, SignInFailed>;
  }
>()('shinsa/cloud/integrations/GitHub') {
  static readonly layer = Layer.effect(
    GitHub,
    Effect.gen(function* () {
      const config = yield* CloudConfig;
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(HttpClientRequest.acceptJson),
        HttpClient.filterStatusOk
      );

      const requestToken = (code: string, verifier: Redacted.Redacted<string>) =>
        HttpClientRequest.post(GITHUB_TOKEN_URL).pipe(
          HttpClientRequest.bodyJsonUnsafe({
            client_id: config.githubClientId,
            client_secret: Redacted.value(config.githubClientSecret),
            code,
            code_verifier: Redacted.value(verifier),
            redirect_uri: `${config.origin}${REMOTE_PATHS.signInCallback}`,
          }),
          client.execute,
          Effect.flatMap(HttpClientResponse.schemaBodyJson(TokenAnswer)),
          refuseWith('GitHub did not accept the sign-in. Try again.')
        );

      const requestUser = (token: string) =>
        HttpClientRequest.get(GITHUB_USER_URL).pipe(
          HttpClientRequest.bearerToken(token),
          HttpClientRequest.setHeaders({
            accept: 'application/vnd.github+json',
            'user-agent': 'shinsa-cloud',
          }),
          client.execute,
          Effect.flatMap(HttpClientResponse.schemaBodyJson(UserAnswer)),
          refuseWith('GitHub did not say who you are. Try again.')
        );

      const signIn = Effect.fn('GitHub.signIn')(function* (
        code: string,
        verifier: Redacted.Redacted<string>
      ) {
        const token = yield* requestToken(code, verifier);
        return resolveUser(yield* requestUser(token.access_token));
      });

      return GitHub.of({ signIn });
    })
  );
}
