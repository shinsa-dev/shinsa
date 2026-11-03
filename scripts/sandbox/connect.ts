import {
  CONNECT_TOKEN_TTL_MS,
  type ConnectResponse,
  createConnectToken,
  REMOTE_CONNECT_PARAM,
  type RemoteUser,
  resolveTeamChannelUrl,
} from '../../packages/core/src/index.ts';
import { createRandomKey } from './requests.ts';
import { HOST, type Machine, PORT, SANDBOX_PATH, USER } from './schema.ts';

export async function createConnect(machine: Machine, user: RemoteUser = USER): Promise<ConnectResponse> {
  const expiresAt = Date.now() + CONNECT_TOKEN_TTL_MS;
  const token = await createConnectToken(machine.connectKey, {
    instanceId: machine.id,
    userId: user.id,
    channel: 'remote',
    nonce: createRandomKey(16),
    expiresAt,
  });
  return {
    url: `ws://${HOST}:${PORT}${SANDBOX_PATH}/tunnel/${machine.id}?${REMOTE_CONNECT_PARAM}=${encodeURIComponent(token)}`,
    expiresAt,
  };
}

export async function respondConnect(machine: Machine, user: RemoteUser) {
  return Response.json(await createConnect(machine, user));
}

export async function respondTeamConnect(request: Request, viewer: RemoteUser, teammates: Machine[]) {
  const { instanceId } = (await request.json()) as { instanceId?: string };
  const target = teammates.find((entry) => entry.id === instanceId);
  if (!target)
    return Response.json(
      { error: { code: 'not_found', message: 'That machine is not in this team.' } },
      { status: 404 }
    );
  const expiresAt = Date.now() + CONNECT_TOKEN_TTL_MS;
  const token = await createConnectToken(target.connectKey, {
    instanceId: target.id,
    userId: viewer.id,
    channel: 'team',
    nonce: createRandomKey(16),
    expiresAt,
  });
  const answer: ConnectResponse = {
    url: resolveTeamChannelUrl(`ws://${HOST}:${PORT}${SANDBOX_PATH}/tunnel/${target.id}`, token),
    expiresAt,
  };
  return Response.json(answer);
}
