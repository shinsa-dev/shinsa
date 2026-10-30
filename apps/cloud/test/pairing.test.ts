import { describe, expect, spyOn, test } from 'bun:test';
import {
  type PairPollResponse,
  type PairStartResponse,
  type PairView,
  REMOTE_KEY_ALGORITHM,
  REMOTE_PATHS,
  resolveKeyFingerprint,
  resolvePairApprovePath,
  resolvePairPath,
  serializePublicKey,
} from '@shinsa/core';
import { MAX_INSTANCES_PER_USER, MAX_PENDING_PAIRS_PER_ADDRESS, PAIR_TTL_MS } from '../src/pairing.ts';
import { createHarness, type Harness, readJson } from './harness.ts';

async function createMachineKey() {
  const pair = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, ['deriveBits'])) as CryptoKeyPair;
  return serializePublicKey(pair.publicKey);
}

async function startPair(harness: Harness, name = 'Studio') {
  const publicKey = await createMachineKey();
  const response = await harness.post(
    REMOTE_PATHS.pairStart,
    { name, publicKey, version: '1.2.0' },
    { sameOrigin: false }
  );
  return { publicKey, start: await readJson<PairStartResponse>(response) };
}

function poll(harness: Harness, start: PairStartResponse, pollSecret = start.pollSecret) {
  return harness
    .post(REMOTE_PATHS.pairPoll, { claimCode: start.claimCode, pollSecret }, { sameOrigin: false })
    .then((response) => readJson<PairPollResponse>(response));
}

