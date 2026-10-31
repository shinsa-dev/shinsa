import type { Database } from './database.ts';
import { createWorld, respond } from './router.ts';
import { type CloudEnv, resolveCloudConfig } from './world.ts';

interface R2Object {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
}

interface R2Bucket {
  put: (
    key: string,
    body: ArrayBuffer,
    options: { httpMetadata: { contentType: string } }
  ) => Promise<unknown>;
  get: (key: string) => Promise<R2Object | null>;
  delete: (keys: string[]) => Promise<void>;
}

interface WorkerEnv extends CloudEnv {
  DB: Database;
  FILES: R2Bucket;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

export default {
  fetch: (request: Request, env: WorkerEnv) =>
    respond(
      request,
      createWorld({
        db: env.DB,
        files: {
          put: async (key, body, contentType) => {
            await env.FILES.put(key, body, { httpMetadata: { contentType } });
          },
          select: async (key) => {
            const object = await env.FILES.get(key);
            if (!object) return null;
            return {
              body: object.body,
              contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
            };
          },
          remove: (keys) => env.FILES.delete(keys),
        },
        assets: (assetRequest) => env.ASSETS.fetch(assetRequest),
        fetch: (url, init) => fetch(url, init),
        now: Date.now,
        config: resolveCloudConfig(env),
      })
    ),
};
