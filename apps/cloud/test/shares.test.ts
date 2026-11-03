import { describe, expect, test } from 'bun:test';
import { REMOTE_PATHS, resolveShareConnectPath, type ShareConnectResponse } from '@shinsa/core';
import { createHarness, pairMachine, readJson } from './harness.ts';

describe('a share link', () => {
  test('learns where the machine is without signing in, and nothing else', async () => {
    const harness = createHarness();
    const credentials = await pairMachine(harness, await harness.signIn('mona', 1));
    const response = await harness.post(resolveShareConnectPath(credentials.instanceId), {});
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
    expect(await readJson<ShareConnectResponse>(response)).toEqual({
      url: `wss://${credentials.tunnelHost}`,
      online: false,
    });
    await harness.post(
      REMOTE_PATHS.heartbeat,
      { localUrl: 'http://127.0.0.1:7446', version: '1' },
      { bearer: credentials.machineToken, sameOrigin: false }
    );
    const online = await harness.post(resolveShareConnectPath(credentials.instanceId), {});
    expect((await readJson<ShareConnectResponse>(online)).online).toBe(true);
  });

  test('to a machine that does not exist says the link is wrong', async () => {
    const harness = createHarness();
    const response = await harness.post(resolveShareConnectPath('missing'), {});
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'not_found', message: 'This task is no longer shared, or the link is wrong.' },
    });
  });

  test('opens a page that search engines are told not to keep', async () => {
    const harness = createHarness();
    const page = await harness.call('/share/t/abc');
    expect(page.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
    expect(page.headers.get('referrer-policy')).toBe('no-referrer');
    expect((await harness.call('/')).headers.get('x-robots-tag')).toBeNull();
  });
});
