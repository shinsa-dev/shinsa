import { join } from 'node:path';
import { Effect } from 'effect';
import { resolveInside } from '../files/paths.ts';

const NOT_BUILT = 'Shinsa web app is not built. Run `bun run build` or `bun dev`.';

const HASHED_ASSETS = '/assets/';

const IMMUTABLE = { 'Cache-Control': 'public, max-age=31536000, immutable' };

const REVALIDATE = { 'Cache-Control': 'no-cache' };

export const serveStatic = Effect.fn('Http.serveStatic')(function* (webDir: string, pathname: string) {
  const path = pathname === '/' ? null : resolveInside(webDir, `.${pathname}`);
  const file = path ? Bun.file(path) : null;
  if (file && (yield* Effect.promise(() => file.exists())))
    return new Response(file, { headers: pathname.startsWith(HASHED_ASSETS) ? IMMUTABLE : REVALIDATE });
  const index = Bun.file(join(webDir, 'index.html'));
  if (yield* Effect.promise(() => index.exists())) return new Response(index, { headers: REVALIDATE });
  return new Response(NOT_BUILT, { status: 503 });
});
