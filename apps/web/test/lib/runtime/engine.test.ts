import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { enterReadOnly, READ_ONLY_REFUSAL } from '@/lib/connection/read-only.ts';
import { runApp } from '@/lib/runtime/app.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';
import { answerFetch } from '../../support/fetch-fake.ts';
import { addTeardown } from '../../support/teardown.ts';

function callEngine<A, E>(call: (engine: EngineClient['Service']) => Effect.Effect<A, E>) {
  return Effect.gen(function* () {
    return yield* call(yield* EngineClient);
  });
}

const readHealth = callEngine((engine) => engine.server.health());

const refreshAccounts = callEngine((engine) => engine.accounts.refresh({ payload: { scope: 'all' } }));

describe('EngineClient', () => {
  it('reads an answer from the engine at its path', async () => {
    const requests = answerFetch(() => Response.json({ ok: true, version: '1.0.0', protocol: 3 }));
    expect(await runApp(readHealth)).toEqual({ ok: true, version: '1.0.0', protocol: 3 });
    expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual(['GET /api/health']);
    expect(requests[0]?.headers.has('traceparent')).toBe(false);
  });

  it('sends a payload as JSON', async () => {
    const requests = answerFetch(() => Response.json({ accounts: [] }));
    await runApp(refreshAccounts);
    expect(requests[0]).toMatchObject({
      method: 'POST',
      path: '/api/accounts/refresh',
      body: { scope: 'all' },
    });
    expect(requests[0]?.headers.get('content-type')).toBe('application/json');
  });

  it('fails with the engine’s own message when it refuses', async () => {
    answerFetch(() =>
      Response.json({ error: { code: 'local_only', message: 'Only on this Mac.' } }, { status: 403 })
    );
    expect(await runApp(Effect.flip(refreshAccounts))).toMatchObject({
      _tag: 'EngineRefused',
      status: 403,
      code: 'local_only',
      message: 'Only on this Mac.',
    });
  });

  it('names the status when a refusal has no readable body', async () => {
    answerFetch(() => new Response('down', { status: 503 }));
    expect(await runApp(Effect.flip(readHealth))).toMatchObject({
      _tag: 'EngineRefused',
      status: 503,
      code: 'request_failed',
      message: 'Shinsa answered with status 503.',
    });
  });

  it('fails as unreachable when the request cannot be sent', async () => {
    answerFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(await runApp(Effect.flip(readHealth))).toMatchObject({
      _tag: 'EngineUnreachable',
      message: 'Couldn’t reach Shinsa.',
    });
  });

  it('refuses every change while a shared task is read-only, and still reads', async () => {
    const requests = answerFetch(() => Response.json({ ok: true }));
    addTeardown(enterReadOnly());
    expect(await runApp(Effect.flip(refreshAccounts))).toMatchObject({
      _tag: 'EngineReadOnly',
      message: READ_ONLY_REFUSAL,
    });
    await runApp(readHealth);
    expect(requests.map(({ path }) => path)).toEqual(['/api/health']);
  });

  it('hands a write conflict back with the file as it is now', async () => {
    answerFetch(() =>
      Response.json(
        { error: { code: 'file_changed', message: 'The file changed.' }, content: 'new' },
        { status: 409 }
      )
    );
    const write = callEngine((engine) =>
      engine.tasks.writeFile({ params: { taskRef: 'LOC-1' }, payload: { path: 'a.ts', content: 'old' } })
    );
    expect(await runApp(Effect.flip(write))).toMatchObject({
      _tag: 'EditConflict',
      message: 'The file changed.',
      content: 'new',
    });
  });

  it('fails as unreadable when an answer breaks its schema', async () => {
    answerFetch(
      () => new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } })
    );
    expect(await runApp(Effect.flip(readHealth))).toMatchObject({
      _tag: 'EngineAnswerInvalid',
      message: 'Shinsa sent an answer this page can’t read.',
    });
    answerFetch(() => Response.json('fine'));
    expect(await runApp(Effect.flip(readHealth))).toMatchObject({ _tag: 'EngineAnswerInvalid' });
  });
});
