import { afterEach, describe, expect, it } from 'bun:test';
import { Effect, Fiber, Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { Socket } from 'effect/socket';
import { forkApp, replaceAppTransport, runApp } from '@/lib/runtime/app.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';
import { answerFetch } from '../../support/fetch-fake.ts';

const readProjects = Effect.gen(function* () {
  const engine = yield* EngineClient;
  return yield* engine.state.projects();
});

function createGlobalTransport() {
  return Layer.mergeAll(
    Layer.succeed(
      FetchHttpClient.Fetch,
      Object.assign((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init), {
        preconnect: globalThis.fetch.preconnect,
      })
    ),
    Socket.layerWebSocketConstructorGlobal
  );
}

afterEach(() => replaceAppTransport(createGlobalTransport()));

describe('replacing the app’s transport', () => {
  it('sends requests through the page’s fetch until replaced, then through the new fetch and WebSocket', async () => {
    const page = answerFetch(() => Response.json({ projects: [{ id: 'page' }], focus: null }));
    expect((await runApp(readProjects)).projects.map((project) => project.id)).toEqual(['page']);
    expect(page).toHaveLength(1);
    const sent: string[] = [];
    const standIn = Object.assign(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        sent.push(`${request.method} ${new URL(request.url).pathname}`);
        return Promise.resolve(Response.json({ projects: [], focus: null }));
      },
      { preconnect: globalThis.fetch.preconnect }
    );
    const makeSocket = () => new EventTarget() as unknown as WebSocket;
    replaceAppTransport(
      Layer.mergeAll(
        Layer.succeed(FetchHttpClient.Fetch, standIn),
        Layer.succeed(Socket.WebSocketConstructor, makeSocket)
      )
    );

    const answer = await runApp(readProjects);
    const constructor = await runApp(
      Effect.gen(function* () {
        return yield* Socket.WebSocketConstructor;
      })
    );

    expect(answer.projects).toEqual([]);
    expect(sent).toEqual(['GET /api/projects']);
    expect(page).toHaveLength(1);
    expect(constructor).toBe(makeSocket);
  });

  it('runs a forked effect on the same runtime', async () => {
    const fiber = forkApp(Effect.succeed('forked'));
    expect(await Effect.runPromise(Fiber.join(fiber))).toBe('forked');
  });
});
