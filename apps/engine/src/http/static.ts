import { join } from 'node:path';
import { Effect, Option } from 'effect';
import { HttpServerResponse } from 'effect/http';
import { selectInside } from '../files/inside.ts';
import { isFile } from '../files/probe.ts';

const NOT_BUILT = 'Shinsa web app is not built. Run `bun run build` or `bun dev`.';

const HASHED_ASSETS = '/assets/';

const IMMUTABLE = { 'Cache-Control': 'public, max-age=31536000, immutable' };

const REVALIDATE = { 'Cache-Control': 'no-cache' };

export const serveStatic = Effect.fn('Http.serveStatic')(function* (webDir: string, pathname: string) {
  const path = Option.getOrNull(yield* selectInside(webDir, `.${pathname}`));
  if (path && (yield* isFile(path)))
    return yield* HttpServerResponse.file(path, {
      headers: pathname.startsWith(HASHED_ASSETS) ? IMMUTABLE : REVALIDATE,
    });
  const index = join(webDir, 'index.html');
  if (yield* isFile(index)) return yield* HttpServerResponse.file(index, { headers: REVALIDATE });
  return HttpServerResponse.text(NOT_BUILT, { status: 503 });
}, Effect.orDie);
