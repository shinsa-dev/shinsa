import { join } from 'node:path';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { app, session } from 'electron';
import { resolveUserDataDir } from '../app/dev-bundle.ts';
import { APP_NAME } from '../app/schema.ts';
import { AppLifecycle } from '../app/service.ts';
import { PageBridge } from '../bridge/service.ts';
import { CommandLine } from '../command-line/service.ts';
import { Connection } from '../connection/service.ts';
import { URL_SCHEME } from '../deep-links/schema.ts';
import { EngineActions } from '../engine-actions/service.ts';
import { EngineSupervisor } from '../engine/service.ts';
import { FirstHealth } from '../first-health/service.ts';
import { DesktopHost } from '../host/service.ts';
import { AppMenu } from '../menu/service.ts';
import { isPermissionAllowed } from '../navigation/origin.ts';
import { Notifications } from '../notifications/service.ts';
import { Prefs } from '../prefs/service.ts';
import { EngineServer } from '../server/service.ts';
import { StatusTray } from '../tray/service.ts';
import { UpdateLog } from '../update-log/service.ts';
import { Updater } from '../updates/service.ts';
import { AppWindow } from '../window/service.ts';
import { DialogsLive } from './dialogs.ts';
import { FilesLive } from './files.ts';
import { DesktopHostLive } from './host.ts';
import { LaunchctlLive } from './launchctl.ts';
import { LoginItemsLive } from './login-items.ts';
import { LoginShellLive } from './login-shell.ts';
import { NativeNoticesLive } from './native-notices.ts';
import { NativeTrayLive } from './native-tray.ts';
import { NativeWindowLive } from './native-window.ts';
import { PageChannelLive } from './page-channel.ts';
import { DesktopShellLive } from './shell.ts';
import { UpdateClientLive } from './update-client.ts';

const AppReady = Layer.effectDiscard(Effect.promise(() => app.whenReady()));

const ElectronLayer = Layer.mergeAll(
  FetchHttpClient.layer,
  DesktopHostLive,
  FilesLive,
  LaunchctlLive,
  LoginItemsLive,
  LoginShellLive,
  UpdateClientLive,
  DialogsLive,
  DesktopShellLive
);

const EngineLayer = Layer.mergeAll(EngineSupervisor.layer, FirstHealth.layer, CommandLine.layer).pipe(
  Layer.provideMerge(Layer.mergeAll(EngineServer.layer, Prefs.layer, UpdateLog.layer, EngineActions.layer)),
  Layer.provideMerge(ElectronLayer)
);

const WindowLayer = Layer.mergeAll(AppLifecycle, PageBridge, AppMenu.layer, StatusTray.layer).pipe(
  Layer.provideMerge(Updater.layer),
  Layer.provideMerge(Notifications.layer),
  Layer.provideMerge(AppWindow.layer),
  Layer.provideMerge(
    Layer.mergeAll(NativeWindowLive, NativeTrayLive, NativeNoticesLive, PageChannelLive).pipe(
      Layer.provide(AppReady)
    )
  ),
  Layer.provideMerge(EngineLayer)
);

const Main = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* DesktopHost;
    const { origin } = yield* EngineServer;
    const updater = yield* Updater;
    const commandLine = yield* CommandLine;
    const connection = yield* Connection;
    yield* Effect.sync(() => {
      if (host.packaged) app.setAsDefaultProtocolClient(URL_SCHEME);
      else app.dock?.setIcon(join(app.getAppPath(), 'resources', 'icon.png'));
      session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) =>
        callback(isPermissionAllowed(permission, details.requestingUrl, origin))
      );
      session.defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
        isPermissionAllowed(permission, requestingOrigin, origin)
      );
    });
    yield* updater.start;
    yield* Effect.forkScoped(commandLine.sync);
    yield* Effect.forkScoped(connection.start);
  })
).pipe(Layer.provide(Connection.layer.pipe(Layer.provideMerge(WindowLayer))));

app.setName(APP_NAME);
app.setPath('userData', resolveUserDataDir(app.getPath('appData'), app.isPackaged));

if (app.requestSingleInstanceLock()) {
  const runtime = ManagedRuntime.make(Main);
  runtime.runFork(Effect.logDebug('Shinsa started'));
  app.on('will-quit', () => {
    Effect.runFork(runtime.disposeEffect);
  });
} else {
  app.exit(0);
}
