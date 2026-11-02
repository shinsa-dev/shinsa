import { Effect, Layer, Logger, Option, PubSub, Queue, Stream } from 'effect';
import { HttpClient, HttpClientError, HttpClientResponse } from 'effect/http';
import { TestClock } from 'effect/testing';
import { AppLifecycle } from '../../src/app/service.ts';
import type { DesktopStart } from '../../src/bridge/schema.ts';
import { PageBridge } from '../../src/bridge/service.ts';
import { CommandLine } from '../../src/command-line/service.ts';
import { Connection } from '../../src/connection/service.ts';
import type { MessageDialog } from '../../src/dialogs/schema.ts';
import { Dialogs } from '../../src/dialogs/service.ts';
import { EngineActions } from '../../src/engine-actions/service.ts';
import type { EngineAction, Registration } from '../../src/engine/schema.ts';
import { EngineSupervisor } from '../../src/engine/service.ts';
import { type FileEntry, FileWriteFailed } from '../../src/files/schema.ts';
import { Files } from '../../src/files/service.ts';
import { FirstHealth } from '../../src/first-health/service.ts';
import { DesktopHost } from '../../src/host/service.ts';
import { Launchctl } from '../../src/launchctl/service.ts';
import { LoginItems } from '../../src/login-items/service.ts';
import { LoginShell } from '../../src/login-shell/service.ts';
import type { MenuCommand, MenuSection } from '../../src/menu/schema.ts';
import { AppMenu } from '../../src/menu/service.ts';
import { NativeNotices } from '../../src/native-notices/service.ts';
import { NativeTray } from '../../src/native-tray/service.ts';
import { NativeWindow } from '../../src/native-window/service.ts';
import type { DesktopNotice, NoticeEvent } from '../../src/notifications/schema.ts';
import { Notifications } from '../../src/notifications/service.ts';
import type { PageMessage } from '../../src/page-channel/schema.ts';
import { PageChannel } from '../../src/page-channel/service.ts';
import { Prefs } from '../../src/prefs/service.ts';
import { EngineServer } from '../../src/server/service.ts';
import type { AboutPanel, ShellEvent, ShellGuards } from '../../src/shell/schema.ts';
import { DesktopShell } from '../../src/shell/service.ts';
import type { TrayClick, TrayView } from '../../src/tray/schema.ts';
import { StatusTray } from '../../src/tray/service.ts';
import { UpdateClient } from '../../src/update-client/service.ts';
import { UpdateLog } from '../../src/update-log/service.ts';
import { UpdateCheckFailed, type UpdateEvent, type UpdaterOptions } from '../../src/updates/schema.ts';
import { Updater } from '../../src/updates/service.ts';
import type {
  NativeWindowEvent,
  NavigationHistory,
  Rect,
  SenderFrame,
  WindowGuards,
} from '../../src/window/schema.ts';
import { AppWindow } from '../../src/window/service.ts';

export type HttpAnswer = { status: number; body: string } | 'refuse' | 'hang';

export type CheckScript = { events?: UpdateEvent[]; download?: boolean } | { fail: string };

export interface DesktopWorld {
  packaged: boolean;
  platform: string;
  version: string;
  env: Record<string, string | undefined>;
  files: Map<string, string>;
  unwritable: Set<string>;
  answer: (path: string) => HttpAnswer;
  requests: string[];
  launchctl: string[][];
  print: () => { ok: boolean; output: string };
  registration: Registration;
  onRegister: () => Registration;
  loginItems: string[];
  onCheck: () => CheckScript;
  checks: number;
  configured: UpdaterOptions[];
  downloads: string[];
  installs: number;
  updateEvents: PubSub.PubSub<UpdateEvent> | null;
  dialogs: MessageDialog[];
  dialogAnswer: (dialog: MessageDialog) => number;
  notices: DesktopNotice[];
  noticesSupported: boolean;
  noticeEvents: Queue.Queue<NoticeEvent>[];
  window: string[];
  sent: [string, unknown][];
  fullScreen: boolean;
  bounds: Rect;
  history: NavigationHistory;
  loads: boolean;
  windowGuards: WindowGuards | null;
  windowEvents: Queue.Queue<NativeWindowEvent> | null;
  tray: TrayView[];
  trayClicks: Queue.Queue<TrayClick> | null;
  argv: string[];
  shell: string[];
  about: AboutPanel[];
  menus: (readonly MenuSection[])[];
  shellGuards: ShellGuards | null;
  shellEvents: Queue.Queue<ShellEvent> | null;
  menuCommands: Queue.Queue<MenuCommand> | null;
  pageMessages: Queue.Queue<PageMessage> | null;
  start: ((frame: SenderFrame) => Effect.Effect<DesktopStart | null>) | null;
  actions: EngineAction[];
  links: Map<string, string>;
  shellPath: (program: string) => string | null;
  shells: string[];
}

