import { Effect, Layer, ManagedRuntime, Option } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { EngineSupervisor } from '../engine/service.ts';
import { EngineServer } from '../server/service.ts';
import { FilesLive } from './files.ts';
import { DesktopHostLive } from './host.ts';
import { LaunchctlLive } from './launchctl.ts';
import { LoginItemsLive } from './login-items.ts';

const DesktopLayer = EngineSupervisor.layer.pipe(
  Layer.provideMerge(EngineServer.layer),
  Layer.provide(
    Layer.mergeAll(FetchHttpClient.layer, DesktopHostLive, FilesLive, LaunchctlLive, LoginItemsLive)
  )
);

const desktopRuntime = ManagedRuntime.make(DesktopLayer);

export function readOrigin() {
  return desktopRuntime.runPromise(EngineServer.use((server) => Effect.succeed(server.origin)));
}

export function requestHealth() {
  return desktopRuntime.runPromise(
    EngineServer.use((server) => Effect.map(Effect.option(server.requestHealth), Option.getOrNull))
  );
}

export function requestTrayQueue() {
  return desktopRuntime.runPromise(
    EngineServer.use((server) => Effect.map(Effect.option(server.requestQueue), Option.getOrNull))
  );
}

export function ensureEngine(onStarting: () => void) {
  return desktopRuntime.runPromise(EngineSupervisor.use((engine) => engine.ensure(Effect.sync(onStarting))));
}

export function restartEngine() {
  return desktopRuntime.runPromise(EngineSupervisor.use((engine) => engine.restart));
}

export function readEngineDetails() {
  return desktopRuntime.runPromise(EngineSupervisor.use((engine) => engine.readDetails));
}
