import { afterEach, describe, expect, test } from 'bun:test';
import {
  REMOTE_APP_ORIGIN,
  REMOTE_PATHS,
  resolveMachineFilePath,
  resolveMachinePublicationPath,
  resolveMachinePublicationRemovePath,
  type SharedTask,
} from '@shinsa/core';
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
  test('defaults to app.shinsa.dev', () => {
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

  test('publishes, checks and uploads a shared task’s files, and removes it, with the machine token', async () => {
    const { plane, client } = start();
    plane.answers.set(REMOTE_PATHS.machineFilesCheck, () => Response.json({ missing: ['h1'] }));
    plane.answers.set(resolveMachinePublicationPath('t1'), () =>
      Response.json({ url: 'https://app.shinsa.dev/share/x' })
    );
    expect(await client.requestMissingFiles('m', ['h1', 'h2'])).toEqual({ missing: ['h1'] });
    await client.uploadFile('m', 'h1', new TextEncoder().encode('png'), 'image/png');
    const shared = { task: { id: 't1' } } as unknown as SharedTask;
    expect(await client.writePublication('m', 't1', { shared, files: [], newLink: true })).toEqual({
      url: 'https://app.shinsa.dev/share/x',
    });
    await client.removePublication('m', 't1');
    expect(plane.calls).toEqual([
      { path: REMOTE_PATHS.machineFilesCheck, token: 'm', body: { hashes: ['h1', 'h2'] } },
      { path: resolveMachineFilePath('h1'), token: 'm', body: { contentType: 'image/png', text: 'png' } },
      { path: resolveMachinePublicationPath('t1'), token: 'm', body: { shared, files: [], newLink: true } },
      { path: resolveMachinePublicationRemovePath('t1'), token: 'm', body: {} },
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
