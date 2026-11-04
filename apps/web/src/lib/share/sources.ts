import { Effect } from 'effect';
import { FetchHttpClient, HttpClient } from 'effect/http';
import { SHARED_TEXT_FAILED, SharedTextFailed } from './schema.ts';

export const SHARE_GONE =
  'This task is no longer shared, or the link is wrong. Ask whoever sent it for a new one.';

export class ShareGoneError extends Error {
  constructor(message = SHARE_GONE) {
    super(message);
    this.name = 'ShareGoneError';
  }
}

export const requestSharedText = Effect.fn('SharedText.request')(
  function* (url: string) {
    const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);
    const response = yield* client.get(url);
    return yield* response.text;
  },
  Effect.provideService(FetchHttpClient.RequestInit, { cache: 'no-store' }),
  Effect.mapError(() => new SharedTextFailed({ message: SHARED_TEXT_FAILED }))
);
