import { type AppService, isAppPath, respondApp } from './app.ts';
import { type DownloadBucket, type DownloadCache, respond } from './download.ts';

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
    if (isAppPath(new URL(request.url).pathname)) return respondApp(request, env.CLOUD ?? null);
    return respond(request, {
      bucket: env.DOWNLOADS ?? null,
      fetch: (url, init) => fetch(url, init),
      cache: selectEdgeCache(),
      assets: (assetRequest) => env.ASSETS.fetch(assetRequest),
    });
  },
};
