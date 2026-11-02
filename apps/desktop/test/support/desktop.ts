import { Effect, Layer, Logger, Option } from 'effect';
import { HttpClient, HttpClientError, HttpClientResponse } from 'effect/http';
import { TestClock } from 'effect/testing';
import type { Registration } from '../../src/engine/schema.ts';
import { EngineSupervisor } from '../../src/engine/service.ts';
import { FileWriteFailed } from '../../src/files/schema.ts';
import { Files } from '../../src/files/service.ts';
import { DesktopHost } from '../../src/host/service.ts';
import { Launchctl } from '../../src/launchctl/service.ts';
import { LoginItems } from '../../src/login-items/service.ts';
import { EngineServer } from '../../src/server/service.ts';

export type HttpAnswer = { status: number; body: string } | 'refuse' | 'hang';

export interface DesktopWorld {
  packaged: boolean;
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
}

const HOME = '/Users/me';

export const RESOURCES = '/Applications/Shinsa.app/Contents/Resources';

export function createWorld(overrides: Partial<DesktopWorld> = {}): DesktopWorld {
  return {
    packaged: true,
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
        home: HOME,
        uid: 501,
        resourcesPath: RESOURCES,
        env: world.env,
      })
    ),
    Layer.succeed(
      Files,
      Files.of({
        readText: (path) => Effect.sync(() => Option.fromNullishOr(world.files.get(path))),
        exists: (path) => Effect.sync(() => world.files.has(path)),
        writeText: (path, text) =>
          world.unwritable.has(path)
            ? Effect.fail(new FileWriteFailed({ path, message: 'read-only' }))
            : Effect.sync(() => {
                world.files.set(path, text);
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
    makeHttpLayer(world)
  );
}

export function runDesktop<A, E>(
  world: DesktopWorld,
  effect: Effect.Effect<A, E, EngineServer | EngineSupervisor>
) {
  const layer = EngineSupervisor.layer.pipe(
    Layer.provideMerge(EngineServer.layer),
    Layer.provide(makeWorldLayer(world)),
    Layer.provideMerge(TestClock.layer())
  );
  return Effect.runPromise(effect.pipe(Effect.provide(Layer.merge(layer, Logger.layer([])))));
}
