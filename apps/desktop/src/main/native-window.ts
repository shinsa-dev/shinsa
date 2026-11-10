import { join } from 'node:path';
import { Effect, Layer, Queue, Stream } from 'effect';
import {
  app,
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
  nativeTheme,
  screen,
  type WebContents,
} from 'electron';
import { APP_NAME } from '../app/schema.ts';
import { NativeWindow } from '../native-window/service.ts';
import { Prefs } from '../prefs/service.ts';
import { resolveWindowBounds } from '../window/bounds.ts';
import { listContextMenuEntries } from '../window/context-menu.ts';
import {
  type ContextAction,
  type ContextMenuEntry,
  MIN_SIZE,
  type NativeWindowEvent,
  type WindowGuards,
} from '../window/schema.ts';

const TRAFFIC_LIGHTS = { x: 16, y: 15 };

const BACKGROUND = { dark: '#101012', light: '#ffffff' };

const runContextAction = (contents: WebContents, action: ContextAction) => {
  switch (action._tag) {
    case 'Replace':
      return contents.replaceMisspelling(action.word);
    case 'Learn':
      return void contents.session.addWordToSpellCheckerDictionary(action.word);
    case 'LookUp':
      return contents.showDefinitionForSelection();
  }
};

const toContextItem = (contents: WebContents, entry: ContextMenuEntry): MenuItemConstructorOptions => {
  switch (entry.kind) {
    case 'separator':
      return { type: 'separator' };
    case 'role':
      return { role: entry.role, enabled: entry.enabled };
    case 'note':
      return { label: entry.label, enabled: false };
    case 'action':
      return { label: entry.label, click: () => runContextAction(contents, entry.action) };
  }
};

const lockZoom = (contents: WebContents) =>
  Effect.andThen(
    Effect.sync(() => contents.setZoomLevel(0)),
    Effect.ignore(Effect.tryPromise(() => contents.setVisualZoomLevelLimits(1, 1)))
  );

const loaded = (load: () => Promise<void>) =>
  Effect.match(Effect.tryPromise(load), { onFailure: () => false, onSuccess: () => true });

export const NativeWindowLive = Layer.effect(
  NativeWindow,
  Effect.gen(function* () {
    const stored = yield* (yield* Prefs).read;
    const events = yield* Queue.unbounded<NativeWindowEvent>();
    const emit = (event: NativeWindowEvent) => {
      Queue.offerUnsafe(events, event);
    };
    let guards: WindowGuards | null = null;
    const win = new BrowserWindow({
      ...resolveWindowBounds(
        stored.windowBounds,
        screen.getAllDisplays().map((each) => each.workArea),
        screen.getPrimaryDisplay().workArea
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
        devTools: false,
      },
    });
    const contents = win.webContents;
    win.once('ready-to-show', () => win.show());
    win.on('close', (event) => {
      if (guards && !Effect.runSync(guards.close)) event.preventDefault();
    });
    win.on('enter-full-screen', () => emit({ _tag: 'FullScreen', on: true }));
    win.on('leave-full-screen', () => emit({ _tag: 'FullScreen', on: false }));
    win.on('resized', () => emit({ _tag: 'BoundsChanged' }));
    win.on('moved', () => emit({ _tag: 'BoundsChanged' }));
    contents.on('will-navigate', (details) => {
      if (!guards || !Effect.runSync(guards.navigate(details.url))) details.preventDefault();
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (guards) Effect.runSync(guards.openWindow(url));
      return { action: 'deny' };
    });
    contents.on('did-fail-load', (_event, code, _description, _url, mainFrame) =>
      emit({ _tag: 'LoadFailed', code, mainFrame })
    );
    contents.on('did-finish-load', () => Effect.runFork(lockZoom(contents)));
    contents.on('zoom-changed', () => Effect.runFork(lockZoom(contents)));
    contents.on('context-menu', (_event, params) => {
      const entries = listContextMenuEntries(params);
      if (entries.length === 0) return;
      Menu.buildFromTemplate(entries.map((entry) => toContextItem(contents, entry))).popup({ window: win });
    });
    contents.on('render-process-gone', () => emit({ _tag: 'RendererGone' }));
    return NativeWindow.of({
      contentsId: contents.id,
      events: Stream.fromQueue(events),
      guard: (next) =>
        Effect.sync(() => {
          guards = next;
        }),
      loadUrl: (url) => loaded(() => win.loadURL(url)),
      loadWaiting: (query) =>
        loaded(() => win.loadFile(join(app.getAppPath(), 'static', 'waiting.html'), { query: { ...query } })),
      send: (channel, ...value) => Effect.sync(() => contents.send(channel, ...value)),
      show: Effect.sync(() => {
        void app.dock?.show();
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        app.focus({ steal: true });
      }),
      hide: Effect.sync(() => {
        win.hide();
        app.dock?.hide();
      }),
      reload: Effect.sync(() => contents.reload()),
      fullScreen: Effect.sync(() => win.isFullScreen()),
      leaveFullScreen: Effect.sync(() => win.setFullScreen(false)),
      normalBounds: Effect.sync(() => win.getNormalBounds()),
      history: Effect.sync(() => {
        const history = contents.navigationHistory;
        return {
          urls: Array.from(
            { length: history.length() },
            (_, entry) => history.getEntryAtIndex(entry)?.url ?? ''
          ),
          active: history.getActiveIndex(),
        };
      }),
      goTo: (index) => Effect.sync(() => contents.navigationHistory.goToIndex(index)),
    });
  })
);
