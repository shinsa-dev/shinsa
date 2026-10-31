import { describe, expect, it } from 'bun:test';
import { createDashboardClient, DashboardError, resolveSignInUrl } from '@/lib/remote/dashboard.ts';

function createClient(answer: (path: string, init: RequestInit | undefined) => Response | Promise<Response>) {
  const calls: { path: string; method: string; body: unknown }[] = [];
  const client = createDashboardClient((path, init) => {
    calls.push({ path, method: init?.method ?? 'GET', body: init?.body });
    return Promise.resolve(answer(path, init));
  });
  return { client, calls };
}

describe('the dashboard client', () => {
  it('calls each route of app.shinsa.dev with the right method', async () => {
    const { client, calls } = createClient(() => Response.json({ ok: true }));
    await client.readSession();
    await client.listInstances();
    await client.requestConnect('k3x9');
    await client.removeInstance('k3x9');
    await client.leaveInstance('k3x9');
    await client.acceptInvite('invite-1');
    await client.readPair('K7PQ');
    await client.approvePair('K7PQ');
    await client.signOut();
    expect(calls).toEqual([
      { path: '/__remote/session', method: 'GET', body: undefined },
      { path: '/__remote/instances', method: 'GET', body: undefined },
      { path: '/__remote/instances/k3x9/connect', method: 'POST', body: '{}' },
      { path: '/__remote/instances/k3x9/remove', method: 'POST', body: '{}' },
      { path: '/__remote/instances/k3x9/leave', method: 'POST', body: '{}' },
      { path: '/__remote/invites/accept', method: 'POST', body: '{"token":"invite-1"}' },
      { path: '/__remote/pairs/K7PQ', method: 'GET', body: undefined },
      { path: '/__remote/pairs/K7PQ/approve', method: 'POST', body: '{}' },
      { path: '/__remote/sign-out', method: 'POST', body: '{}' },
    ]);
  });

  it('turns a refusal into an error with its code and message', async () => {
    const { client } = createClient(() =>
      Response.json(
        { error: { code: 'pair_expired', message: 'This pairing code expired.' } },
        { status: 404 }
      )
    );
    const error = await client.readPair('K7PQ').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DashboardError);
    expect(error).toMatchObject({ code: 'pair_expired', message: 'This pairing code expired.', status: 404 });
  });

  it('says what happened when the answer is not one of its errors, or nothing answered', async () => {
    const odd = createClient(() => Response.json({ error: { code: 1 } }, { status: 500 }));
    await expect(odd.client.listInstances()).rejects.toMatchObject({
      code: 'failed',
      message: 'Shinsa Cloud answered 500.',
    });
    const html = createClient(() => new Response('<html>', { status: 502 }));
    await expect(html.client.listInstances()).rejects.toMatchObject({ code: 'failed', status: 502 });
    const offline = createDashboardClient(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(offline.listInstances()).rejects.toMatchObject({ code: 'offline' });
  });

  it('builds the sign-in link back to where you were', () => {
    expect(decodeURIComponent(resolveSignInUrl('/pair?code=K7PQ'))).toBe(
      '/__remote/sign-in?return=/pair?code=K7PQ'
    );
  });

  it('uses the page’s fetch by default', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(Response.json({ user: null }))) as unknown as typeof fetch;
    expect(await createDashboardClient().readSession()).toEqual({ user: null });
    globalThis.fetch = realFetch;
  });
});
