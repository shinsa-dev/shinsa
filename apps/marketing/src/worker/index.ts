import { type DownloadBucket, type DownloadCache, respond } from './download.ts';
import { isOpenPage, respondOpen } from './open.ts';
import { isUpdatePath, respondUpdate, type UpdateBucket } from './updates.ts';

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  DOWNLOADS?: DownloadBucket & UpdateBucket;
}

function selectEdgeCache(): DownloadCache | null {
  if (!('default' in caches)) return null;
  return (caches as CacheStorage & { default: Cache }).default;
}

export default {
  fetch: (request: Request, env: Env) => {
    const { pathname } = new URL(request.url);
    if (isOpenPage(pathname)) return respondOpen(request, (open) => env.ASSETS.fetch(open));
    if (isUpdatePath(pathname)) return respondUpdate(request, env.DOWNLOADS ?? null);
    return respond(request, {
      bucket: env.DOWNLOADS ?? null,
      fetch: (url, init) => fetch(url, init),
      cache: selectEdgeCache(),
      assets: (assetRequest) => env.ASSETS.fetch(assetRequest),
    });
  },
};
