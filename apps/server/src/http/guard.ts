const CROSS_SITE = 'Requests from other sites are not allowed.';

function readHostname(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function resolveAllowedHosts(hosts: string[]): ReadonlySet<string> {
  return new Set(hosts.map((host) => readHostname(`http://${host}`) ?? host.toLowerCase()));
}

export function resolveRefusal(request: Request, allowedHosts: ReadonlySet<string>): string | null {
  const host = request.headers.get('host');
  const hostname = host ? readHostname(`http://${host}`) : null;
  if (!hostname || !allowedHosts.has(hostname)) return 'Shinsa only answers on its own address.';
  const origin = request.headers.get('origin');
  if (origin !== null) {
    const originHostname = readHostname(origin);
    if (!originHostname || !allowedHosts.has(originHostname)) return CROSS_SITE;
  }
  if (request.headers.get('sec-fetch-site') === 'cross-site') return CROSS_SITE;
  return null;
}

export function resolveUpgradeRefusal(request: Request): string | null {
  if (request.headers.get('origin') === null) return 'A WebSocket needs an Origin header.';
  return null;
}

export function resolveBodyRefusal(request: Request): string | null {
  if (request.method === 'GET' || request.method === 'HEAD') return null;
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) return 'Send the request body as application/json.';
  return null;
}
