import { homedir } from 'node:os';
import { Layer } from 'effect';
import { app } from 'electron';
import { DesktopHost } from '../host/service.ts';

export const DesktopHostLive = Layer.sync(DesktopHost, () =>
  DesktopHost.of({
    packaged: app.isPackaged,
    platform: process.platform,
    version: app.getVersion(),
    home: homedir(),
    uid: process.getuid?.() ?? 0,
    resourcesPath: process.resourcesPath,
    userDataPath: app.getPath('userData'),
    logsPath: app.getPath('logs'),
    env: process.env,
  })
);
