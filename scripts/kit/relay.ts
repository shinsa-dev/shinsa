import type { ServerWebSocket } from 'bun';
import { Effect } from 'effect';
import { createRelayHub } from '../../apps/cloud/src/relay/hub.ts';
import {
  RELAY_ROLE_HEADER,
  RELAY_ROOM_ORIGIN,
  type RelayHub,
  type RelayPeer,
  type RelayRole,
  type RelayTag,
} from '../../apps/cloud/src/relay/schema.ts';
import { RELAY_MACHINE_SEGMENT, RELAY_PATH_PREFIX } from '../../packages/core/src/index.ts';

interface LocalRelayPeer {
  readonly instanceId: string;
  readonly tag: RelayTag;
  peer: RelayPeer | null;
}

interface Acceptance {
  readonly tag: RelayTag;
  readonly protocol: string | null;
}

const RELAY_ROUTE = new RegExp(`^${RELAY_PATH_PREFIX}([^/]+)(/.*)?$`);

export function startLocalRelay() {
  const sockets = new Map<string, Set<ServerWebSocket<LocalRelayPeer>>>();
  const hubs = new Map<string, RelayHub>();
  const accepted = new WeakMap<Response, Acceptance>();

  const listSockets = (instanceId: string) => {
    const known = sockets.get(instanceId);
    if (known) return known;
    const created = new Set<ServerWebSocket<LocalRelayPeer>>();
    sockets.set(instanceId, created);
    return created;
  };

  const resolveHub = (instanceId: string) => {
    const known = hubs.get(instanceId);
    if (known) return known;
    const hub = createRelayHub({
      listPeers: () => [...listSockets(instanceId)].flatMap((socket) => socket.data.peer ?? []),
      accept: (tag, protocol) => {
        const response = new Response(null, { status: 200 });
        accepted.set(response, { tag, protocol });
        return response;
      },
    });
    hubs.set(instanceId, hub);
    return hub;
  };

  const ask = (instanceId: string, role: RelayRole, path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set(RELAY_ROLE_HEADER, role);
    return resolveHub(instanceId).fetch(new Request(`${RELAY_ROOM_ORIGIN}${path}`, { ...init, headers }));
  };

  const answer = Effect.fn('Kit.answerRelay')(function* (request: Request, bun: Bun.Server<LocalRelayPeer>) {
    const url = new URL(request.url);
    const route = RELAY_ROUTE.exec(url.pathname);
    if (!route?.[1]) return new Response('Not found', { status: 404 });
    const instanceId = decodeURIComponent(route[1]);
    const rest = route[2] ?? '/';
    const machine = rest === `/${RELAY_MACHINE_SEGMENT}`;
    const answered = yield* ask(instanceId, machine ? 'machine' : 'socket', `${rest}${url.search}`, {
      headers: request.headers,
    });
    const acceptance = accepted.get(answered);
    if (!acceptance) return answered;
    const headers = acceptance.protocol ? { 'sec-websocket-protocol': acceptance.protocol } : undefined;
    const data: LocalRelayPeer = { instanceId, tag: acceptance.tag, peer: null };
    const upgraded = bun.upgrade(request, { data, headers });
    return upgraded ? undefined : new Response('Upgrade failed', { status: 400 });
  });

  const server = Bun.serve<LocalRelayPeer>({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request, bun) => Effect.runPromise(answer(request, bun)),
    websocket: {
      maxPayloadLength: 64 * 1024 * 1024,
      open(socket) {
        socket.data.peer = {
          tag: socket.data.tag,
          send: (message) => void socket.send(message),
          close: (code, reason) => socket.close(code, reason),
        };
        listSockets(socket.data.instanceId).add(socket);
      },
      message(socket, message) {
        const { peer } = socket.data;
        if (!peer) return;
        const payload =
          typeof message === 'string'
            ? message
            : message.buffer.slice(message.byteOffset, message.byteOffset + message.byteLength);
        return Effect.runPromise(resolveHub(socket.data.instanceId).receive(peer, payload as ArrayBuffer));
      },
      close(socket, code, reason) {
        listSockets(socket.data.instanceId).delete(socket);
        const { peer } = socket.data;
        if (!peer) return;
        return Effect.runPromise(resolveHub(socket.data.instanceId).closed(peer, code, reason));
      },
    },
  });

  return {
    origin: `http://127.0.0.1:${server.port}`,
    request: (instanceId: string, path: string, init?: RequestInit) =>
      Effect.runPromise(ask(instanceId, 'http', path, init)),
    isConnected: (instanceId: string) =>
      [...listSockets(instanceId)].some((socket) => socket.data.tag.role === 'machine'),
    stop: () => server.stop(true),
  };
}
