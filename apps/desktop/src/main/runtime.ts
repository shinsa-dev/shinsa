import { Effect, Layer, ManagedRuntime, Option, Stream } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { AppLifecycle } from '../app/service.ts';
import { PageBridge } from '../bridge/service.ts';
import { EngineActions } from '../engine-actions/service.ts';
import type { EngineAction, EngineScreenView } from '../engine/schema.ts';
import { EngineSupervisor } from '../engine/service.ts';
import { AppMenu } from '../menu/service.ts';
import { Notifications } from '../notifications/service.ts';
import { Prefs } from '../prefs/service.ts';
import type { ServerHealth } from '../server/schema.ts';
import { EngineServer } from '../server/service.ts';
import { DesktopShell } from '../shell/service.ts';
import type { TrayQueue } from '../tray/schema.ts';
import { StatusTray } from '../tray/service.ts';
import { UpdateLog } from '../update-log/service.ts';
import { Updater } from '../updates/service.ts';
import { AppWindow } from '../window/service.ts';
import { DialogsLive } from './dialogs.ts';
import { FilesLive } from './files.ts';
import { DesktopHostLive } from './host.ts';
import { LaunchctlLive } from './launchctl.ts';
import { LoginItemsLive } from './login-items.ts';
import { NativeNoticesLive } from './native-notices.ts';
import { NativeTrayLive } from './native-tray.ts';
import { NativeWindowLive } from './native-window.ts';
import { PageChannelLive } from './page-channel.ts';
import { DesktopShellLive } from './shell.ts';
import { UpdateClientLive } from './update-client.ts';

const BaseLayer = EngineSupervisor.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(EngineServer.layer, Prefs.layer, UpdateLog.layer, EngineActions.layer)),
  Layer.provideMerge(
    Layer.mergeAll(
      FetchHttpClient.layer,
      DesktopHostLive,
      FilesLive,
      LaunchctlLive,
      LoginItemsLive,
      UpdateClientLive,
      DialogsLive,
      DesktopShellLive
    )
  )
);

const WindowLayer = Layer.mergeAll(AppLifecycle, PageBridge, AppMenu.layer, StatusTray.layer).pipe(
  Layer.provideMerge(Updater.layer),
  Layer.provideMerge(Notifications.layer),
  Layer.provideMerge(AppWindow.layer),
  Layer.provideMerge(Layer.mergeAll(NativeWindowLive, NativeTrayLive, NativeNoticesLive, PageChannelLive)),
  Layer.provideMerge(BaseLayer)
);

const baseRuntime = ManagedRuntime.make(BaseLayer);

const windowRuntime = ManagedRuntime.make(WindowLayer, { memoMap: baseRuntime.memoMap });

export function readOrigin() {
  return baseRuntime.runPromise(EngineServer.use((server) => Effect.succeed(server.origin)));
}

export function requestHealth() {
  return baseRuntime.runPromise(
    EngineServer.use((server) => Effect.map(Effect.option(server.requestHealth), Option.getOrNull))
  );
}

export function ensureEngine(onStarting: () => void) {
  return baseRuntime.runPromise(EngineSupervisor.use((engine) => engine.ensure(Effect.sync(onStarting))));
}

export function restartEngine() {
  return baseRuntime.runPromise(EngineSupervisor.use((engine) => engine.restart));
}

export function readEngineDetails() {
  return baseRuntime.runPromise(EngineSupervisor.use((engine) => engine.readDetails));
}

export function openExternal(url: string) {
  return baseRuntime.runPromise(DesktopShell.use((shell) => shell.openExternal(url)));
}

export function writeClipboard(text: string) {
  return baseRuntime.runPromise(DesktopShell.use((shell) => shell.writeClipboard(text)));
}

export function clearBadge() {
  return baseRuntime.runPromise(DesktopShell.use((shell) => shell.setBadge('')));
}

export function watchEngineActions(listener: (action: EngineAction) => void) {
  baseRuntime.runFork(
    EngineActions.use((actions) =>
      Stream.runForEach(actions.requests, (action) => Effect.sync(() => listener(action)))
    )
  );
}

export function startWindow() {
  return windowRuntime.runPromise(Updater.use((updater) => updater.start));
}

export function readPage() {
  return windowRuntime.runPromise(AppWindow.use((window) => window.page));
}

export function showServerPage() {
  return windowRuntime.runPromise(AppWindow.use((window) => window.showServerPage));
}

export function showWaiting(view: EngineScreenView) {
  return windowRuntime.runPromise(AppWindow.use((window) => window.showWaiting(view)));
}

export function showServer(health: ServerHealth) {
  return windowRuntime.runPromise(AppMenu.use((menu) => menu.showServer(health)));
}

export function requestTrayQueue() {
  return baseRuntime.runPromise(
    EngineServer.use((server) => Effect.map(Effect.option(server.requestQueue), Option.getOrNull))
  );
}

export function updateTray(health: ServerHealth | null, queue: TrayQueue | null) {
  return windowRuntime.runPromise(StatusTray.use((tray) => tray.update(health, queue)));
}
