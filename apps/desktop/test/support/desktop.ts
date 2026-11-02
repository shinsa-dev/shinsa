import { Effect, Layer, Logger, Option, PubSub, Stream } from 'effect';
import { HttpClient, HttpClientError, HttpClientResponse } from 'effect/http';
import { TestClock } from 'effect/testing';
import type { MessageDialog } from '../../src/dialogs/schema.ts';
import { Dialogs } from '../../src/dialogs/service.ts';
import type { Registration } from '../../src/engine/schema.ts';
import { EngineSupervisor } from '../../src/engine/service.ts';
import { FileWriteFailed } from '../../src/files/schema.ts';
import { Files } from '../../src/files/service.ts';
import { DesktopHost } from '../../src/host/service.ts';
import { Launchctl } from '../../src/launchctl/service.ts';
import { LoginItems } from '../../src/login-items/service.ts';
import type { DesktopNotice } from '../../src/notifications/schema.ts';
import { Notifications } from '../../src/notifications/service.ts';
import { Prefs } from '../../src/prefs/service.ts';
import { EngineServer } from '../../src/server/service.ts';
import { UpdateClient } from '../../src/update-client/service.ts';
import { UpdateLog } from '../../src/update-log/service.ts';
import { UpdateCheckFailed, type UpdateEvent, type UpdaterOptions } from '../../src/updates/schema.ts';
import { Updater } from '../../src/updates/service.ts';
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
  window: string[];
}

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
    window: [],
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
      })
    ),
    Layer.succeed(
      Files,
      Files.of({
        readText: (path) => Effect.sync(() => Option.fromNullishOr(world.files.get(path))),
        readSize: (path) =>
          Effect.sync(() => Option.map(Option.fromNullishOr(world.files.get(path)), (text) => text.length)),
        exists: (path) => Effect.sync(() => world.files.has(path)),
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
    Layer.succeed(
      Notifications,
      Notifications.of({
        show: (notice) =>
          Effect.sync(() => {
            world.notices.push(notice);
          }),
      })
    ),
    Layer.succeed(
      AppWindow,
      AppWindow.of({
        show: Effect.sync(() => {
          world.window.push('show');
        }),
        markQuitting: Effect.sync(() => {
          world.window.push('markQuitting');
        }),
      })
    )
  );
}

export function emitUpdate(world: DesktopWorld, event: UpdateEvent) {
  return Effect.suspend(() => (world.updateEvents ? PubSub.publish(world.updateEvents, event) : Effect.void));
}

export const flush = Effect.repeat(Effect.yieldNow, { times: 50 });

export function runDesktop<A, E>(
  world: DesktopWorld,
  effect: Effect.Effect<A, E, EngineServer | EngineSupervisor | Updater | Prefs | UpdateLog>
) {
  const layer = Layer.mergeAll(EngineSupervisor.layer, Updater.layer).pipe(
    Layer.provideMerge(Layer.mergeAll(EngineServer.layer, Prefs.layer, UpdateLog.layer)),
    Layer.provide(makeWorldLayer(world)),
    Layer.provideMerge(TestClock.layer())
  );
  return Effect.runPromise(effect.pipe(Effect.provide(Layer.merge(layer, Logger.layer([])))));
}
