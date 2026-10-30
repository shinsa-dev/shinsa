import { describe, expect, test } from 'bun:test';
import {
  CONNECT_TOKEN_TTL_MS,
  type ConnectResponse,
  type MachineCredentials,
  type PairPollResponse,
  type PairStartResponse,
  REMOTE_KEY_ALGORITHM,
  REMOTE_PATHS,
  type RemoteInstance,
  resolveInstanceConnectPath,
  resolveInstanceRemovePath,
  resolvePairApprovePath,
  serializePublicKey,
  verifyConnectToken,
} from '@shinsa/core';
import { ONLINE_WINDOW_MS } from '../src/instances.ts';
import { createHarness, type Harness, readJson } from './harness.ts';

async function pairMachine(harness: Harness, session: string, name = 'Studio') {
  const pair = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, ['deriveBits'])) as CryptoKeyPair;
  const publicKey = await serializePublicKey(pair.publicKey);
  const start = await readJson<PairStartResponse>(
    await harness.post(REMOTE_PATHS.pairStart, { name, publicKey, version: '1' })
  );
  await harness.post(resolvePairApprovePath(start.claimCode), {}, { session });
  const claimed = await readJson<PairPollResponse>(
    await harness.post(REMOTE_PATHS.pairPoll, { claimCode: start.claimCode, pollSecret: start.pollSecret })
  );
  if (claimed.status !== 'claimed') throw new Error('Pairing was not claimed.');
  return claimed.credentials;
}

function heartbeat(harness: Harness, credentials: MachineCredentials, localUrl = 'http://127.0.0.1:7446') {
  return harness.post(
    REMOTE_PATHS.heartbeat,
    { localUrl, version: '1' },
    { bearer: credentials.machineToken, sameOrigin: false }
  );
}

async function listInstances(harness: Harness, session: string) {
  return readJson<RemoteInstance[]>(await harness.call(REMOTE_PATHS.instances, { session }));
}

