import { join } from 'node:path';
import { ENGINE_PROTOCOL } from '@shinsa/core';
import { app, clipboard, ipcMain, session, shell } from 'electron';
import { resolveBadgeText } from '../lib/badge.ts';
import { CHANNELS, type DesktopStart } from '../lib/bridge.ts';
import { findDeepLink, parseDeepLink, URL_SCHEME } from '../lib/deep-link.ts';
import { APP_NAME } from '../lib/dev-bundle.ts';
import {
  describeEngineScreen,
  type EngineAction,
  type EngineScreen,
  LOGIN_ITEMS_URL,
  PRIVACY_URL,
} from '../lib/engine.ts';
import { describeServer, type ServerHealth } from '../lib/health.ts';
import { isPermissionAllowed } from '../lib/navigation.ts';
import { parseNotice } from '../lib/notice.ts';
import { describeAppVersion, parseUpdateChannel } from '../lib/update-channel.ts';
import { syncCommandLine } from './command-line.ts';
import { EngineSupervisor } from './engine.ts';
import { applyMenu } from './menu.ts';
import { showNotice } from './notifications.ts';
import { requestHealth, resolveAppServerUrl } from './server.ts';
import { Updater } from './updater.ts';
import { MainWindow } from './window.ts';

const RETRY_MS = 2000;

const WATCH_MS = 5000;

const MISSES_BEFORE_WAITING = 3;

let main: MainWindow | null = null;
let engine: EngineSupervisor | null = null;
let pendingPath: string | null = null;
let connecting = false;
let misses = 0;
let shownScreen = '';
let menuActions: Omit<Parameters<typeof applyMenu>[0], 'update'> | null = null;
let updater: Updater | null = null;
let firstHealth: Promise<ServerHealth | null> | null = null;
let aboutCredits: string | undefined;

app.setName(APP_NAME);
if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), `${APP_NAME} Dev`));
else if (process.env.SHINSA_APP_ID)
  app.setPath('userData', join(app.getPath('appData'), process.env.SHINSA_APP_ID));

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
  firstHealth = requestHealth(resolveAppServerUrl());
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
  engine = new EngineSupervisor(origin);
  main = new MainWindow(
    origin,
    () => void connect(),
    (action) => void runEngineAction(action)
  );
  if (pendingPath) main.open(pendingPath);
  applySessionPolicy(origin);
  menuActions = {
    show: () => main?.show(),
    open: (path) => main?.open(path),
    step: (offset) => main?.step(offset),
    reload: () => main?.reload(),
    restartEngine: () => void restartEngine(),
  };
  updater = new Updater(publishUpdate, () => main?.show());
  refreshMenu();
  updater.start();
  void syncCommandLine();
  await connect();
  setInterval(() => void watchEngine(), WATCH_MS);
}

function refreshMenu() {
  if (menuActions && updater) applyMenu({ ...menuActions, update: updater.menuItem });
}

function publishUpdate() {
  refreshMenu();
  applyAboutPanel();
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
            channel: updater?.channel ?? 'stable',
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
  ipcMain.on(CHANNELS.updateChannel, (event, value: unknown) => {
    const channel = main?.isAppSender(event) ? parseUpdateChannel(value) : null;
    if (channel) void updater?.applyChannel(channel);
  });
  ipcMain.on(CHANNELS.downgrade, (event, accept: unknown) => {
    if (main?.isAppSender(event)) void updater?.answerDowngrade(accept === true);
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

function applyAboutPanel(credits = aboutCredits) {
  aboutCredits = credits;
  const version = updater ? describeAppVersion(app.getVersion(), updater.channel) : app.getVersion();
  app.setAboutPanelOptions({ applicationName: APP_NAME, applicationVersion: version, credits });
}

function showApp(current: MainWindow, health: ServerHealth) {
  applyAboutPanel(describeServer(current.origin, health));
  misses = 0;
  shownScreen = '';
  void current.showServerPage();
}

function showScreen(current: MainWindow, screen: EngineScreen) {
  const view = describeEngineScreen(screen);
  const key = JSON.stringify(view);
  if (current.showsWaiting && key === shownScreen) return;
  shownScreen = key;
  app.dock?.setBadge('');
  void current.showWaiting(view);
}

async function connect() {
  const current = main;
  const supervisor = engine;
  if (!current || !supervisor || connecting) return;
  connecting = true;
  const found = await (firstHealth ?? requestHealth(current.origin));
  firstHealth = null;
  if (found) {
    connecting = false;
    showApp(current, found);
    return;
  }
  for (;;) {
    const result = await supervisor.ensure(() => showScreen(current, { kind: 'starting' }));
    if ('health' in result) {
      connecting = false;
      showApp(current, result.health);
      return;
    }
    showScreen(current, result.screen);
    if (result.screen.kind !== 'dev' && result.screen.kind !== 'approval') {
      connecting = false;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
  }
}

async function watchEngine() {
  const current = main;
  if (!current || connecting) return;
  if (current.showsWaiting) {
    if (await requestHealth(current.origin)) await connect();
    return;
  }
  if (!current.showsApp) return;
  const health = await requestHealth(current.origin);
  misses = health ? 0 : misses + 1;
  if (misses >= MISSES_BEFORE_WAITING) {
    misses = 0;
    await connect();
  }
}

async function restartEngine() {
  const current = main;
  if (!current || !engine) return;
  showScreen(current, { kind: 'starting' });
  await engine.restart();
  await connect();
}

async function runEngineAction(action: EngineAction) {
  switch (action) {
    case 'open-login-items':
      await shell.openExternal(LOGIN_ITEMS_URL);
      return;
    case 'open-privacy':
      await shell.openExternal(PRIVACY_URL);
      return;
    case 'copy-details':
      clipboard.writeText(engine?.readDetails() ?? '');
      return;
    case 'restart':
      await restartEngine();
      return;
    case 'retry':
      await connect();
      return;
  }
}
