import { PREVIEW_ACCESS_COOKIE, PREVIEW_COOKIE } from '../../apps/cloud/src/routes/previews/schema.ts';
import {
  createPreviewAccessToken,
  PREVIEW_ACCESS_HEADER,
  PREVIEW_ACCESS_PARAM,
  PREVIEW_KEY_HEADER,
  PREVIEW_OPEN_TTL_MS,
  parsePreviewHost,
  resolvePreviewTunnelPath,
} from '../../packages/core/src/index.ts';
import type { createSandboxCloud } from './cloud.ts';
import { readCookie } from './requests.ts';
import { type Machine, PREVIEW_ZONE, type TunnelData, USER } from './schema.ts';

function upgradePreview(request: Request, url: URL, machines: Machine[], server: Bun.Server<TunnelData>) {
  const address = parsePreviewHost(url.host, PREVIEW_ZONE);
  const machine = machines.find((entry) => entry.id === address?.instanceId);
  const key = readCookie(request, PREVIEW_COOKIE);
  const access = readCookie(request, PREVIEW_ACCESS_COOKIE);
  if (!(address && machine && (key || access))) return new Response('Not shared', { status: 404 });
  const path = `${resolvePreviewTunnelPath(address.previewId, url.pathname)}${url.search}`;
  const data: TunnelData = {
    machine,
    path,
    upstream: null,
    pending: [],
    headers: {
      ...(key ? { [PREVIEW_KEY_HEADER]: key } : {}),
      ...(access ? { [PREVIEW_ACCESS_HEADER]: access } : {}),
    },
  };
  if (server.upgrade(request, { data })) return undefined;
  return new Response('Upgrade failed', { status: 400 });
}

export function respondPreviewHost(
  request: Request,
  url: URL,
  machines: Machine[],
  cloud: ReturnType<typeof createSandboxCloud>,
  server: Bun.Server<TunnelData>
) {
  if (request.headers.get('upgrade')?.toLowerCase() === 'websocket')
    return upgradePreview(request, url, machines, server);
  return cloud.respond(request);
}

export async function respondPreviewOpen(url: URL, machines: Machine[]) {
  const target = new URL(url.searchParams.get('url') ?? '', PREVIEW_ZONE);
  const address = parsePreviewHost(target.host, PREVIEW_ZONE);
  const machine = machines.find((entry) => entry.id === address?.instanceId);
  if (!(address && machine)) return new Response('Not a service of yours', { status: 404 });
  const token = await createPreviewAccessToken(machine.connectKey, {
    ...address,
    userId: USER.id,
    expiresAt: Date.now() + PREVIEW_OPEN_TTL_MS,
  });
  target.searchParams.set(PREVIEW_ACCESS_PARAM, token);
  return Response.redirect(target.href, 303);
}