describe('instances', () => {
  test('lists only your own machines, online while they heartbeat', async () => {
    const harness = createHarness();
    const mona = await harness.signIn('mona', 1);
    const kai = await harness.signIn('kai', 2);
    const studio = await pairMachine(harness, mona, 'Studio');
    await pairMachine(harness, kai, 'Other');
    const before = await listInstances(harness, mona);
    expect(before).toEqual([
      {
        id: studio.instanceId,
        name: 'Studio',
        fingerprint: expect.stringMatching(/^[0-9a-f ]{24}$/),
        online: false,
        lastSeenAt: null,
        createdAt: harness.clock.now,
      },
    ]);
    expect((await heartbeat(harness, studio)).status).toBe(200);
    expect((await listInstances(harness, mona))[0]).toMatchObject({
      online: true,
      lastSeenAt: harness.clock.now,
    });
    harness.clock.now += ONLINE_WINDOW_MS;
    expect((await listInstances(harness, mona))[0]?.online).toBe(false);
    expect((await harness.call(REMOTE_PATHS.instances)).status).toBe(401);
  });

  test('goes offline at once when the machine says so', async () => {
    const harness = createHarness();
    const session = await harness.signIn();
    const studio = await pairMachine(harness, session);
    await heartbeat(harness, studio);
    const offline = await harness.post(
      REMOTE_PATHS.offline,
      {},
      { bearer: studio.machineToken, sameOrigin: false }
    );
    expect(offline.status).toBe(200);
    expect((await listInstances(harness, session))[0]?.online).toBe(false);
  });

  test('moves the tunnel to the port the machine now listens on, only when it changed', async () => {
    const harness = createHarness();
    const session = await harness.signIn();
    const studio = await pairMachine(harness, session);
    const configurations = () =>
      harness.calls.filter((call) => call.method === 'PUT' && call.url.endsWith('/configurations'));
    await heartbeat(harness, studio, 'http://127.0.0.1:5180');
    await heartbeat(harness, studio, 'http://127.0.0.1:5180');
    expect(configurations()).toHaveLength(2);
    expect(JSON.parse(configurations()[1]?.body ?? '').config.ingress[0].service).toBe(
      'http://127.0.0.1:5180'
    );
  });

  test('refuses a heartbeat that points the tunnel anywhere but loopback', async () => {
    const harness = createHarness();
    const session = await harness.signIn();
    const studio = await pairMachine(harness, session);
    for (const localUrl of ['http://10.0.0.5:7446', 'https://127.0.0.1:7446', 'not a url'])
      expect((await heartbeat(harness, studio, localUrl)).status).toBe(400);
    expect((await heartbeat(harness, studio, 'http://[::1]:7446')).status).toBe(200);
  });

  test('answers 401 to a machine token it does not know', async () => {
    const harness = createHarness();
    const unknown = await harness.post(
      REMOTE_PATHS.heartbeat,
      { localUrl: 'http://127.0.0.1:7446', version: '1' },
      { bearer: 'nope', sameOrigin: false }
    );
    expect(unknown.status).toBe(401);
    const none = await harness.post(REMOTE_PATHS.offline, {}, { sameOrigin: false });
    expect(none.status).toBe(401);
  });

  test('mints a short connect token the machine can check with its own key', async () => {
    const harness = createHarness();
    const session = await harness.signIn('mona', 7);
    const studio = await pairMachine(harness, session);
    const answer = await readJson<ConnectResponse>(
      await harness.post(resolveInstanceConnectPath(studio.instanceId), {}, { session })
    );
    expect(answer.expiresAt).toBe(harness.clock.now + CONNECT_TOKEN_TTL_MS);
    const url = new URL(answer.url);
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe(
      `wss://t-${studio.instanceId}.shinsa.dev/remote`
    );
    const token = url.searchParams.get('token') ?? '';
    const claim = await verifyConnectToken(studio.connectKey, token, studio.instanceId, harness.clock.now);
    expect(claim).toEqual({ instanceId: studio.instanceId, userId: '7', expiresAt: answer.expiresAt });
  });

  test('never mints a token for someone else’s machine or from another site', async () => {
    const harness = createHarness();
    const mona = await harness.signIn('mona', 1);
    const kai = await harness.signIn('kai', 2);
    const studio = await pairMachine(harness, mona);
    const foreign = await harness.post(resolveInstanceConnectPath(studio.instanceId), {}, { session: kai });
    expect(foreign.status).toBe(404);
    const crossSite = await harness.post(
      resolveInstanceConnectPath(studio.instanceId),
      {},
      { session: mona, sameOrigin: false }
    );
    expect(crossSite.status).toBe(403);
  });

  test('removing a machine on the dashboard deletes its tunnel and DNS, and its next heartbeat is refused', async () => {
    const harness = createHarness();
    const session = await harness.signIn();
    const studio = await pairMachine(harness, session);
    const removed = await harness.post(resolveInstanceRemovePath(studio.instanceId), {}, { session });
    expect(removed.status).toBe(200);
    const deletes = harness.calls
      .filter((call) => call.method === 'DELETE')
      .map((call) => new URL(call.url).pathname);
    expect(deletes).toEqual([
      '/client/v4/zones/zone-1/dns_records/record-1',
      '/client/v4/accounts/account-1/cfd_tunnel/tunnel-1',
    ]);
    expect(await listInstances(harness, session)).toEqual([]);
    expect((await heartbeat(harness, studio)).status).toBe(401);
  });

  test('a machine can remove itself', async () => {
    const harness = createHarness();
    const session = await harness.signIn();
    const studio = await pairMachine(harness, session);
    const removed = await harness.post(
      REMOTE_PATHS.machineRemove,
      {},
      { bearer: studio.machineToken, sameOrigin: false }
    );
    expect(removed.status).toBe(200);
    expect(await listInstances(harness, session)).toEqual([]);
  });
});
