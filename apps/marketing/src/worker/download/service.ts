import { Context, Effect, Layer, Option, Schema } from 'effect';
import { Assets } from '../assets/service.ts';
import { Bucket } from '../bucket/service.ts';
import { answerBytes, answerUnsatisfiable } from '../bytes.ts';
import { EdgeCache } from '../cache/service.ts';
import { parseDownloadPointer } from '../releases/pointer.ts';
import { type Channel, DownloadPointer, type Product, SHINSA } from '../releases/schema.ts';
import { ReleaseFeed } from '../releases/service.ts';
import { resolveFallbackUrl, selectChannelVersion } from '../releases/versions.ts';
import {
  createDmgHeaders,
  resolvePrecondition,
  resolveRequestedRange,
  resolveValidators,
} from './conditions.ts';
import { resolveChannel, resolveChannelKey, resolvePointerCacheKey, resolveVersionChannel } from './paths.ts';
import { VERSION_HEADERS } from './schema.ts';

export class Downloads extends Context.Service<
  Downloads,
  { respond(request: Request): Effect.Effect<Response> }
>()('shinsa/marketing/worker/download/Downloads') {
  static readonly layer = Layer.effect(
    Downloads,
    Effect.gen(function* () {
      const bucket = yield* Bucket;
      const cache = yield* EdgeCache;
      const feed = yield* ReleaseFeed;
      const assets = yield* Assets;
      const decodePointerText = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

      const requestPointer = Effect.fn('Downloads.requestPointer')(function* (
        product: Product,
        channel: Channel
      ) {
        const object = yield* bucket.get(resolveChannelKey(channel, product), Option.none());
        if (Option.isNone(object)) return Option.none<DownloadPointer>();
        const value = yield* decodePointerText(yield* object.value.text);
        return Option.fromNullishOr(parseDownloadPointer(value));
      });

      const selectPointer = (product: Product, channel: Channel) =>
        cache.remember(
          resolvePointerCacheKey(channel, product),
          DownloadPointer,
          requestPointer(product, channel)
        );

      const resolveDownloadPointer = Effect.fn('Downloads.resolveDownloadPointer')(function* (
        product: Product,
        channel: Channel
      ) {
        const pointer = yield* selectPointer(product, channel);
        if (Option.isSome(pointer) || channel !== 'stable') return pointer;
        return yield* selectPointer(product, 'beta');
      });

      const streamPointer = Effect.fn('Downloads.streamPointer')(function* (
        request: Request,
        product: Product,
        pointer: DownloadPointer
      ) {
        const validators = resolveValidators(pointer);
        const headers = createDmgHeaders(product, pointer, validators);
        const precondition = resolvePrecondition(request.headers, validators);
        if (precondition) return Option.some(new Response(null, { status: precondition, headers }));
        const range = resolveRequestedRange(request, pointer, validators);
        if (range === 'unsatisfiable') return Option.some(answerUnsatisfiable(headers, pointer.size));
        if (request.method === 'HEAD') {
          const head = yield* bucket.head(pointer.key);
          return Option.map(head, () => answerBytes(headers, pointer.size, null, null));
        }
        const object = yield* bucket.get(pointer.key, Option.fromNullishOr(range));
        return Option.map(object, (found) => answerBytes(headers, pointer.size, range, found.body));
      });

      const streamFromBucket = (request: Request, product: Product, channel: Channel) =>
        resolveDownloadPointer(product, channel).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.succeedNone,
              onSome: (pointer) => streamPointer(request, product, pointer),
            })
          ),
          Effect.tapError((error) =>
            Effect.annotateLogs(Effect.logError('Download read from R2 failed'), {
              product: product.name,
              channel,
              error,
            })
          ),
          Effect.orElseSucceed(() => Option.none<Response>())
        );

      const selectPointerVersion = (channel: Channel) =>
        resolveDownloadPointer(SHINSA, channel).pipe(
          Effect.map(Option.map((pointer) => pointer.version)),
          Effect.orElseSucceed(() => Option.none<string>())
        );

      const respondVersion = Effect.fn('Downloads.respondVersion')(function* (channel: Channel) {
        const stored = yield* selectPointerVersion(channel);
        const version = yield* Option.match(stored, {
          onSome: (known) => Effect.succeed<string | null>(known),
          onNone: () => Effect.map(feed.listVersions, (tags) => selectChannelVersion(tags, channel)),
        });
        if (version === null)
          return new Response(`No ${channel} release yet\n`, { status: 404, headers: VERSION_HEADERS });
        return new Response(`${version}\n`, { status: 200, headers: VERSION_HEADERS });
      });

      const redirectToFallback = Effect.fn('Downloads.redirectToFallback')(function* (
        product: Product,
        channel: Channel
      ) {
        const location = yield* Option.match(product.comingSoonUrl, {
          onSome: Effect.succeed,
          onNone: () => Effect.map(feed.listVersions, (tags) => resolveFallbackUrl(tags, channel)),
        });
        return new Response(null, {
          status: 302,
          headers: { Location: location, 'Cache-Control': 'no-store' },
        });
      });

      const respond = Effect.fn('Downloads.respond')(function* (request: Request) {
        const { pathname } = new URL(request.url);
        const versionChannel = resolveVersionChannel(pathname);
        if (versionChannel) return yield* respondVersion(versionChannel);
        const target = resolveChannel(pathname);
        if (!target) return yield* assets.fetch(request);
        const download = yield* streamFromBucket(request, target.product, target.channel);
        if (Option.isSome(download)) return download.value;
        return yield* redirectToFallback(target.product, target.channel);
      });

      return Downloads.of({ respond });
    })
  );
}
