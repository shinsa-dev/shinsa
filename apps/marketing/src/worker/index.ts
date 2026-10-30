import { type DownloadBucket, type DownloadCache, respond } from './download.ts';
import { isOpenPage, respondOpen } from './open.ts';

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  DOWNLOADS?: DownloadBucket;
}

function selectEdgeCache(): DownloadCache | null {
  if (!('default' in caches)) return null;
  return (caches as CacheStorage & { default: Cache }).default;
}

export default {
  fetch: (request: Request, env: Env) => {
    if (isOpenPage(new URL(request.url).pathname))
      return respondOpen(request, (open) => env.ASSETS.fetch(open));
    return respond(request, {
      bucket: env.DOWNLOADS ?? null,
      fetch: (url, init) => fetch(url, init),
      cache: selectEdgeCache(),
      assets: (assetRequest) => env.ASSETS.fetch(assetRequest),
    });
  },
};
