import type { ServerWebSocket } from 'bun';
import {
  REMOTE_CHANNEL_PATH,
  REMOTE_CONNECT_PARAM,
  SHARE_CHANNEL_PATH,
  TEAM_CHANNEL_PATH,
} from '../../packages/core/src/index.ts';
import { type Machine, ORIGIN, RELAY, type RelayData } from './schema.ts';
import { teammateLink } from './team.ts';

export function upgradeRelay(
  request: Request,
  url: URL,
  teammates: Machine[],
  server: Bun.Server<RelayData>
) {
  const route = RELAY.exec(url.pathname);
  const machine = teammates.find((entry) => entry.id === route?.[1]);
  if (!machine) return null;
  if (machine.id === 'kai' && !teammateLink.online) return new Response('Offline', { status: 502 });
  const token = encodeURIComponent(url.searchParams.get(REMOTE_CONNECT_PARAM) ?? '');
  const channels: Record<string, string> = {
    '/share': `${SHARE_CHANNEL_PATH}${url.search}`,
    '/team': `${TEAM_CHANNEL_PATH}?${REMOTE_CONNECT_PARAM}=${token}`,
  };
  const path = channels[route?.[2] ?? ''] ?? `${REMOTE_CHANNEL_PATH}?${REMOTE_CONNECT_PARAM}=${token}`;
  if (server.upgrade(request, { data: { machine, path, upstream: null, pending: [] } })) return undefined;
  return new Response('Upgrade failed', { status: 400 });
}

function openUpstream(socket: ServerWebSocket<RelayData>) {
  const { machine, path } = socket.data;
  if (machine.id === 'kai') teammateLink.sockets.add(socket);
  const upstream = new WebSocket(`ws://127.0.0.1:${machine.port}${path}`, {
    headers: { origin: ORIGIN, 'cf-connecting-ip': '127.0.0.1', ...socket.data.headers },
  } as unknown as string[]);
  upstream.binaryType = 'arraybuffer';
  upstream.addEventListener('open', () => {
    for (const message of socket.data.pending.splice(0)) upstream.send(message);
  });
  upstream.addEventListener('message', (event) => {
    socket.send(typeof event.data === 'string' ? event.data : new Uint8Array(event.data as ArrayBuffer));
  });
  upstream.addEventListener('close', (event) => socket.close(event.code === 1005 ? 1000 : event.code));
  socket.data.upstream = upstream;
}

export const RELAY_SOCKET: Bun.WebSocketHandler<RelayData> = {
  open: openUpstream,
  message(socket, message) {
    const payload = typeof message === 'string' ? message : new Uint8Array(message);
    const { upstream } = socket.data;
    if (upstream?.readyState === WebSocket.OPEN) upstream.send(payload);
    else socket.data.pending.push(payload);
  },
  close(socket) {
    teammateLink.sockets.delete(socket);
    socket.data.upstream?.close();
  },
};
