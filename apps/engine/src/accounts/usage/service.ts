import { Context, Duration, Effect, Layer, Schema } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';
import { describeError } from '../../log/redact.ts';
import {
  EXPIRED_DETAIL,
  TOO_MANY_REQUESTS,
  UNAUTHORIZED,
  type UsageAnswer,
  UsageBodyText,
  USAGE_HEADERS,
  USAGE_TIMEOUT,
  USAGE_URL,
  UsageReadFailed,
} from '../schema.ts';
import { parseRetryAfter, parseUsageWindows, resolveClaudeFastMode } from './answer.ts';

export class UsageApi extends Context.Service<
  UsageApi,
  { request(accessToken: string): Effect.Effect<UsageAnswer, UsageReadFailed> }
>()('shinsa/engine/accounts/usage/UsageApi') {
  static readonly layer = Layer.effect(
    UsageApi,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const decodeText = Schema.decodeUnknownEffect(UsageBodyText);
      const failed = (detail: string) =>
        new UsageReadFailed({ reason: 'failed', detail, retryAfterMs: null });

      const request = Effect.fn('UsageApi.request')(function* (accessToken: string) {
        const response = yield* HttpClientRequest.get(USAGE_URL).pipe(
          HttpClientRequest.bearerToken(accessToken),
          HttpClientRequest.setHeaders(USAGE_HEADERS),
          client.execute,
          Effect.timeoutOrElse({
            duration: USAGE_TIMEOUT,
            orElse: () =>
              Effect.fail(
                failed(`Could not reach Claude: no answer within ${Duration.format(USAGE_TIMEOUT)}.`)
              ),
          }),
          Effect.catchTag('HttpClientError', (error) =>
            Effect.fail(failed(`Could not reach Claude: ${describeError(error.reason.cause ?? error)}`))
          )
        );
        if (response.status === UNAUTHORIZED) {
          return yield* new UsageReadFailed({
            reason: 'expired',
            detail: EXPIRED_DETAIL,
            retryAfterMs: null,
          });
        }
        if (response.status === TOO_MANY_REQUESTS) {
          return yield* new UsageReadFailed({
            reason: 'limited',
            detail: 'Rate limited by Claude.',
            retryAfterMs: parseRetryAfter(response.headers['retry-after']),
          });
        }
        if (response.status < 200 || response.status >= 300) {
          return yield* failed(`Claude answered ${response.status}.`);
        }
        const body = yield* response.text.pipe(
          Effect.flatMap(decodeText),
          Effect.mapError((error) => failed(`Claude’s answer could not be read: ${error.message}`))
        );
        return {
          windows: parseUsageWindows(body),
          fastMode: resolveClaudeFastMode(body),
        } satisfies UsageAnswer;
      });

      return UsageApi.of({ request });
    })
  );
}
