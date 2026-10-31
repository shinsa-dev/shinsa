import {
  CONNECT_TOKEN_TTL_MS,
  type ConnectResponse,
  createConnectToken,
  REMOTE_CHANNEL_PATH,
  REMOTE_CONNECT_PARAM,
  type RemoteInstance,
  resolveTunnelHost,
} from '@shinsa/core';
import { createCloudflare } from './cloudflare.ts';
import { resolveTokenHash } from './crypto.ts';
import type { InstanceRow, UserRow } from './database.ts';
import { assertSameOrigin, CloudError, readBearer, readJsonFields, readText, respondJson } from './http.ts';
import { findSessionUser } from './session.ts';
import type { CloudWorld } from './world.ts';

export const ONLINE_WINDOW_MS = 5 * 60_000;

function serializeInstance(row: InstanceRow, now: number): RemoteInstance {
  const recent = row.last_seen_at !== null && row.last_seen_at > now - ONLINE_WINDOW_MS;
  return {
    id: row.id,
    name: row.name,
    fingerprint: row.fingerprint,
    online: row.online === 1 && recent,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
  };
}

async function findOwnInstance(user: UserRow, instanceId: string, world: CloudWorld) {
  const row = await world.store.selectInstance(instanceId);
  if (!row || row.user_id !== user.id) throw new CloudError('not_found', 'No such machine.', 404);
  return row;
}

async function removeInstance(row: InstanceRow, world: CloudWorld) {
  await createCloudflare(world.config, world.fetch).removeTunnel(row.tunnel_id, row.dns_record_id);
  await world.store.removeInstance(row.id);
}

export async function respondInstances(request: Request, world: CloudWorld) {
  const user = await findSessionUser(request, world);
  const now = world.now();
  const rows = await world.store.listUserInstances(user.id);
  return respondJson(rows.map((row) => serializeInstance(row, now)));
}

export async function respondConnect(request: Request, instanceId: string, world: CloudWorld) {
  assertSameOrigin(request, world.config.origin);
  const user = await findSessionUser(request, world);
  const row = await findOwnInstance(user, instanceId, world);
  const expiresAt = world.now() + CONNECT_TOKEN_TTL_MS;
  const token = await createConnectToken(row.connect_key, { instanceId: row.id, userId: user.id, expiresAt });
  const url = `wss://${resolveTunnelHost(row.id)}${REMOTE_CHANNEL_PATH}?${REMOTE_CONNECT_PARAM}=${encodeURIComponent(token)}`;
  const answer: ConnectResponse = { url, expiresAt };
  return respondJson(answer);
}

export async function respondInstanceRemove(request: Request, instanceId: string, world: CloudWorld) {
  assertSameOrigin(request, world.config.origin);
  const user = await findSessionUser(request, world);
  await removeInstance(await findOwnInstance(user, instanceId, world), world);
  return respondJson({ ok: true });
}

async function findMachine(request: Request, world: CloudWorld) {
  const token = readBearer(request);
  if (!token) throw new CloudError('revoked', 'This machine is not paired.', 401);
  const row = await world.store.selectMachineInstance(await resolveTokenHash(token));
  if (!row) throw new CloudError('revoked', 'This machine is not paired.', 401);
  return row;
}

function isLoopbackUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export async function respondHeartbeat(request: Request, world: CloudWorld) {
  const row = await findMachine(request, world);
  const fields = await readJsonFields(request);
  const localUrl = readText(fields, 'localUrl', 200);
  if (!isLoopbackUrl(localUrl))
    throw new CloudError('body_invalid', 'The local address must be this machine’s loopback address.', 400);
  if (localUrl !== row.local_url)
    await createCloudflare(world.config, world.fetch).updateIngress(
      row.tunnel_id,
      resolveTunnelHost(row.id),
      localUrl
    );
  await world.store.recordHeartbeat(row.id, localUrl, world.now());
  return respondJson({ ok: true });
}

export async function respondOffline(request: Request, world: CloudWorld) {
  const row = await findMachine(request, world);
  await world.store.recordOffline(row.id);
  return respondJson({ ok: true });
}

export async function respondMachineRemove(request: Request, world: CloudWorld) {
  await removeInstance(await findMachine(request, world), world);
  return respondJson({ ok: true });
}
