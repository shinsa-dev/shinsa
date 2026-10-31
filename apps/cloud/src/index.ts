import type { Database } from './database.ts';
import { createWorld, respond } from './router.ts';
import { type CloudEnv, resolveCloudConfig } from './world.ts';

interface WorkerEnv extends CloudEnv {
  DB: Database;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

export default {
  fetch: (request: Request, env: WorkerEnv, context: { waitUntil: (work: Promise<unknown>) => void }) =>
    respond(
      request,
      createWorld({
        db: env.DB,
        assets: (assetRequest) => env.ASSETS.fetch(assetRequest),
        fetch: (url, init) => fetch(url, init),
        now: Date.now,
        defer: (work) => context.waitUntil(work),
        config: resolveCloudConfig(env),
      })
    ),
};
