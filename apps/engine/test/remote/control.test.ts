import { afterEach, describe, expect, test } from 'bun:test';
import { REMOTE_APP_ORIGIN, REMOTE_PATHS } from '@shinsa/core';
import { ControlClient, ControlError, RevokedError } from '../../src/remote/control.ts';
import { type FakeControlPlane, startFakeControlPlane } from './control-plane.ts';

let current: FakeControlPlane | null = null;

afterEach(async () => {
  await current?.stop();
  current = null;
});

function start() {
  current = startFakeControlPlane();
  return { plane: current, client: new ControlClient({ origin: current.origin }) };
}

describe('the control-plane client', () => {
  test('defaults to shinsa.dev/app', () => {
    expect(new ControlClient().origin).toBe(REMOTE_APP_ORIGIN);
  });

  test('starts and polls pairing without a token', async () => {
    const { plane, client } = start();
    expect(await client.requestPairStart({ name: 'Mac', publicKey: 'p', version: '1' })).toMatchObject({
      claimCode: 'c',
    });
    expect(await client.requestPairPoll({ claimCode: 'c', pollSecret: 's' })).toEqual({ status: 'pending' });
    expect(plane.calls.map((call) => [call.path, call.token])).toEqual([
      [REMOTE_PATHS.pairStart, null],
      [REMOTE_PATHS.pairPoll, null],
    ]);
  });

  test('sends heartbeats, offline and removal with the machine token', async () => {
    const { plane, client } = start();
    await client.recordHeartbeat('m', { localUrl: 'http://127.0.0.1:7446', version: '1' });
    await client.recordOffline('m');
    await client.requestRemoval('m');
    expect(plane.calls).toEqual([
      { path: REMOTE_PATHS.heartbeat, token: 'm', body: { localUrl: 'http://127.0.0.1:7446', version: '1' } },
      { path: REMOTE_PATHS.offline, token: 'm', body: {} },
      { path: REMOTE_PATHS.machineRemove, token: 'm', body: {} },
    ]);
  });

  test('reads a 401 to a machine call as revoked, and any other failure as a control error', async () => {
    const { plane, client } = start();
    plane.answers.set(REMOTE_PATHS.heartbeat, () => new Response('', { status: 401 }));
    await expect(client.recordHeartbeat('m', { localUrl: 'u', version: '1' })).rejects.toBeInstanceOf(
      RevokedError
    );
    plane.answers.set(REMOTE_PATHS.pairPoll, () => new Response('', { status: 401 }));
    const failure = client.requestPairPoll({ claimCode: 'c', pollSecret: 's' });
    await expect(failure).rejects.toBeInstanceOf(ControlError);
    await expect(failure).rejects.toMatchObject({ status: 401 });
  });
});