export const CONTENTS_ID = 7;

const HOME = '/Users/me';

export const USER_DATA = '/Users/me/Library/Application Support/Shinsa';

export const LOGS = '/Users/me/Library/Logs/Shinsa';

export const RESOURCES = '/Applications/Shinsa.app/Contents/Resources';

export function createWorld(overrides: Partial<DesktopWorld> = {}): DesktopWorld {
  return {
    packaged: true,
    platform: 'darwin',
    version: '1.2.0',
    env: {},
    files: new Map(),
    unwritable: new Set(),
    answer: () => 'refuse',
    requests: [],
    launchctl: [],
    print: () => ({ ok: false, output: '' }),
    registration: 'not-registered',
    onRegister: () => 'enabled',
    loginItems: [],
    onCheck: () => ({}),
    checks: 0,
    configured: [],
    downloads: [],
    installs: 0,
    updateEvents: null,
    dialogs: [],
    dialogAnswer: () => 1,
    notices: [],
    noticesSupported: true,
    noticeEvents: [],
    window: [],
    sent: [],
    fullScreen: false,
    bounds: { x: 10, y: 20, width: 900, height: 700 },
    history: { urls: [], active: 0 },
    loads: true,
    windowGuards: null,
    windowEvents: null,
    tray: [],
    trayClicks: null,
    argv: [],
    shell: [],
    about: [],
    menus: [],
    shellGuards: null,
    shellEvents: null,
    menuCommands: null,
    pageMessages: null,
    start: null,
    actions: [],
    links: new Map(),
    shellPath: () => null,
    shells: [],
    ...overrides,
  };
}

export function answerJson(value: unknown): HttpAnswer {
  return { status: 200, body: JSON.stringify(value) };
}

function makeHttpLayer(world: DesktopWorld) {
  return Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) => {
      world.requests.push(url.pathname);
      const answer = world.answer(url.pathname);
      if (answer === 'hang') return Effect.never;
      if (answer === 'refuse') {
        return Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, description: 'refused' }),
          })
        );
      }
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(answer.body, {
            status: answer.status,
            headers: { 'content-type': 'application/json' },
          })
        )
      );
    })
  );
}

function makeWorldLayer(world: DesktopWorld) {
  return Layer.mergeAll(
    Layer.succeed(
      DesktopHost,
      DesktopHost.of({
        packaged: world.packaged,
        platform: world.platform,
        version: world.version,
        home: HOME,
        uid: 501,
        resourcesPath: RESOURCES,
        userDataPath: USER_DATA,
        logsPath: LOGS,
        env: world.env,
        argv: world.argv,
      })
    ),
    Layer.succeed(
      Files,
      Files.of({
        readText: (path) => Effect.sync(() => Option.fromNullishOr(world.files.get(path))),
        readSize: (path) =>
          Effect.sync(() => Option.map(Option.fromNullishOr(world.files.get(path)), (text) => text.length)),
        exists: (path) => Effect.sync(() => world.files.has(path) || world.links.has(path)),
        readEntry: (path) =>
          Effect.sync((): FileEntry => {
            const target = world.links.get(path);
            if (target !== undefined) return { kind: 'link', target };
            return world.files.has(path) ? { kind: 'file' } : { kind: 'missing' };
          }),
        link: (target, path) =>
          world.unwritable.has(path)
            ? Effect.fail(new FileWriteFailed({ path, message: 'read-only' }))
            : Effect.sync(() => {
                world.links.set(path, target);
              }),
        writeText: (path, text) =>
          world.unwritable.has(path)
            ? Effect.fail(new FileWriteFailed({ path, message: 'read-only' }))
            : Effect.sync(() => {
                world.files.set(path, text);
              }),
        appendText: (path, text) =>
          world.unwritable.has(path)
            ? Effect.fail(new FileWriteFailed({ path, message: 'read-only' }))
            : Effect.sync(() => {
                world.files.set(path, `${world.files.get(path) ?? ''}${text}`);
              }),
        rename: (from, to) =>
          world.unwritable.has(from)
            ? Effect.fail(new FileWriteFailed({ path: from, message: 'read-only' }))
            : Effect.sync(() => {
                world.files.set(to, world.files.get(from) ?? '');
                world.files.delete(from);
              }),
        remove: (path) =>
          Effect.sync(() => {
            world.files.delete(path);
            world.links.delete(path);
          }),
      })
    ),
    Layer.succeed(
      Launchctl,
      Launchctl.of({
        run: (args) =>
          Effect.sync(() => {
            world.launchctl.push([...args]);
            return args[0] === 'print' ? world.print() : { ok: true, output: '' };
          }),
      })
    ),
    Layer.succeed(
      LoginItems,
      LoginItems.of({
        status: Effect.sync(() => world.registration),
        register: Effect.sync(() => {
          world.loginItems.push('register');
          world.registration = world.onRegister();
          return world.registration;
        }),
        unregister: Effect.sync(() => {
          world.loginItems.push('unregister');
          world.registration = 'not-registered';
        }),
      })
    ),
    Layer.succeed(
      LoginShell,
      LoginShell.of({
        run: (program, args) =>
          Effect.sync(() => {
            world.shells.push(`${program} ${args.join(' ')}`);
            return Option.fromNullishOr(world.shellPath(program));
          }),
      })
    ),
    makeHttpLayer(world),
    makeUpdateLayer(world)
  );
}

