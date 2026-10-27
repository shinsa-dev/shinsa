import { type DownloadCache, respond } from './download.ts';

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

function selectEdgeCache(): DownloadCache | null {
  if (!('default' in caches)) return null;
  return (caches as CacheStorage & { default: Cache }).default;
}

export default {
  fetch: (request: Request, env: Env) =>
    respond(request, {
      fetch: (url, init) => fetch(url, init),
      cache: selectEdgeCache(),
      assets: (assetRequest) => env.ASSETS.fetch(assetRequest),
    }),
};
