import {
  CONNECT_TOKEN_TTL_MS,
  type ConnectResponse,
  createConnectToken,
  type HeartbeatResponse,
  REMOTE_CHANNEL_PATH,
  REMOTE_CONNECT_PARAM,
  type RemoteInstance,
  type RemoteRole,
  resolveTunnelHost,
} from '@shinsa/core';
import { createCloudflare } from './cloudflare.ts';
import { resolveTokenHash } from './crypto.ts';
import type { InstanceRow, SharedInstanceRow, UserRow } from './database.ts';
import { CloudError, readBearer, readJsonFields, readText, respondJson } from './http.ts';
import { listInstanceMembers } from './members.ts';
import { findPageUser, findSessionUser } from './session.ts';
import type { CloudWorld } from './world.ts';

export const ONLINE_WINDOW_MS = 5 * 60_000;

function serializeInstance(row: SharedInstanceRow, userId: string, now: number): RemoteInstance {
  const recent = row.last_seen_at !== null && row.last_seen_at > now - ONLINE_WINDOW_MS;
  return {
    id: row.id,
    name: row.name,
    fingerprint: row.fingerprint,
    online: row.online === 1 && recent,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    owner: {
      id: row.user_id,
      login: row.owner_login,
      name: row.owner_name,
      avatarUrl: row.owner_avatar_url,
    },
    role: row.user_id === userId ? 'owner' : 'member',
  };
}

export async function findInstanceAccess(user: UserRow, instanceId: string, world: CloudWorld) {
  const row = await world.store.selectInstance(instanceId);
  if (row?.user_id === user.id) return { row, role: 'owner' as RemoteRole };
  if (row && (await world.store.isMember(row.id, user.id))) return { row, role: 'member' as RemoteRole };
  throw new CloudError('not_found', 'No such machine.', 404);
}

async function findOwnInstance(user: UserRow, instanceId: string, world: CloudWorld) {
  const { row, role } = await findInstanceAccess(user, instanceId, world);
  if (role !== 'owner')
    throw new CloudError('not_owner', 'Only the owner can remove this machine. Leave it instead.', 403);
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
  return respondJson(rows.map((row) => serializeInstance(row, user.id, now)));
}

export async function respondConnect(request: Request, instanceId: string, world: CloudWorld) {
  const user = await findPageUser(request, world);
  const { row } = await findInstanceAccess(user, instanceId, world);
  const expiresAt = world.now() + CONNECT_TOKEN_TTL_MS;
  const token = await createConnectToken(row.connect_key, { instanceId: row.id, userId: user.id, expiresAt });
  const url = `wss://${resolveTunnelHost(row.id)}${REMOTE_CHANNEL_PATH}?${REMOTE_CONNECT_PARAM}=${encodeURIComponent(token)}`;
  const answer: ConnectResponse = { url, expiresAt };
  return respondJson(answer);
}

export async function respondInstanceRemove(request: Request, instanceId: string, world: CloudWorld) {
  const user = await findPageUser(request, world);
  await removeInstance(await findOwnInstance(user, instanceId, world), world);
  return respondJson({ ok: true });
}

export async function findMachine(request: Request, world: CloudWorld) {
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
  const answer: HeartbeatResponse = { ok: true, ...(await listInstanceMembers(row, world)) };
  return respondJson(answer);
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
