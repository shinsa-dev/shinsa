import { join } from 'node:path';
import { ENGINE_PROTOCOL } from '@shinsa/core';
import { app, type BrowserWindow, dialog, ipcMain, session } from 'electron';
import { resolveBadgeText } from '../lib/badge.ts';
import { CHANNELS, type DesktopStart } from '../lib/bridge.ts';
import { findDeepLink, parseDeepLink, URL_SCHEME } from '../lib/deep-link.ts';
import { APP_NAME } from '../lib/dev-bundle.ts';
import { describeServer, type ServerHealth } from '../lib/health.ts';
import { isPermissionAllowed } from '../lib/navigation.ts';
import { parseNotice } from '../lib/notice.ts';
import { applyMenu } from './menu.ts';
import { showNotice } from './notifications.ts';
import { requestHealth, requestServiceStart, resolveAppServerUrl } from './server.ts';
import { Updater } from './updater.ts';
import { MainWindow } from './window.ts';

const RETRY_MS = 2000;

let main: MainWindow | null = null;
let pendingPath: string | null = null;
let connecting = false;
let offeredStart = false;
let menuActions: Omit<Parameters<typeof applyMenu>[0], 'update'> | null = null;
let updater: Updater | null = null;

app.setName(APP_NAME);
if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), `${APP_NAME} Dev`));

if (app.requestSingleInstanceLock()) {
  watchApp();
} else {
  app.exit(0);
}

function watchApp() {
  pendingPath = parseDeepLink(findDeepLink(process.argv) ?? '');
  app.on('second-instance', (_event, argv) => openLink(findDeepLink(argv)));
  app.on('open-url', (event, url) => {
    event.preventDefault();
    openLink(url);
  });
  app.on('activate', () => main?.show());
  app.on('before-quit', () => main?.markQuitting());
  watchPage();
  void app.whenReady().then(start);
}

function openLink(raw: string | null) {
  const path = raw ? parseDeepLink(raw) : null;
  if (!main) {
    pendingPath = path ?? pendingPath;
    return;
  }
  if (path) main.open(path);
  main.show();
}

async function start() {
  if (app.isPackaged) app.setAsDefaultProtocolClient(URL_SCHEME);
  else app.dock?.setIcon(join(app.getAppPath(), 'resources', 'icon.png'));
  applyAboutPanel();
  const origin = resolveAppServerUrl();
  main = new MainWindow(origin, () => void connect());
  if (pendingPath) main.open(pendingPath);
  applySessionPolicy(origin);
  menuActions = {
    show: () => main?.show(),
    open: (path) => main?.open(path),
    reload: () => main?.reload(),
  };
  updater = new Updater(publishUpdate, () => main?.show());
  refreshMenu();
  updater.start();
  await connect();
}

function refreshMenu() {
  if (menuActions && updater) applyMenu({ ...menuActions, update: updater.menuItem });
}

function publishUpdate() {
  refreshMenu();
  if (updater) main?.win.webContents.send(CHANNELS.update, updater.pageState);
}

function applySessionPolicy(origin: string) {
  const policy = session.defaultSession;
  policy.setPermissionRequestHandler((_contents, permission, callback, details) =>
    callback(isPermissionAllowed(permission, details.requestingUrl, origin))
  );
  policy.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
    isPermissionAllowed(permission, requestingOrigin, origin)
  );
}

function watchPage() {
  ipcMain.on(CHANNELS.start, (event) => {
    const payload: DesktopStart | null =
      main && event.sender === main.win.webContents
        ? {
            version: app.getVersion(),
            protocol: ENGINE_PROTOCOL,
            update: updater?.pageState ?? { status: 'none' },
            windowState: main.windowState,
          }
        : null;
    event.returnValue = payload;
  });
  ipcMain.on(CHANNELS.installUpdate, (event) => {
    if (main?.isAppSender(event)) updater?.install();
  });
  ipcMain.on(CHANNELS.checkForUpdates, (event) => {
    if (main?.isAppSender(event)) void updater?.check(true);
  });
  ipcMain.on(CHANNELS.badge, (event, count: unknown) => {
    if (main?.isAppSender(event)) app.dock?.setBadge(resolveBadgeText(count));
  });
  ipcMain.on(CHANNELS.notify, (event, payload: unknown) => {
    const notice = main?.isAppSender(event) ? parseNotice(payload) : null;
    if (!notice) return;
    showNotice(notice, (path) => {
      if (path) main?.open(path);
      main?.show();
    });
  });
}

function applyAboutPanel(credits?: string) {
  app.setAboutPanelOptions({ applicationName: APP_NAME, applicationVersion: app.getVersion(), credits });
}

function showApp(current: MainWindow, health: ServerHealth) {
  applyAboutPanel(describeServer(current.origin, health));
  void current.showServerPage();
}

async function waitForServer(origin: string) {
  for (;;) {
    const health = await requestHealth(origin);
    if (health) return health;
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
  }
}

async function connect() {
  const current = main;
  if (!current || connecting) return;
  connecting = true;
  const found = await requestHealth(current.origin);
  if (found) {
    connecting = false;
    showApp(current, found);
    return;
  }
  app.dock?.setBadge('');
  await current.showWaiting();
  const offer = app.isPackaged && !offeredStart ? offerStart(current) : null;
  const health = await waitForServer(current.origin);
  offer?.abort();
  connecting = false;
  showApp(current, health);
}

function offerStart(current: MainWindow) {
  offeredStart = true;
  const controller = new AbortController();
  void askToStart(current.win, current.origin, controller.signal);
  return controller;
}

async function askToStart(win: BrowserWindow, origin: string, signal: AbortSignal) {
  const { response } = await dialog.showMessageBox(win, {
    type: 'info',
    message: 'Shinsa is not running',
    detail: `Nothing answers at ${origin}. Start Shinsa as a background service, or run “shinsa service install” in a terminal.`,
    buttons: ['Start Shinsa', 'Not now'],
    defaultId: 0,
    cancelId: 1,
    signal,
  });
  let again = response === 0;
  while (again && !signal.aborted) {
    const { health, output } = await requestServiceStart(origin);
    if (health || signal.aborted) return;
    const retry = await dialog.showMessageBox(win, {
      type: 'warning',
      message: 'Shinsa did not start',
      detail: `${output}\n\nRun “shinsa service install” in a terminal to see what went wrong.`,
      buttons: ['Try again', 'Not now'],
      defaultId: 0,
      cancelId: 1,
      signal,
    });
    again = retry.response === 0;
  }
}
