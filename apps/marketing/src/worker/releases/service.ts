import { Context, Effect, Layer, Option } from 'effect';
import { HttpClient, HttpClientRequest } from 'effect/http';
import { EdgeCache } from '../cache/service.ts';
import { FEED_CACHE_KEY, FEED_HEADERS, FeedVersions, RELEASES_FEED } from './schema.ts';
import { listFeedVersions } from './versions.ts';

export class ReleaseFeed extends Context.Service<
  ReleaseFeed,
  { readonly listVersions: Effect.Effect<ReadonlyArray<string>> }
>()('shinsa/marketing/worker/releases/ReleaseFeed') {
  static readonly layer = Layer.effect(
    ReleaseFeed,
    Effect.gen(function* () {
      const cache = yield* EdgeCache;
      const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);

      const requestVersions = Effect.gen(function* () {
        const response = yield* client.execute(
          HttpClientRequest.get(RELEASES_FEED).pipe(HttpClientRequest.setHeaders(FEED_HEADERS))
        );
        const tags = listFeedVersions(yield* response.text);
        return tags.length > 0 ? Option.some(tags) : Option.none();
      });

      const listVersions = cache.remember(FEED_CACHE_KEY, FeedVersions, requestVersions).pipe(
        Effect.map(Option.getOrElse((): ReadonlyArray<string> => [])),
        Effect.orElseSucceed((): ReadonlyArray<string> => [])
      );

      return ReleaseFeed.of({ listVersions });
    })
  );
}
