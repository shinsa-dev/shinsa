import type { RemoteUser } from '@shinsa/core';
import { SignInFailed } from '@shinsa/core/remote/errors';
import { Context, Effect, Layer, Redacted, type Schema } from 'effect';
import { HttpClient, type HttpClientError, HttpClientRequest, HttpClientResponse } from 'effect/http';
import { CloudConfig } from '../../config/service.ts';
import {
  GITHUB_TOKEN_URL,
  GITHUB_USER_URL,
  GitHubUser,
  TOKEN_REFUSED,
  TokenAnswer,
  USER_REFUSED,
} from './schema.ts';

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

      const requestToken = (code: string, verifier: Redacted.Redacted<string>) =>
        HttpClientRequest.post(GITHUB_TOKEN_URL).pipe(
          HttpClientRequest.bodyJsonUnsafe({
            client_id: config.githubClientId,
            client_secret: Redacted.value(config.githubClientSecret),
            code,
            code_verifier: Redacted.value(verifier),
            redirect_uri: config.signInCallbackUrl,
          }),
          client.execute,
          Effect.flatMap(HttpClientResponse.schemaBodyJson(TokenAnswer)),
          refuseWith(TOKEN_REFUSED)
        );

      const requestUser = (token: string) =>
        HttpClientRequest.get(GITHUB_USER_URL).pipe(
          HttpClientRequest.bearerToken(token),
          HttpClientRequest.setHeaders({
            accept: 'application/vnd.github+json',
            'user-agent': 'shinsa-cloud',
          }),
          client.execute,
          Effect.flatMap(HttpClientResponse.schemaBodyJson(GitHubUser)),
          refuseWith(USER_REFUSED)
        );

      const signIn = Effect.fn('GitHub.signIn')(function* (
        code: string,
        verifier: Redacted.Redacted<string>
      ) {
        const token = yield* requestToken(code, verifier);
        return yield* requestUser(token.access_token);
      });

      return GitHub.of({ signIn });
    })
  );
}
