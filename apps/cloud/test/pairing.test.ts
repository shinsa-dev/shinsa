import { describe, expect, spyOn, test } from 'bun:test';
import {
  MACHINE_FEATURES,
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
import { Effect, Duration } from 'effect';
import { MAX_PENDING_PAIRS_PER_ADDRESS, PAIR_TTL } from '../src/routes/pairing/schema.ts';
import { MAX_INSTANCES_PER_USER } from '../src/routes/pairs/schema.ts';
import { createHarness, type Harness, openClaimed, readJson } from './harness.ts';

const PAIR_TTL_MS = Duration.toMillis(PAIR_TTL);

async function createMachineKey() {
  const pair = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, ['deriveBits'])) as CryptoKeyPair;
  return Effect.runPromise(serializePublicKey(pair.publicKey));
}

async function startPair(harness: Harness, name = 'Studio', features: readonly string[] = MACHINE_FEATURES) {
  const pair = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, ['deriveBits'])) as CryptoKeyPair;
  const publicKey = await Effect.runPromise(serializePublicKey(pair.publicKey));
  const response = await harness.post(
    REMOTE_PATHS.pairStart,
    { name, publicKey, version: '1.2.0', ...(features.length > 0 ? { features } : {}) },
    { sameOrigin: false }
  );
  return { pair, publicKey, start: await readJson<PairStartResponse>(response) };
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

  test('pairs a machine once when two approvals race', async () => {
    const harness = createHarness();
    const mona = await harness.signIn('mona', 42);
    const kai = await harness.signIn('kai', 43);
    const { start } = await startPair(harness);
    const answers = await Promise.all([
      harness.post(resolvePairApprovePath(start.claimCode), {}, { session: mona }),
      harness.post(resolvePairApprovePath(start.claimCode), {}, { session: kai }),
    ]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
    expect(harness.db.sqlite.query('SELECT COUNT(*) AS count FROM machines').get()).toEqual({ count: 1 });
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
      fingerprint: await Effect.runPromise(resolveKeyFingerprint(publicKey)),
      expiresAt: start.expiresAt,
      claimed: false,
    });
  });

  test('approving makes only the instance, calling nothing outside the Worker, and the machine collects its credentials once', async () => {
    const harness = createHarness();
    const { pair, start } = await startPair(harness);
    const session = await harness.signIn('mona', 42);
    harness.calls.length = 0;
    const approved = await harness.post(resolvePairApprovePath(start.claimCode), {}, { session });
    const { instanceId } = await readJson<{ instanceId: string }>(approved);
    expect(instanceId).toMatch(/^[a-z0-9]{12}$/);
    expect(harness.calls).toEqual([]);
    const claimed = await poll(harness, start);
    expect(claimed).toMatchObject({ status: 'claimed', owner: 'mona' });
    const credentials = await openClaimed(pair, claimed);
    expect(Object.keys(credentials).sort()).toEqual(['connectKey', 'instanceId', 'machineToken']);
    expect(credentials.instanceId).toBe(instanceId);
    expect(await poll(harness, start)).toEqual({ status: 'expired' });
    const stored = harness.db.sqlite.query('SELECT machine_token_hash FROM machines').get() as {
      machine_token_hash: string;
    };
    expect(stored.machine_token_hash).not.toBe(credentials.machineToken);
  });

  test('keeps the waiting credentials sealed to the machine’s key, so D1 never holds a token in clear', async () => {
    const harness = createHarness();
    const { start } = await startPair(harness);
    const session = await harness.signIn();
    await harness.post(resolvePairApprovePath(start.claimCode), {}, { session });
    const row = harness.db.sqlite.query('SELECT credentials FROM pairings').get() as {
      credentials: string;
    };
    expect(row.credentials).not.toContain('machineToken');
  });

  test('an older engine that names no features collects its credentials as it always has', async () => {
    const harness = createHarness();
    const { start } = await startPair(harness, 'Studio', []);
    const session = await harness.signIn('mona', 42);
    const { instanceId } = await readJson<{ instanceId: string }>(
      await harness.post(resolvePairApprovePath(start.claimCode), {}, { session })
    );
    const claimed = await poll(harness, start);
    expect(claimed).toMatchObject({
      status: 'claimed',
      owner: 'mona',
      credentials: { instanceId },
    });
    expect(claimed).not.toHaveProperty('sealedCredentials');
    const row = harness.db.sqlite.query('SELECT features FROM machines').get() as { features: string };
    expect(JSON.parse(row.features)).toEqual([]);
  });

  test('a claim whose stored credentials no longer read ends as expired', async () => {
    const harness = createHarness();
    const { start } = await startPair(harness, 'Studio', []);
    const session = await harness.signIn();
    await harness.post(resolvePairApprovePath(start.claimCode), {}, { session });
    harness.db.sqlite.query("UPDATE pairings SET credentials = 'broken'").run();
    expect(await poll(harness, start)).toEqual({ status: 'expired' });
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

  test('refuses a pairing once the service holds its most machines', async () => {
    const harness = createHarness({ maxInstances: 1 });
    const session = await harness.signIn();
    const first = await startPair(harness);
    expect((await harness.post(resolvePairApprovePath(first.start.claimCode), {}, { session })).status).toBe(
      200
    );
    const second = await startPair(harness);
    const full = await harness.post(resolvePairApprovePath(second.start.claimCode), {}, { session });
    expect(full.status).toBe(503);
    expect(await readJson<{ error: { code: string } }>(full)).toMatchObject({
      error: { code: 'service_full' },
    });
  });

  test('a failed approval releases the code, so the next approval pairs the machine', async () => {
    const harness = createHarness();
    const session = await harness.signIn();
    const { start } = await startPair(harness);
    harness.db.sqlite.run(
      "CREATE TRIGGER refuse_machines BEFORE INSERT ON machines BEGIN SELECT RAISE(ABORT, 'refused'); END"
    );
    const logged = spyOn(console, 'error').mockImplementation(() => undefined);
    const failed = await harness.post(resolvePairApprovePath(start.claimCode), {}, { session });
    logged.mockRestore();
    expect(failed.status).toBe(500);
    expect(await poll(harness, start)).toEqual({ status: 'pending' });
    harness.db.sqlite.run('DROP TRIGGER refuse_machines');
    expect((await harness.post(resolvePairApprovePath(start.claimCode), {}, { session })).status).toBe(200);
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
