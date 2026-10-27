import { join } from 'node:path';
import { app, BrowserWindow, type IpcMainEvent, nativeTheme, screen, shell } from 'electron';
import { MIN_SIZE, resolveWindowBounds } from '../lib/bounds.ts';
import { CHANNELS, type DesktopWindowState } from '../lib/bridge.ts';
import { APP_NAME } from '../lib/dev-bundle.ts';
import {
  ENGINE_ACTION_LABEL,
  type EngineAction,
  type EngineScreenView,
  parseEngineAction,
} from '../lib/engine.ts';
import { isAppUrl, type Navigation, resolveHistoryStep, resolveNavigation } from '../lib/navigation.ts';
import { readPrefs, writePrefs } from './prefs.ts';

type Page = 'none' | 'app' | 'waiting';

const TRAFFIC_LIGHTS = { x: 16, y: 15 };

const BACKGROUND = { dark: '#101012', light: '#ffffff' };

const ABORTED = -3;

function isLoaded(load: Promise<void>) {
  return load.then(
    () => true,
    () => false
  );
}

export class MainWindow {
  readonly win: BrowserWindow;
  readonly origin: string;
  #page: Page = 'none';
  #pending = '/';
  #quitting = false;
  #onLoadFailed: () => void;
  #onEngineAction: (action: EngineAction) => void;

  constructor(origin: string, onLoadFailed: () => void, onEngineAction: (action: EngineAction) => void) {
    this.origin = origin;
    this.#onLoadFailed = onLoadFailed;
    this.#onEngineAction = onEngineAction;
    const display = screen.getPrimaryDisplay();
    this.win = new BrowserWindow({
      ...resolveWindowBounds(
        readPrefs().windowBounds,
        screen.getAllDisplays().map((each) => each.workArea),
        display.workArea
      ),
      minWidth: MIN_SIZE.width,
      minHeight: MIN_SIZE.height,
      title: APP_NAME,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: TRAFFIC_LIGHTS,
      backgroundColor: nativeTheme.shouldUseDarkColors ? BACKGROUND.dark : BACKGROUND.light,
      show: false,
      webPreferences: {
        preload: join(app.getAppPath(), 'dist', 'preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        spellcheck: true,
        backgroundThrottling: false,
        v8CacheOptions: 'bypassHeatCheck',
      },
    });
    this.#watchWindow();
    this.#watchContents();
  }

  #watchWindow() {
    const win = this.win;
    win.once('ready-to-show', () => win.show());
    win.on('close', (event) => {
      writePrefs({ windowBounds: win.getNormalBounds() });
      if (this.#quitting) return;
      event.preventDefault();
      if (!win.isFullScreen()) {
        win.hide();
        return;
      }
      win.once('leave-full-screen', () => win.hide());
      win.setFullScreen(false);
    });
    win.on('enter-full-screen', () => this.#sendWindowState('fullscreen'));
    win.on('leave-full-screen', () => this.#sendWindowState('window'));
  }

  #watchContents() {
    const contents = this.win.webContents;
    contents.on('will-navigate', (details) => {
      const action = this.#page === 'waiting' ? parseEngineAction(details.url) : null;
      if (action) {
        details.preventDefault();
        this.#onEngineAction(action);
        return;
      }
      const navigation = resolveNavigation(details.url, this.origin);
      if (navigation.kind === 'app' && this.#page === 'app') return;
      details.preventDefault();
      this.#follow(navigation);
    });
    contents.setWindowOpenHandler(({ url }) => {
      this.#follow(resolveNavigation(url, this.origin));
      return { action: 'deny' };
    });
    contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
      if (!isMainFrame || code === ABORTED || this.#page !== 'app') return;
      this.#page = 'none';
      this.#onLoadFailed();
    });
    contents.on('render-process-gone', () => this.reload());
  }

  #follow(navigation: Navigation) {
    if (navigation.kind === 'external') void shell.openExternal(navigation.url);
    if (navigation.kind === 'app' || navigation.kind === 'link') this.open(navigation.path);
  }

  #sendWindowState(state: DesktopWindowState) {
    this.win.webContents.send(CHANNELS.windowState, state);
  }

  get windowState(): DesktopWindowState {
    return this.win.isFullScreen() ? 'fullscreen' : 'window';
  }

  get showsApp() {
    return this.#page === 'app';
  }

  show() {
    if (this.win.isMinimized()) this.win.restore();
    this.win.show();
    this.win.focus();
    app.focus({ steal: true });
  }

  showServerPage() {
    const path = this.#pending;
    this.#pending = '/';
    this.#page = 'app';
    return isLoaded(this.win.loadURL(new URL(path, this.origin).toString()));
  }

  showWaiting(view: EngineScreenView) {
    this.#page = 'waiting';
    return isLoaded(
      this.win.loadFile(join(app.getAppPath(), 'static', 'waiting.html'), {
        query: {
          title: view.title,
          text: view.text,
          detail: view.detail,
          busy: view.busy ? '1' : '',
          actions: view.actions.map((action) => `${action}:${ENGINE_ACTION_LABEL[action]}`).join('|'),
        },
      })
    );
  }

  get showsWaiting() {
    return this.#page === 'waiting';
  }

  open(path: string) {
    if (this.#page === 'app') this.win.webContents.send(CHANNELS.navigate, path);
    else this.#pending = path;
  }

  step(offset: -1 | 1) {
    if (this.#page !== 'app') return;
    const history = this.win.webContents.navigationHistory;
    const urls = Array.from(
      { length: history.length() },
      (_, entry) => history.getEntryAtIndex(entry)?.url ?? ''
    );
    const index = resolveHistoryStep(urls, history.getActiveIndex(), offset, this.origin);
    if (index !== null) history.goToIndex(index);
  }

  reload() {
    if (this.#page === 'app') this.win.webContents.reload();
    else this.#onLoadFailed();
  }

  isAppSender(event: IpcMainEvent) {
    const frame = event.senderFrame;
    if (event.sender !== this.win.webContents || !frame || frame.parent) return false;
    try {
      return isAppUrl(new URL(frame.url), this.origin);
    } catch {
      return false;
    }
  }

  markQuitting() {
    this.#quitting = true;
  }
}
