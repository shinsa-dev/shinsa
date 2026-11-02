import { Effect, Layer } from 'effect';
import { FetchHttpClient, HttpClient } from 'effect/http';
import { edgeRuntime } from '../runtime/edge.ts';
import { EXPIRED_DETAIL, type UsageRead } from './schema.ts';
import { parseRetryAfter } from './usage/answer.ts';
import { UsageApi } from './usage/service.ts';

export {
  listDistinctWindows,
  parseResetTime,
  parseUsageWindows,
  resolveClaudeFastMode,
  resolveWindowId,
} from './usage/answer.ts';
export { KEYED_WINDOWS, type KeyedWindow, PROVIDER_WINDOWS, USAGE_URL, type UsageRead } from './schema.ts';

export type UsageRequester = (url: string, init: RequestInit) => Promise<Response>;

export const EXPIRED_READ: UsageRead = {
  ok: false,
  reason: 'expired',
  detail: EXPIRED_DETAIL,
  retryAfterMs: null,
};

export function readRetryAfter(response: Response) {
  return parseRetryAfter(response.headers.get('retry-after'));
}

export function requestUsage(accessToken: string, requestHttp?: UsageRequester): Promise<UsageRead> {
  const read = UsageApi.use((usage) => usage.request(accessToken)).pipe(
    Effect.map((answer): UsageRead => ({ ok: true, ...answer })),
    Effect.catchTag('UsageReadFailed', (failed) =>
      Effect.succeed<UsageRead>({
        ok: false,
        reason: failed.reason,
        detail: failed.detail,
        retryAfterMs: failed.retryAfterMs,
      })
    )
  );
  if (!requestHttp) return edgeRuntime.runPromise(read);
  const client = UsageApi.layer.pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Layer.succeed(HttpClient.TracerPropagationEnabled, false)),
    Layer.provide(
      Layer.succeed(
        FetchHttpClient.Fetch,
        Object.assign(
          (url: string | URL | Request, init?: RequestInit) => requestHttp(String(url), init ?? {}),
          {
            preconnect: fetch.preconnect,
          }
        )
      )
    )
  );
  return Effect.runPromise(read.pipe(Effect.provide(client)));
}
