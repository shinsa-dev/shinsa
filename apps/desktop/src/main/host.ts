import { homedir } from 'node:os';
import { Layer } from 'effect';
import { app } from 'electron';
import { DesktopHost } from '../host/service.ts';

export const DesktopHostLive = Layer.sync(DesktopHost, () =>
  DesktopHost.of({
    packaged: app.isPackaged,
    home: homedir(),
    uid: process.getuid?.() ?? 0,
    resourcesPath: process.resourcesPath,
    env: process.env,
  })
);
