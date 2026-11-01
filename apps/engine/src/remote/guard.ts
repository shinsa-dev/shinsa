import {
  REMOTE_APP_ORIGIN,
  REMOTE_CHANNEL_PATH,
  REMOTE_ENGINE_HOOK_PREFIX,
  SHARE_CHANNEL_PATH,
  SLACK_ENGINE_EVENTS_PATH,
  SLACK_ENGINE_INTERACTIONS_PATH,
} from '@shinsa/core';

export type TunnelRoute = 'health' | 'hook' | 'channel' | 'share' | 'slack';

const TUNNEL_HEADER = 'cf-connecting-ip';

function readHostname(request: Request) {
  const host = request.headers.get('host') ?? '';
  return host.replace(/:\d+$/, '').toLowerCase();
}

export function isTunnelRequest(request: Request, tunnelHost: string | null) {
  if (request.headers.has(TUNNEL_HEADER)) return true;
  return tunnelHost !== null && readHostname(request) === tunnelHost.toLowerCase();
}

export function resolveTunnelRoute(request: Request, url: URL): TunnelRoute | null {
  if (url.pathname === '/health' && request.method === 'GET') return 'health';
  if (url.pathname.startsWith(REMOTE_ENGINE_HOOK_PREFIX)) return 'hook';
  if (url.pathname === REMOTE_CHANNEL_PATH && request.method === 'GET') return 'channel';
  if (url.pathname === SHARE_CHANNEL_PATH && request.method === 'GET') return 'share';
  const slack = url.pathname === SLACK_ENGINE_EVENTS_PATH || url.pathname === SLACK_ENGINE_INTERACTIONS_PATH;
  if (slack && request.method === 'POST') return 'slack';
  return null;
}

export function resolveChannelOriginRefusal(request: Request, appOrigin = REMOTE_APP_ORIGIN) {
  const origin = request.headers.get('origin');
  if (origin === appOrigin) return null;
  return `The remote channel only opens from ${new URL(appOrigin).host}.`;
}
