import { Effect, Layer, ManagedRuntime, Option, Stream } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { EngineSupervisor } from '../engine/service.ts';
import { Prefs } from '../prefs/service.ts';
import { EngineServer } from '../server/service.ts';
import { UpdateLog } from '../update-log/service.ts';
import type { UpdateChannel, UpdateSnapshot } from '../updates/schema.ts';
import { Updater } from '../updates/service.ts';
import type { Rect } from '../window/schema.ts';
import { AppWindowLive, NotificationsLive } from './app-window.ts';
import { DialogsLive } from './dialogs.ts';
import { FilesLive } from './files.ts';
import { DesktopHostLive } from './host.ts';
import { LaunchctlLive } from './launchctl.ts';
import { LoginItemsLive } from './login-items.ts';
import { UpdateClientLive } from './update-client.ts';

const WorldLayer = Layer.mergeAll(
  FetchHttpClient.layer,
  DesktopHostLive,
  FilesLive,
  LaunchctlLive,
  LoginItemsLive,
  UpdateClientLive,
  DialogsLive,
  AppWindowLive,
  NotificationsLive
);

const DesktopLayer = Layer.mergeAll(EngineSupervisor.layer, Updater.layer).pipe(
  Layer.provideMerge(Layer.mergeAll(EngineServer.layer, Prefs.layer, UpdateLog.layer)),
  Layer.provideMerge(WorldLayer)
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

export function readPrefs() {
  return desktopRuntime.runPromise(Prefs.use((prefs) => prefs.read));
}

export function writeWindowBounds(windowBounds: Rect) {
  desktopRuntime.runSync(Prefs.use((prefs) => prefs.write({ windowBounds })));
}

export function readUpdates() {
  return desktopRuntime.runPromise(Updater.use((updater) => updater.snapshot));
}

export function watchUpdates(listener: (snapshot: UpdateSnapshot) => void) {
  desktopRuntime.runFork(
    Updater.use((updater) =>
      Stream.runForEach(updater.changes, (snapshot) => Effect.sync(() => listener(snapshot)))
    )
  );
}

export function startUpdater() {
  desktopRuntime.runFork(Updater.use((updater) => updater.start));
}

export function checkForUpdates(manual: boolean) {
  desktopRuntime.runFork(Updater.use((updater) => updater.check(manual)));
}

export function applyUpdateChannel(channel: UpdateChannel) {
  desktopRuntime.runFork(Updater.use((updater) => updater.applyChannel(channel)));
}

export function answerDowngrade(accept: boolean) {
  desktopRuntime.runFork(Updater.use((updater) => updater.answerDowngrade(accept)));
}

export function installUpdate() {
  desktopRuntime.runFork(Updater.use((updater) => updater.install));
}
