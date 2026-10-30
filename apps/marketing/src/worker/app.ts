import { REMOTE_APP_BASE, REMOTE_APP_ORIGIN } from '@shinsa/core';

export interface AppService {
  fetch: (request: Request) => Promise<Response>;
}

export function isAppPath(pathname: string) {
  return pathname === REMOTE_APP_BASE || pathname.startsWith(`${REMOTE_APP_BASE}/`);
}

export function respondApp(request: Request, service: AppService | null) {
  const url = new URL(request.url);
  if (url.origin !== REMOTE_APP_ORIGIN)
    return Response.redirect(`${REMOTE_APP_ORIGIN}${url.pathname}${url.search}`, 308);
  if (!service) return new Response('Remote access is not set up on this site.', { status: 503 });
  return service.fetch(request);
}
