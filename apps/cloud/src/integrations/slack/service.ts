import { Context, Effect, Layer, Option, type Redacted, Schema } from 'effect';
import { HttpBody, HttpClient, HttpClientRequest } from 'effect/http';
import {
  decodeEnvelope,
  SLACK_API_ORIGIN,
  SLACK_BOT_SCOPES,
  SLACK_JSON,
  type SlackBody,
  type SlackCall,
  SlackCallFailed,
  UserInfo,
} from './schema.ts';

export class SlackApi extends Context.Service<
  SlackApi,
  {
    call<A, I>(
      method: string,
      call: SlackCall,
      Answer: Schema.Codec<A, I>
    ): Effect.Effect<A, SlackCallFailed>;
    selectUserName(token: Redacted.Redacted<string>, userId: string): Effect.Effect<Option.Option<string>>;
    hasBotScopes(token: Redacted.Redacted<string>): Effect.Effect<boolean>;
  }
>()('shinsa/cloud/integrations/SlackApi') {
  static readonly layer = Layer.effect(
    SlackApi,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;

      const resolveBody = (body: SlackBody) => {
        if ('form' in body) return HttpBody.urlParams(new URLSearchParams({ ...body.form }));
        if ('json' in body) return HttpBody.text(JSON.stringify(body.json), SLACK_JSON);
        return HttpBody.empty;
      };

      const resolveUserName = ({ user }: typeof UserInfo.Type) =>
        Option.firstSomeOf(
          [user.profile?.display_name, user.profile?.real_name, user.name].map((name) =>
            Option.fromNullishOr(name || null)
          )
        );

      const send = (method: string, call: SlackCall) => {
        const request = HttpClientRequest.post(`${SLACK_API_ORIGIN}/${method}`).pipe(
          HttpClientRequest.setBody(resolveBody(call.body))
        );
        return client.execute(call.token ? HttpClientRequest.bearerToken(request, call.token) : request);
      };

      const callSlack = Effect.fn('SlackApi.call')(function* <A, I>(
        method: string,
        call: SlackCall,
        Answer: Schema.Codec<A, I>
      ) {
        const response = yield* send(method, call).pipe(
          Effect.mapError(() => new SlackCallFailed({ method, code: 'unreachable' }))
        );
        const fields = yield* Effect.orElseSucceed(response.json, () => null);
        const envelope = decodeEnvelope(fields);
        if (Option.isNone(envelope) || !envelope.value.ok)
          return yield* new SlackCallFailed({
            method,
            code: Option.flatMapNullishOr(envelope, (answer) => answer.error).pipe(
              Option.getOrElse(() => 'failed')
            ),
          });
        return yield* Schema.decodeUnknownEffect(Answer)(fields).pipe(
          Effect.mapError(() => new SlackCallFailed({ method, code: 'unexpected_answer' }))
        );
      });

      const selectUserName = Effect.fn('SlackApi.selectUserName')(
        (token: Redacted.Redacted<string>, userId: string) =>
          callSlack('users.info', { token, body: { form: { user: userId } } }, UserInfo).pipe(
            Effect.map(resolveUserName),
            Effect.orElseSucceed(() => Option.none<string>())
          )
      );

      const hasBotScopes = Effect.fn('SlackApi.hasBotScopes')(function* (token: Redacted.Redacted<string>) {
        const response = yield* Effect.option(send('auth.test', { token, body: { empty: true } }));
        if (Option.isNone(response)) return true;
        const granted = response.value.headers['x-oauth-scopes'];
        if (granted === undefined) return true;
        const scopes = new Set(granted.split(',').map((scope) => scope.trim()));
        return SLACK_BOT_SCOPES.every((scope) => scopes.has(scope));
      });

      return SlackApi.of({ call: callSlack, selectUserName, hasBotScopes });
    })
  );
}
