import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import {
  createTeamKeyRequest,
  openTeamKey,
  parseTeamKeyDelivery,
  parseTeamKeyRefusal,
  REMOTE_KEY_ALGORITHM,
  readTeamKeyRequest,
  sealTeamKey,
  serializePublicKey,
  SIGNING_KEY_ALGORITHM,
  TEAM_KEY_IV_BYTES,
  type TeamKeyDelivery,
  verifyTeamKeyRequest,
} from '../../src/index.ts';

const SUBJECT = { teamId: 'team00000001', instanceId: 'laptop000001' };

const TEAM_KEY = 'team-key-that-only-members-hold';

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const createExchange = () =>
  crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, ['deriveBits']) as Promise<CryptoKeyPair>;

const createSigning = () =>
  crypto.subtle.generateKey(SIGNING_KEY_ALGORITHM, true, ['sign', 'verify']) as Promise<CryptoKeyPair>;

const createIv = () => crypto.getRandomValues(new Uint8Array(TEAM_KEY_IV_BYTES));

async function createRequest(ask = false) {
  const signing = await createSigning();
  const exchange = await createExchange();
  const request = await run(createTeamKeyRequest(signing.privateKey, SUBJECT, exchange.publicKey, ask));
  return { request, exchange, signingKey: await run(serializePublicKey(signing.publicKey)) };
}

async function seal(recipient: string, teamId = SUBJECT.teamId) {
  const delivery = await run(
    sealTeamKey({ teamId, recipient, ephemeral: await createExchange(), iv: createIv() }, TEAM_KEY)
  );
  if (!delivery) throw new Error('The seal failed.');
  return delivery;
}

describe('team key requests', () => {
  test('a request signed by the machine verifies against its signing key and nothing else', async () => {
    const { request, signingKey } = await createRequest(true);
    expect(request.ask).toBe(true);
    expect(await run(verifyTeamKeyRequest(signingKey, SUBJECT, request))).toBe(true);
    const other = await run(serializePublicKey((await createSigning()).publicKey));
    expect(await run(verifyTeamKeyRequest(other, SUBJECT, request))).toBe(false);
    expect(await run(verifyTeamKeyRequest(signingKey, { ...SUBJECT, instanceId: 'other' }, request))).toBe(
      false
    );
    expect(await run(verifyTeamKeyRequest(signingKey, SUBJECT, { ...request, ask: false }))).toBe(false);
    expect(await run(verifyTeamKeyRequest('nope', SUBJECT, request))).toBe(false);
  });

  test('a refusal carries the request, and anything else carries none', async () => {
    const { request } = await createRequest();
    const text = JSON.stringify({ type: 'refused', reason: 'No key.', keyRequest: request });
    expect(parseTeamKeyRefusal(text)).toEqual(request);
    expect(parseTeamKeyRefusal(JSON.stringify({ type: 'refused', reason: 'No key.' }))).toBeNull();
    expect(parseTeamKeyRefusal(JSON.stringify({ type: 'welcome', keyRequest: request }))).toBeNull();
    expect(readTeamKeyRequest({ ephemeral: 'e', signature: 's' })).toBeNull();
    expect(readTeamKeyRequest('text')).toBeNull();
  });
});

describe('team key seals', () => {
  test('only the machine that asked opens the key, for the team it asked about', async () => {
    const { request, exchange } = await createRequest();
    const delivery = await seal(request.ephemeral);
    expect(parseTeamKeyDelivery(JSON.stringify(delivery))).toEqual(delivery);
    expect(await run(openTeamKey(exchange.privateKey, delivery))).toBe(TEAM_KEY);
    expect(await run(openTeamKey((await createExchange()).privateKey, delivery))).toBeNull();
    const moved: TeamKeyDelivery = { ...delivery, team: 'team00000002' };
    expect(await run(openTeamKey(exchange.privateKey, moved))).toBeNull();
    expect(await run(openTeamKey(exchange.privateKey, { ...delivery, sealed: 'short' }))).toBeNull();
  });

  test('refuses to seal to something that is not a public key, or with the wrong IV', async () => {
    const ephemeral = await createExchange();
    expect(
      await run(sealTeamKey({ ...SUBJECT, recipient: 'nope', ephemeral, iv: createIv() }, TEAM_KEY))
    ).toBeNull();
    const { request } = await createRequest();
    const short = new Uint8Array(4);
    expect(
      await run(sealTeamKey({ ...SUBJECT, recipient: request.ephemeral, ephemeral, iv: short }, TEAM_KEY))
    ).toBeNull();
  });

  test('reads only a whole delivery of this protocol', () => {
    expect(parseTeamKeyDelivery(JSON.stringify({ type: 'team-key', version: 0 }))).toBeNull();
    expect(parseTeamKeyDelivery(JSON.stringify({ type: 'team-hello' }))).toBeNull();
    expect(parseTeamKeyDelivery('not json')).toBeNull();
  });
});
