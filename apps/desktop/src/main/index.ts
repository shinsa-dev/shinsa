import { join } from 'node:path';
import { app, session } from 'electron';
import { resolveUserDataDir } from '../app/dev-bundle.ts';
import { APP_NAME } from '../app/schema.ts';
import { URL_SCHEME } from '../deep-links/schema.ts';
import { type EngineAction, type EngineScreen, LOGIN_ITEMS_URL, PRIVACY_URL } from '../engine/schema.ts';
import { describeEngineScreen } from '../engine/screen.ts';
import { isPermissionAllowed } from '../navigation/origin.ts';
import type { ServerHealth } from '../server/schema.ts';
import { syncCommandLine } from './command-line.ts';
import {
  clearBadge,
  ensureEngine,
  openExternal,
  readEngineDetails,
  readOrigin,
  readPage,
  requestHealth,
  requestTrayQueue,
  restartEngine as kickEngine,
  showServer,
  showServerPage,
  showWaiting,
  startWindow,
  updateTray,
  watchEngineActions,
  writeClipboard,
} from './runtime.ts';

const RETRY_MS = 2000;

const WATCH_MS = 5000;

const MISSES_BEFORE_WAITING = 3;

let ready = false;
let connecting = false;
let misses = 0;
let shownScreen = '';
let firstHealth: Promise<ServerHealth | null> | null = null;

app.setName(APP_NAME);
app.setPath('userData', resolveUserDataDir(app.getPath('appData'), app.isPackaged));

if (app.requestSingleInstanceLock()) {
  firstHealth = requestHealth();
  void app.whenReady().then(start);
} else {
  app.exit(0);
}

async function start() {
  if (app.isPackaged) app.setAsDefaultProtocolClient(URL_SCHEME);
  else app.dock?.setIcon(join(app.getAppPath(), 'resources', 'icon.png'));
  applySessionPolicy(await readOrigin());
  await startWindow();
  ready = true;
  watchEngineActions((action) => void runEngineAction(action));
  void syncCommandLine();
  await connect();
  setInterval(() => void watchEngine(), WATCH_MS);
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

function showApp(health: ServerHealth) {
  void refreshTray(health);
  void showServer(health);
  misses = 0;
  shownScreen = '';
  void showServerPage();
}

async function showScreen(screen: EngineScreen) {
  const view = describeEngineScreen(screen);
  const key = JSON.stringify(view);
  if ((await readPage()) === 'waiting' && key === shownScreen) return;
  shownScreen = key;
  void clearBadge();
  void showWaiting(view);
}

async function connect() {
  if (!ready || connecting) return;
  connecting = true;
  const found = await (firstHealth ?? requestHealth());
  firstHealth = null;
  if (found) {
    connecting = false;
    showApp(found);
    return;
  }
  for (;;) {
    const result = await ensureEngine(() => void showScreen({ kind: 'starting' }));
    if (result._tag === 'Running') {
      connecting = false;
      showApp(result.health);
      return;
    }
    await showScreen(result.screen);
    if (result.screen.kind !== 'dev' && result.screen.kind !== 'approval') {
      connecting = false;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
  }
}

async function watchEngine() {
  if (!ready || connecting) return;
  const page = await readPage();
  if (page === 'waiting') {
    const health = await requestHealth();
    await refreshTray(health);
    if (health) await connect();
    return;
  }
  if (page !== 'app') return;
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
    await updateTray(null, null);
    return;
  }
  await updateTray(health, await requestTrayQueue());
}

async function restartEngine() {
  await showScreen({ kind: 'starting' });
  await kickEngine();
  await connect();
}

async function runEngineAction(action: EngineAction) {
  switch (action) {
    case 'open-login-items':
      await openExternal(LOGIN_ITEMS_URL);
      return;
    case 'open-privacy':
      await openExternal(PRIVACY_URL);
      return;
    case 'copy-details':
      await writeClipboard(await readEngineDetails());
      return;
    case 'restart':
      await restartEngine();
      return;
    case 'retry':
      await connect();
      return;
  }
}
