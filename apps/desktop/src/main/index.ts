import { join } from 'node:path';
import { ENGINE_PROTOCOL } from '@shinsa/core';
import { app, clipboard, ipcMain, session, shell } from 'electron';
import { resolveUserDataDir } from '../app/dev-bundle.ts';
import { APP_NAME } from '../app/schema.ts';
import { CHANNELS, type DesktopStart } from '../bridge/schema.ts';
import { findDeepLink, parseDeepLink } from '../deep-links/links.ts';
import { URL_SCHEME } from '../deep-links/schema.ts';
import {
  APP_ID,
  type EngineAction,
  type EngineScreen,
  LOGIN_ITEMS_URL,
  PRIVACY_URL,
} from '../engine/schema.ts';
import { describeEngineScreen } from '../engine/screen.ts';
import { isPermissionAllowed } from '../navigation/origin.ts';
import { parseNotice, resolveBadgeText, resolveNotificationSettingsUrl } from '../notifications/notice.ts';
import type { ServerHealth } from '../server/schema.ts';
import { describeServer } from '../server/url.ts';
import { describeAppVersion, parseUpdateChannel } from '../updates/channel.ts';
import type { UpdateSnapshot } from '../updates/schema.ts';
import { describeUpdateItem, resolveDesktopUpdate } from '../updates/state.ts';
import { syncCommandLine } from './command-line.ts';
import { applyMenu } from './menu.ts';
import { showNotice, watchNoticeFailures } from './notifications.ts';
import { openWindows } from './open-windows.ts';
import {
  answerDowngrade,
  applyUpdateChannel,
  checkForUpdates,
  ensureEngine,
  installUpdate,
  readEngineDetails,
  readOrigin,
  readPrefs,
  readUpdates,
  requestHealth,
  requestTrayQueue,
  restartEngine as kickEngine,
  startUpdater,
  watchUpdates,
} from './runtime.ts';
import { StatusTray } from './tray.ts';
import { MainWindow } from './window.ts';

const RETRY_MS = 2000;

const WATCH_MS = 5000;

const MISSES_BEFORE_WAITING = 3;

let main: MainWindow | null = null;
let pendingPath: string | null = null;
let connecting = false;
let misses = 0;
let shownScreen = '';
let menuActions: Omit<Parameters<typeof applyMenu>[0], 'update'> | null = null;
let updates: UpdateSnapshot | null = null;
let tray: StatusTray | null = null;
let firstHealth: Promise<ServerHealth | null> | null = null;
let aboutCredits: string | undefined;

app.setName(APP_NAME);
app.setPath('userData', resolveUserDataDir(app.getPath('appData'), app.isPackaged));

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
  firstHealth = requestHealth();
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
  const origin = await readOrigin();
  const prefs = await readPrefs();
  main = new MainWindow(
    origin,
    prefs.windowBounds,
    () => void connect(),
    (action) => void runEngineAction(action)
  );
  openWindows.main = main;
  if (pendingPath) main.open(pendingPath);
  tray = new StatusTray(
    (action) => {
      if (action === 'open') main?.show();
      else app.quit();
    },
    (path) => {
      main?.show();
      main?.open(path);
    }
  );
  applySessionPolicy(origin);
  menuActions = {
    show: () => main?.show(),
    open: (path) => main?.open(path),
    step: (offset) => main?.step(offset),
    reload: () => main?.reload(),
    restartEngine: () => void restartEngine(),
  };
  updates = await readUpdates();
  watchUpdates(publishUpdate);
  refreshMenu();
  startUpdater();
  void syncCommandLine();
  await connect();
  setInterval(() => void watchEngine(), WATCH_MS);
}

function refreshMenu() {
  if (!menuActions || !updates) return;
  const item = describeUpdateItem(updates.state);
  applyMenu({
    ...menuActions,
    update: {
      ...item,
      visible: updates.supported,
      click: () => (item.install ? installUpdate() : checkForUpdates(true)),
    },
  });
}

function publishUpdate(snapshot: UpdateSnapshot) {
  updates = snapshot;
  refreshMenu();
  applyAboutPanel();
  main?.win.webContents.send(CHANNELS.update, resolveDesktopUpdate(snapshot.state));
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
            update: updates ? resolveDesktopUpdate(updates.state) : { status: 'none' },
            channel: updates?.channel ?? 'stable',
            windowState: main.windowState,
          }
        : null;
    event.returnValue = payload;
  });
  ipcMain.on(CHANNELS.installUpdate, (event) => {
    if (main?.isAppSender(event)) installUpdate();
  });
  ipcMain.on(CHANNELS.checkForUpdates, (event) => {
    if (main?.isAppSender(event)) checkForUpdates(true);
  });
  ipcMain.on(CHANNELS.updateChannel, (event, value: unknown) => {
    const channel = main?.isAppSender(event) ? parseUpdateChannel(value) : null;
    if (channel) applyUpdateChannel(channel);
  });
  ipcMain.on(CHANNELS.downgrade, (event, accept: unknown) => {
    if (main?.isAppSender(event)) answerDowngrade(accept === true);
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
  watchNoticeFailures(() => {
    if (main?.showsApp) main.win.webContents.send(CHANNELS.notifyFailed);
  });
  ipcMain.on(CHANNELS.notificationSettings, (event) => {
    if (main?.isAppSender(event)) void shell.openExternal(resolveNotificationSettingsUrl(APP_ID));
  });
}

function applyAboutPanel(credits = aboutCredits) {
  aboutCredits = credits;
  const version = updates ? describeAppVersion(app.getVersion(), updates.channel) : app.getVersion();
  app.setAboutPanelOptions({ applicationName: APP_NAME, applicationVersion: version, credits });
}

function showApp(current: MainWindow, health: ServerHealth) {
  void refreshTray(health);
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
  if (!current || connecting) return;
  connecting = true;
  const found = await (firstHealth ?? requestHealth());
  firstHealth = null;
  if (found) {
    connecting = false;
    showApp(current, found);
    return;
  }
  for (;;) {
    const result = await ensureEngine(() => showScreen(current, { kind: 'starting' }));
    if (result._tag === 'Running') {
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
    const health = await requestHealth();
    await refreshTray(health);
    if (health) await connect();
    return;
  }
  if (!current.showsApp) return;
  const health = await requestHealth();
  await refreshTray(health);
  misses = health ? 0 : misses + 1;
  if (misses >= MISSES_BEFORE_WAITING) {
    misses = 0;
    await connect();
  }
}

async function refreshTray(health: ServerHealth | null) {
  if (!health) {
    tray?.update(null, null);
    return;
  }
  tray?.update(health, await requestTrayQueue());
}

async function restartEngine() {
  const current = main;
  if (!current) return;
  showScreen(current, { kind: 'starting' });
  await kickEngine();
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
      void clipboard.writeText(await readEngineDetails());
      return;
    case 'restart':
      await restartEngine();
      return;
    case 'retry':
      await connect();
      return;
  }
}