function makeUpdateLayer(world: DesktopWorld) {
  return Layer.mergeAll(
    Layer.effect(
      UpdateClient,
      Effect.gen(function* () {
        const events = yield* PubSub.unbounded<UpdateEvent>();
        world.updateEvents = events;
        return UpdateClient.of({
          events: Stream.fromPubSub(events),
          configure: (options) =>
            Effect.sync(() => {
              world.configured.push(options);
            }),
          check: Effect.gen(function* () {
            world.checks += 1;
            const script = world.onCheck();
            if ('fail' in script) return yield* new UpdateCheckFailed({ message: script.fail });
            yield* PubSub.publishAll(events, script.events ?? []);
            if (!script.download) return Option.none();
            return Option.some({
              cancel: Effect.sync(() => {
                world.downloads.push('cancel');
              }),
              done: Effect.sync(() => {
                world.downloads.push('done');
              }),
            });
          }),
          quitAndInstall: Effect.sync(() => {
            world.installs += 1;
          }),
        });
      })
    ),
    Layer.succeed(
      Dialogs,
      Dialogs.of({
        show: (dialog) =>
          Effect.sync(() => {
            world.dialogs.push(dialog);
            return world.dialogAnswer(dialog);
          }),
      })
    ),
    makeNativeLayer(world)
  );
}

function record(world: DesktopWorld, call: string) {
  return Effect.sync(() => {
    world.window.push(call);
  });
}

