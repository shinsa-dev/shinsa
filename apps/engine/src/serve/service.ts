import { mkdirSync } from 'node:fs';
import { Context, Effect, Layer, Option } from 'effect';
import { prepareDataDir, type ServerConfig } from '../config/index.ts';
import { resolveServerUrl } from '../http/index.ts';
import { resolveServerInstance } from '../instance/index.ts';
import { ServeLock } from '../instance/lock/service.ts';
import type { Engine } from '../runtime/index.ts';
import { EventLog } from '../store/index.ts';
import type { ShinsaOptions } from './schema.ts';
import { createServices, disposeRuntime, startHttp, startWork, stopWork } from './wiring.ts';

export class Serve extends Context.Service<Serve, { readonly url: string; readonly engine: Engine }>()(
  'shinsa/engine/serve/Serve'
) {
  static layer(config: ServerConfig, options: ShinsaOptions, stop: () => Promise<void>) {
    return Layer.effect(
      Serve,
      Effect.gen(function* () {
        const instance = yield* Effect.promise(() => resolveServerInstance());
        yield* Effect.sync(() => mkdirSync(config.dataDir, { recursive: true }));
        const acquireLock = ServeLock.acquire(config.dataDir, {
          ...instance,
          port: config.port,
          url: resolveServerUrl(config.hostname, config.port),
        }).pipe(Effect.asSome);
        const lock = yield* config.inspect ? Effect.succeedNone : acquireLock;
        yield* Effect.sync(() => prepareDataDir(config));
        const eventLog = yield* Effect.acquireRelease(
          Effect.sync(() => new EventLog(config.databasePath)),
          (log) => Effect.sync(() => log.close())
        );
        const services = yield* createServices(config, options, instance, eventLog);
        yield* Effect.addFinalizer(() => disposeRuntime(services));
        const http = yield* startHttp(services, options, instance, stop);
        if (Option.isSome(lock)) {
          yield* lock.value.update({ port: http.server.port ?? config.port, url: http.url });
        }
        services.address.url = http.url;
        yield* Effect.addFinalizer(() => Effect.promise(() => services.eunoe.stop()));
        yield* Effect.addFinalizer(() => stopWork(services));
        if (config.inspect) {
          yield* Effect.logInfo('[Serve] Inspect mode: agents, pull request sync and recovery are off').pipe(
            Effect.annotateLogs({ dataDir: config.dataDir })
          );
        } else {
          yield* startWork(services);
        }
        return Serve.of({ url: http.url, engine: services.engine });
      })
    );
  }
}
