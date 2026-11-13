import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { createApiClient } from '../../src/cli/api.ts';
import { createSurfaceClient } from '../../src/cli/api.ts';
import { createCommandRelay, createLocalRelay } from '../../src/surface/relay.ts';

const BASE = 'http://127.0.0.1:5180';

describe('relaying a command to a teammate’s machine', () => {
  test('the command line posts it through this machine’s own relay route', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetch = (async (url: string | URL | Request, init?: RequestInit | Request) => {
      const request = init instanceof Request ? init : new Request(String(url), init);
      calls.push({ url: String(url), body: await request.json() });
      return Response.json({ ok: true });
    }) as typeof globalThis.fetch;
    const relay = createCommandRelay(createLocalRelay(BASE, fetch));
    await Effect.runPromise(relay('laptop', { type: 'task.message', taskId: 'lead', text: 'Hi' }));
    expect(calls).toEqual([
      {
        url: `${BASE}/api/teams/relay/laptop/api/commands`,
        body: { type: 'task.message', taskId: 'lead', text: 'Hi' },
      },
    ]);
  });

  test('a refusal comes back as its code, and a machine that cannot be reached as relay_failed', async () => {
    const refusing = (async () =>
      Response.json(
        { error: { code: 'handoff_scope', message: 'No.' } },
        { status: 403 }
      )) as unknown as typeof globalThis.fetch;
    const down = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof globalThis.fetch;
    const send = (fetch: typeof globalThis.fetch) =>
      Effect.runPromise(
        createCommandRelay(createLocalRelay(BASE, fetch))('laptop', {
          type: 'task.message',
          taskId: 'lead',
          text: 'Hi',
        }).pipe(Effect.flip)
      );
    expect(await send(refusing)).toMatchObject({ code: 'handoff_scope', message: 'No.' });
    expect(await send(down)).toMatchObject({ code: 'relay_failed' });
  });

  test('the command line’s client has a relay, so tasks message reaches a teammate’s lead', () => {
    expect(createSurfaceClient(BASE, 'cli:1').relay).toBeDefined();
    expect(createApiClient(BASE).base).toBe(BASE);
  });
});
