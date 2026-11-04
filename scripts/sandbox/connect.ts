import { Clock, Effect, Schema } from 'effect';
import {
  CONNECT_TOKEN_TTL_MS,
  type ConnectResponse,
  createConnectToken,
  REMOTE_CONNECT_PARAM,
  type RemoteUser,
  resolveTeamChannelUrl,
} from '../../packages/core/src/index.ts';
import { createRandomKey, parseRequestBody } from './requests.ts';
import { HOST, InstanceBody, type Machine, PORT, SANDBOX_PATH, USER } from './schema.ts';

const decodeInstanceBody = Schema.decodeUnknownEffect(Schema.fromJsonString(InstanceBody));

const signConnect = Effect.fn('Sandbox.signConnect')(function* (
  machine: Machine,
  user: RemoteUser,
  channel: 'remote' | 'team'
) {
  const expiresAt = (yield* Clock.currentTimeMillis) + CONNECT_TOKEN_TTL_MS;
  const token = yield* createConnectToken(machine.connectKey, {
    instanceId: machine.id,
    userId: user.id,
    channel,
    nonce: createRandomKey(16),
    expiresAt,
  });
  return { token, expiresAt };
});

export const createConnect = Effect.fn('Sandbox.createConnect')(function* (
  machine: Machine,
  user: RemoteUser = USER
) {
  const { token, expiresAt } = yield* signConnect(machine, user, 'remote');
  const answer: ConnectResponse = {
    url: `ws://${HOST}:${PORT}${SANDBOX_PATH}/tunnel/${machine.id}?${REMOTE_CONNECT_PARAM}=${encodeURIComponent(token)}`,
    expiresAt,
  };
  return answer;
});

export const respondConnect = Effect.fn('Sandbox.respondConnect')(function* (
  machine: Machine,
  user: RemoteUser
) {
  return Response.json(yield* createConnect(machine, user));
});

export const respondTeamConnect = Effect.fn('Sandbox.respondTeamConnect')(function* (
  request: Request,
  viewer: RemoteUser,
  teammates: Machine[]
) {
  const { instanceId } = yield* parseRequestBody(request, decodeInstanceBody);
  const target = teammates.find((entry) => entry.id === instanceId);
  if (!target)
    return Response.json(
      { error: { code: 'not_found', message: 'That machine is not in this team.' } },
      { status: 404 }
    );
  const { token, expiresAt } = yield* signConnect(target, viewer, 'team');
  const answer: ConnectResponse = {
    url: resolveTeamChannelUrl(`ws://${HOST}:${PORT}${SANDBOX_PATH}/tunnel/${target.id}`, token),
    expiresAt,
  };
  return Response.json(answer);
});
