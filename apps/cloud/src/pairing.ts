import {
  APP_IDENTITY,
  type MachineCredentials,
  type PairPollResponse,
  type PairStartResponse,
  parsePublicKey,
  REMOTE_PATHS,
  resolveKeyFingerprint,
  resolveTunnelHost,
} from '@shinsa/core';
import { createCloudflare } from './cloudflare.ts';
import { createClaimCode, createInstanceId, createToken, isSameSecret, resolveTokenHash } from './crypto.ts';
import type { PairSessionRow } from './database.ts';
import { assertSameOrigin, CloudError, readJsonFields, readText, respondJson } from './http.ts';
import { findSessionUser } from './session.ts';
import type { CloudWorld } from './world.ts';

export const PAIR_TTL_MS = 10 * 60_000;

export const MAX_PENDING_PAIRS_PER_ADDRESS = 10;

export const MAX_INSTANCES_PER_USER = 5;

const DEFAULT_LOCAL_URL = `http://127.0.0.1:${APP_IDENTITY.port}`;

export interface PairView {
  claimCode: string;
  name: string;
  fingerprint: string;
  expiresAt: number;
  claimed: boolean;
}

function readClientIp(request: Request) {
  return request.headers.get('cf-connecting-ip') ?? 'unknown';
}

export async function respondPairStart(request: Request, world: CloudWorld) {
  const fields = await readJsonFields(request);
  const name = readText(fields, 'name', 80);
  const publicKey = readText(fields, 'publicKey', 200);
  const version = readText(fields, 'version', 60);
  if (!(await parsePublicKey(publicKey)))
    throw new CloudError('body_invalid', 'The machine key is not a P-256 public key.', 400);
  const now = world.now();
  await world.store.removeExpiredPairSessions(now);
  const clientIp = readClientIp(request);
  if ((await world.store.countPairSessionsFrom(clientIp)) >= MAX_PENDING_PAIRS_PER_ADDRESS)
    throw new CloudError('rate_limited', 'Too many pairings are waiting. Try again in a few minutes.', 429);
  const claimCode = createClaimCode();
  const pollSecret = createToken();
  const expiresAt = now + PAIR_TTL_MS;
  await world.store.createPairSession(
    {
      claim_code: claimCode,
      poll_secret_hash: await resolveTokenHash(pollSecret),
      name,
      public_key: publicKey,
      version,
      expires_at: expiresAt,
    },
    clientIp
  );
  const answer: PairStartResponse = {
    claimCode,
    pollSecret,
    url: `${world.config.origin}${REMOTE_PATHS.pairPage}?code=${claimCode}`,
    expiresAt,
  };
  return respondJson(answer);
}

export async function respondPairPoll(request: Request, world: CloudWorld) {
  const fields = await readJsonFields(request);
  const claimCode = readText(fields, 'claimCode', 20);
  const pollSecret = readText(fields, 'pollSecret', 100);
  const row = await world.store.selectPairSession(claimCode);
  if (!row || !isSameSecret(row.poll_secret_hash, await resolveTokenHash(pollSecret)))
    return respondJson({ status: 'expired' } satisfies PairPollResponse);
  if (row.credentials && row.owner) {
    await world.store.removePairSession(claimCode);
    const claimed: PairPollResponse = {
      status: 'claimed',
      credentials: JSON.parse(row.credentials) as MachineCredentials,
      owner: row.owner,
    };
    return respondJson(claimed);
  }
  if (row.expires_at <= world.now()) {
    await world.store.removePairSession(claimCode);
    return respondJson({ status: 'expired' } satisfies PairPollResponse);
  }
  return respondJson({ status: 'pending' } satisfies PairPollResponse);
}

async function findLivePairSession(claimCode: string, world: CloudWorld): Promise<PairSessionRow> {
  const row = await world.store.selectPairSession(claimCode.toUpperCase());
  if (!row || row.expires_at <= world.now())
    throw new CloudError(
      'pair_expired',
      'This pairing code expired. Turn remote access on again on your Mac.',
      404
    );
  return row;
}

export async function respondPairView(request: Request, claimCode: string, world: CloudWorld) {
  await findSessionUser(request, world);
  const row = await findLivePairSession(claimCode, world);
  const view: PairView = {
    claimCode: row.claim_code,
    name: row.name,
    fingerprint: await resolveKeyFingerprint(row.public_key),
    expiresAt: row.expires_at,
    claimed: row.credentials !== null,
  };
  return respondJson(view);
}

export async function respondPairApprove(request: Request, claimCode: string, world: CloudWorld) {
  assertSameOrigin(request, world.config.origin);
  const user = await findSessionUser(request, world);
  const row = await findLivePairSession(claimCode, world);
  if (row.credentials) throw new CloudError('pair_claimed', 'This Mac is already paired.', 409);
  if ((await world.store.listUserInstances(user.id)).length >= MAX_INSTANCES_PER_USER)
    throw new CloudError(
      'instances_full',
      `You can pair up to ${MAX_INSTANCES_PER_USER} machines. Remove one on the dashboard first.`,
      409
    );
  const instanceId = createInstanceId();
  const tunnelHost = resolveTunnelHost(instanceId);
  const tunnel = await createCloudflare(world.config, world.fetch).createTunnel(
    `shinsa-${instanceId}`,
    tunnelHost,
    DEFAULT_LOCAL_URL
  );
  const machineToken = createToken();
  const connectKey = createToken();
  await world.store.createInstance({
    id: instanceId,
    userId: user.id,
    name: row.name,
    fingerprint: await resolveKeyFingerprint(row.public_key),
    tunnelId: tunnel.tunnelId,
    dnsRecordId: tunnel.dnsRecordId,
    machineTokenHash: await resolveTokenHash(machineToken),
    connectKey,
    createdAt: world.now(),
  });
  const credentials: MachineCredentials = {
    instanceId,
    machineToken,
    tunnelToken: tunnel.tunnelToken,
    tunnelHost,
    connectKey,
  };
  await world.store.recordPairClaim(row.claim_code, credentials, user.login);
  return respondJson({ instanceId, name: row.name });
}
