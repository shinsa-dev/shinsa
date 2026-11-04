import { Context, Effect, Layer, Option } from 'effect';
import { Bucket } from '../bucket/service.ts';
import { answerBytes, answerUnsatisfiable, parseRange } from '../bytes.ts';
import { resolveUpdateFile } from './files.ts';
import type { UpdateFile } from './schema.ts';

export class Updates extends Context.Service<
  Updates,
  { respond(request: Request): Effect.Effect<Response> }
>()('shinsa/marketing/worker/updates/Updates') {
  static readonly layer = Layer.effect(
    Updates,
    Effect.gen(function* () {
      const bucket = yield* Bucket;

      const answerStatus = (status: number, headers: Record<string, string> = {}) =>
        new Response(null, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

      const streamUpdateFile = Effect.fn('Updates.streamUpdateFile')(function* (
        request: Request,
        file: UpdateFile
      ) {
        const head = yield* bucket.head(file.key);
        if (Option.isNone(head)) return answerStatus(404);
        const object = head.value;
        const headers = new Headers({
          'Content-Type': file.contentType,
          'Cache-Control': file.cacheControl,
          'Accept-Ranges': 'bytes',
          'X-Content-Type-Options': 'nosniff',
          ETag: object.httpEtag,
          'Last-Modified': object.uploaded.toUTCString(),
        });
        const header = request.headers.get('range');
        const range = request.method === 'GET' && header !== null ? parseRange(header, object.size) : null;
        if (range === 'unsatisfiable') return answerUnsatisfiable(headers, object.size);
        if (request.method === 'HEAD') return answerBytes(headers, object.size, null, null);
        const read = yield* bucket.get(file.key, Option.fromNullishOr(range));
        if (Option.isNone(read)) return answerStatus(404);
        return answerBytes(headers, object.size, range, read.value.body);
      });

      const respond = Effect.fn('Updates.respond')(function* (request: Request) {
        if (request.method !== 'GET' && request.method !== 'HEAD')
          return answerStatus(405, { Allow: 'GET, HEAD' });
        const file = resolveUpdateFile(new URL(request.url).pathname);
        if (!file) return answerStatus(404);
        return yield* streamUpdateFile(request, file).pipe(
          Effect.catchTags({
            BucketUnbound: () =>
              Effect.as(
                Effect.annotateLogs(Effect.logError('Update files have no R2 binding'), { key: file.key }),
                answerStatus(503)
              ),
            BucketFailed: (failure) =>
              Effect.as(
                Effect.annotateLogs(Effect.logError('Update file read from R2 failed'), {
                  key: file.key,
                  error: failure.error,
                }),
                answerStatus(503)
              ),
          })
        );
      });

      return Updates.of({ respond });
    })
  );
}
