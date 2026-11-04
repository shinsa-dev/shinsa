import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { HttpClientRequest } from 'effect/http';
import { runApp } from '@/lib/runtime/app.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';
import { sendThrough } from '@/lib/runtime/fetch.ts';
import { enterPromise, enterPromiseOr } from '@/lib/runtime/promise.ts';
import { answerFetch } from '../../support/fetch-fake.ts';

const readProjects = Effect.gen(function* () {
  const engine = yield* EngineClient;
  return yield* engine.state.projects();
});

describe('a machine’s own fetch', () => {
  it('sends the engine client’s requests through it, as Request objects, never the page’s fetch', async () => {
    const page = answerFetch(() => Response.json({ projects: [{ id: 'page' }], focus: null }));
    const sent: Request[] = [];
    const answer = await runApp(
      readProjects.pipe(
        Effect.provide(EngineClient.through(HttpClientRequest.prependUrl('https://app.shinsa.dev'))),
        sendThrough((request) => {
          sent.push(request);
          return Promise.resolve(Response.json({ projects: [], focus: null }));
        })
      )
    );
    expect(answer.projects).toEqual([]);
    expect(sent.map((request) => `${request.method} ${request.url}`)).toEqual([
      'GET https://app.shinsa.dev/api/projects',
    ]);
    expect(page).toEqual([]);
  });
});

describe('a promise entered into Effect code', () => {
  it('fails with what the promise rejected with, in words', async () => {
    expect(await runApp(enterPromise(() => Promise.resolve(3)))).toBe(3);
    expect(await runApp(Effect.flip(enterPromise(() => Promise.reject(new Error('Gone.')))))).toMatchObject({
      _tag: 'StepFailed',
      message: 'Gone.',
    });
    expect(await runApp(Effect.flip(enterPromise(() => Promise.reject('closed'))))).toMatchObject({
      _tag: 'StepFailed',
      message: 'closed',
    });
  });

  it('fails with the given failure instead when it is given one', async () => {
    const offline = Effect.fail('offline' as const);
    expect(await runApp(enterPromiseOr(() => Promise.resolve(4), offline))).toBe(4);
    expect(await runApp(Effect.flip(enterPromiseOr(() => Promise.reject(new Error('Gone.')), offline)))).toBe(
      'offline'
    );
  });
});