describe('pairing a machine', () => {
  test('starts with a short code and a link to approve it, and polls as pending', async () => {
    const harness = createHarness();
    const { start } = await startPair(harness);
    expect(start.claimCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(start.url).toBe(`https://app.shinsa.dev/pair?code=${start.claimCode}`);
    expect(start.expiresAt).toBe(harness.clock.now + PAIR_TTL_MS);
    expect(await poll(harness, start)).toEqual({ status: 'pending' });
  });

  test('shows the machine and its key fingerprint to the signed-in person who approves it', async () => {
    const harness = createHarness();
    const { start, publicKey } = await startPair(harness);
    expect((await harness.call(resolvePairPath(start.claimCode))).status).toBe(401);
    const session = await harness.signIn();
    const view = await readJson<PairView>(
      await harness.call(resolvePairPath(start.claimCode.toLowerCase()), { session })
    );
    expect(view).toEqual({
      claimCode: start.claimCode,
      name: 'Studio',
      fingerprint: await resolveKeyFingerprint(publicKey),
      expiresAt: start.expiresAt,
      claimed: false,
    });
  });

  test('approving makes a tunnel, its DNS record and the instance, and the machine collects its credentials once', async () => {
    const harness = createHarness();
    const { start } = await startPair(harness);
    const session = await harness.signIn('mona', 42);
    const approved = await harness.post(resolvePairApprovePath(start.claimCode), {}, { session });
    const { instanceId } = await readJson<{ instanceId: string }>(approved);
    expect(instanceId).toMatch(/^[a-z0-9]{12}$/);
    const api = harness.calls.filter((call) => call.url.startsWith('https://api.cloudflare.com'));
    expect(api.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      'POST /client/v4/accounts/account-1/cfd_tunnel',
      'PUT /client/v4/accounts/account-1/cfd_tunnel/tunnel-1/configurations',
      'GET /client/v4/accounts/account-1/cfd_tunnel/tunnel-1/token',
      'GET /client/v4/zones',
      'POST /client/v4/zones/zone-1/dns_records',
    ]);
    expect(api[0]?.headers.get('authorization')).toBe('Bearer api-token');
    expect(JSON.parse(api[1]?.body ?? '')).toEqual({
      config: {
        ingress: [
          { hostname: `t-${instanceId}.shinsa.dev`, service: 'http://127.0.0.1:7446' },
          { service: 'http_status:404' },
        ],
      },
    });
    expect(JSON.parse(api[4]?.body ?? '')).toEqual({
      type: 'CNAME',
      name: `t-${instanceId}.shinsa.dev`,
      content: 'tunnel-1.cfargotunnel.com',
      proxied: true,
    });
    const claimed = await poll(harness, start);
    if (claimed.status !== 'claimed') throw new Error('Pairing was not claimed.');
    expect(claimed.owner).toBe('mona');
    expect(claimed.credentials).toMatchObject({
      instanceId,
      tunnelToken: 'tunnel-token-1',
      tunnelHost: `t-${instanceId}.shinsa.dev`,
    });
    expect(await poll(harness, start)).toEqual({ status: 'expired' });
    const stored = harness.db.sqlite.query('SELECT machine_token_hash FROM instances').get() as {
      machine_token_hash: string;
    };
    expect(stored.machine_token_hash).not.toBe(claimed.credentials.machineToken);
  });

  test('never gives the credentials for a wrong poll secret', async () => {
    const harness = createHarness();
    const { start } = await startPair(harness);
    const session = await harness.signIn();
    await harness.post(resolvePairApprovePath(start.claimCode), {}, { session });
    expect(await poll(harness, start, 'guess')).toEqual({ status: 'expired' });
    expect((await poll(harness, start)).status).toBe('claimed');
  });

  test('refuses approving from another site, twice, after the code expired, or past the machine limit', async () => {
    const harness = createHarness();
    const session = await harness.signIn();
    const { start } = await startPair(harness);
    const crossSite = await harness.post(
      resolvePairApprovePath(start.claimCode),
      {},
      { session, sameOrigin: false }
    );
    expect(crossSite.status).toBe(403);
    await harness.post(resolvePairApprovePath(start.claimCode), {}, { session });
    const again = await harness.post(resolvePairApprovePath(start.claimCode), {}, { session });
    expect(again.status).toBe(409);
    const late = await startPair(harness);
    harness.clock.now += PAIR_TTL_MS;
    expect((await harness.post(resolvePairApprovePath(late.start.claimCode), {}, { session })).status).toBe(
      404
    );
    expect(await poll(harness, late.start)).toEqual({ status: 'expired' });
    for (let index = 1; index < MAX_INSTANCES_PER_USER; index++) {
      const next = await startPair(harness);
      expect((await harness.post(resolvePairApprovePath(next.start.claimCode), {}, { session })).status).toBe(
        200
      );
    }
    const over = await startPair(harness);
    const full = await harness.post(resolvePairApprovePath(over.start.claimCode), {}, { session });
    expect(full.status).toBe(409);
    expect(await readJson<{ error: { code: string } }>(full)).toMatchObject({
      error: { code: 'instances_full' },
    });
  });

  test('cleans up a half-made tunnel when Cloudflare refuses a later step', async () => {
    const harness = createHarness();
    harness.handlers.push((call) =>
      call.method === 'POST' && call.url.endsWith('/dns_records')
        ? Response.json({ success: false, errors: [{ message: 'record exists' }] }, { status: 400 })
        : new Response('', { status: 599 })
    );
    const session = await harness.signIn();
    const { start } = await startPair(harness);
    const logged = spyOn(console, 'error').mockImplementation(() => undefined);
    const failed = await harness.post(resolvePairApprovePath(start.claimCode), {}, { session });
    expect(failed.status).toBe(502);
    expect(logged.mock.calls.map((call) => call[0])).toContain('[Cloud] Request failed');
    logged.mockRestore();
    expect((await readJson<{ error: { message: string } }>(failed)).error.message).toContain('record exists');
    expect(harness.calls.at(-1)).toMatchObject({ method: 'DELETE' });
    expect(harness.db.sqlite.query('SELECT COUNT(*) AS count FROM instances').get()).toEqual({ count: 0 });
    expect(await poll(harness, start)).toEqual({ status: 'pending' });
  });

  test('refuses a bad machine key or body, and too many waiting pairings from one address', async () => {
    const harness = createHarness();
    const badKey = await harness.post(REMOTE_PATHS.pairStart, {
      name: 'Studio',
      publicKey: 'nope',
      version: '1',
    });
    expect(badKey.status).toBe(400);
    const missing = await harness.post(REMOTE_PATHS.pairStart, { name: '', publicKey: 'x', version: '1' });
    expect(missing.status).toBe(400);
    for (let index = 0; index < MAX_PENDING_PAIRS_PER_ADDRESS; index++) await startPair(harness);
    const publicKey = await createMachineKey();
    const limited = await harness.post(REMOTE_PATHS.pairStart, { name: 'Studio', publicKey, version: '1' });
    expect(limited.status).toBe(429);
    harness.clock.now += PAIR_TTL_MS;
    const after = await harness.post(REMOTE_PATHS.pairStart, { name: 'Studio', publicKey, version: '1' });
    expect(after.status).toBe(200);
  });
});