function makeNativeLayer(world: DesktopWorld) {
  return Layer.mergeAll(
    Layer.succeed(
      NativeNotices,
      NativeNotices.of({
        supported: world.noticesSupported,
        show: (notice) =>
          Effect.gen(function* () {
            const events = yield* Queue.unbounded<NoticeEvent>();
            world.notices.push(notice);
            world.noticeEvents.push(events);
            return {
              close: Effect.sync(() => {
                world.shell.push(`close ${notice.tag}`);
                Queue.offerUnsafe(events, 'close');
              }),
              events: Stream.fromQueue(events),
            };
          }),
      })
    ),
    Layer.effect(
      NativeWindow,
      Effect.gen(function* () {
        const events = yield* Queue.unbounded<NativeWindowEvent>();
        world.windowEvents = events;
        return NativeWindow.of({
          contentsId: CONTENTS_ID,
          events: Stream.fromQueue(events),
          guard: (guards) =>
            Effect.sync(() => {
              world.windowGuards = guards;
            }),
          loadUrl: (url) => Effect.as(record(world, `load ${url}`), world.loads),
          loadWaiting: (query) => Effect.as(record(world, `waiting ${query.title}`), world.loads),
          send: (channel, value) =>
            Effect.sync(() => {
              world.sent.push([channel, value]);
            }),
          show: record(world, 'show'),
          hide: record(world, 'hide'),
          reload: record(world, 'reload'),
          fullScreen: Effect.sync(() => world.fullScreen),
          leaveFullScreen: record(world, 'leave-full-screen'),
          normalBounds: Effect.sync(() => world.bounds),
          history: Effect.sync(() => world.history),
          goTo: (index) => record(world, `go ${index}`),
        });
      })
    ),
    Layer.effect(
      NativeTray,
      Effect.gen(function* () {
        const clicks = yield* Queue.unbounded<TrayClick>();
        world.trayClicks = clicks;
        return NativeTray.of({
          show: (view) =>
            Effect.sync(() => {
              world.tray.push(view);
            }),
          clicks: Stream.fromQueue(clicks),
        });
      })
    ),
    Layer.effect(
      DesktopShell,
      Effect.gen(function* () {
        const events = yield* Queue.unbounded<ShellEvent>();
        const commands = yield* Queue.unbounded<MenuCommand>();
        world.shellEvents = events;
        world.menuCommands = commands;
        const push = (entry: string) =>
          Effect.sync(() => {
            world.shell.push(entry);
          });
        return DesktopShell.of({
          events: Stream.fromQueue(events),
          guard: (guards) =>
            Effect.sync(() => {
              world.shellGuards = guards;
            }),
          quit: push('quit'),
          setBadge: (text) => push(`badge ${text}`),
          openExternal: (url) => push(`open ${url}`),
          writeClipboard: (text) => push(`copy ${text}`),
          setAboutPanel: (panel) =>
            Effect.sync(() => {
              world.about.push(panel);
            }),
          applyMenu: (sections) =>
            Effect.sync(() => {
              world.menus.push(sections);
            }),
          menuCommands: Stream.fromQueue(commands),
        });
      })
    ),
    Layer.effect(
      PageChannel,
      Effect.gen(function* () {
        const messages = yield* Queue.unbounded<PageMessage>();
        world.pageMessages = messages;
        return PageChannel.of({
          messages: Stream.fromQueue(messages),
          serveStart: (answer) =>
            Effect.sync(() => {
              world.start = answer;
            }),
        });
      })
    )
  );
}

export function emitUpdate(world: DesktopWorld, event: UpdateEvent) {
  return Effect.suspend(() => (world.updateEvents ? PubSub.publish(world.updateEvents, event) : Effect.void));
}

export const flush = Effect.repeat(Effect.yieldNow, { times: 50 });

export function closeWindow(world: DesktopWorld) {
  return Effect.runPromise(Effect.suspend(() => world.windowGuards?.close ?? Effect.succeed(false)));
}

export function offer<A>(queue: Queue.Queue<A> | null, value: A) {
  return Effect.andThen(
    Effect.suspend(() => (queue ? Queue.offer(queue, value) : Effect.void)),
    flush
  );
}

function makeDesktopLayer(world: DesktopWorld) {
  return Layer.mergeAll(
    AppLifecycle,
    PageBridge,
    AppMenu.layer,
    StatusTray.layer,
    EngineSupervisor.layer,
    CommandLine.layer
  ).pipe(
    Layer.provideMerge(Updater.layer),
    Layer.provideMerge(Notifications.layer),
    Layer.provideMerge(AppWindow.layer),
    Layer.provideMerge(Layer.mergeAll(EngineServer.layer, Prefs.layer, UpdateLog.layer, EngineActions.layer)),
    Layer.provideMerge(makeWorldLayer(world)),
    Layer.provideMerge(TestClock.layer())
  );
}

export type DesktopServices = Layer.Success<ReturnType<typeof makeDesktopLayer>>;

export function runDesktop<A, E>(world: DesktopWorld, effect: Effect.Effect<A, E, DesktopServices>) {
  const watched = Effect.gen(function* () {
    const actions = yield* EngineActions;
    yield* Effect.forkScoped(
      Stream.runForEach(actions.requests, (action) =>
        Effect.sync(() => {
          world.actions.push(action);
        })
      ),
      { startImmediately: true }
    );
    return yield* effect;
  });
  return Effect.runPromise(
    Effect.scoped(watched).pipe(Effect.provide(Layer.merge(makeDesktopLayer(world), Logger.layer([]))))
  );
}

function makeConnectedLayer(world: DesktopWorld) {
  return Connection.layer.pipe(
    Layer.provideMerge(FirstHealth.layer),
    Layer.provideMerge(makeDesktopLayer(world))
  );
}

export type ConnectedServices = Layer.Success<ReturnType<typeof makeConnectedLayer>>;

export function runConnected<A, E>(world: DesktopWorld, effect: Effect.Effect<A, E, ConnectedServices>) {
  return Effect.runPromise(
    Effect.scoped(effect).pipe(Effect.provide(Layer.merge(makeConnectedLayer(world), Logger.layer([]))))
  );
}
