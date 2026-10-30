import { type AppService, isAppPath, respondApp } from './app.ts';
import { type DownloadBucket, type DownloadCache, respond } from './download.ts';
import { isOpenPage, respondOpen } from './open.ts';

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  DOWNLOADS?: DownloadBucket;
  CLOUD?: AppService;
}

function selectEdgeCache(): DownloadCache | null {
  if (!('default' in caches)) return null;
  return (caches as CacheStorage & { default: Cache }).default;
}

export default {
  fetch: (request: Request, env: Env) => {
    const { pathname } = new URL(request.url);
    if (isAppPath(pathname)) return respondApp(request, env.CLOUD ?? null);
    if (isOpenPage(pathname)) return respondOpen(request, (open) => env.ASSETS.fetch(open));
    return respond(request, {
      bucket: env.DOWNLOADS ?? null,
      fetch: (url, init) => fetch(url, init),
      cache: selectEdgeCache(),
      assets: (assetRequest) => env.ASSETS.fetch(assetRequest),
    });
  },
};
