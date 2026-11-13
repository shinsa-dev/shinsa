import { D1Client } from '@effect/sql-d1';
import { ConfigProvider, Context, Layer } from 'effect';
import { makeCloudHandler } from './app.ts';
import { Assets, RelayRooms, WorkerContext } from './http/worker.ts';
import { SQL_NAMES } from './store/shared/schema.ts';

interface WorkerEnv {
  readonly DB: D1Client.D1ClientConfig['db'];
  readonly ASSETS: { fetch: (request: Request) => Promise<Response> };
  readonly RELAY: {
    idFromName: (name: string) => unknown;
    get: (id: unknown) => { fetch: (request: Request) => Promise<Response> };
  };
}

interface ExecutionContext {
  waitUntil: (work: Promise<unknown>) => void;
}

const handlers = new WeakMap<WorkerEnv, ReturnType<typeof makeCloudHandler>['handler']>();

function resolveHandler(env: WorkerEnv) {
  const known = handlers.get(env);
  if (known) return known;
  const { handler } = makeCloudHandler(
    Layer.mergeAll(
      D1Client.layer({ db: env.DB, ...SQL_NAMES }),
      Layer.succeed(Assets, { fetch: (request) => env.ASSETS.fetch(request) }),
      Layer.succeed(RelayRooms, {
        fetch: (instanceId, request) => env.RELAY.get(env.RELAY.idFromName(instanceId)).fetch(request),
      }),
      ConfigProvider.layer(ConfigProvider.fromUnknown(env))
    )
  );
  handlers.set(env, handler);
  return handler;
}

export default {
  fetch: (request: Request, env: WorkerEnv, context: ExecutionContext) =>
    resolveHandler(env)(
      request,
      Context.make(WorkerContext, { waitUntil: (work) => context.waitUntil(work) })
    ),
};
