export const TUNNEL_OFFLINE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504, 530]);

const DROPPED_HEADERS = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'cdn-loop']);

const DROPPED_PREFIXES = ['cf-', 'x-forwarded-', 'x-real-ip'];

export function resolveForwardHeaders(source: Headers, dropped: ReadonlySet<string> = new Set()) {
  const headers = new Headers();
  for (const [name, value] of source) {
    if (DROPPED_HEADERS.has(name) || dropped.has(name)) continue;
    if (DROPPED_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    headers.set(name, value);
  }
  return headers;
}
