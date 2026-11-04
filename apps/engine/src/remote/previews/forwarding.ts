import { PREVIEW_PAGE_HEADER, type PreviewPageKind, serializePreviewPage } from '@shinsa/core';
import { PREVIEW_DROPPED_REQUEST_HEADERS, PREVIEW_SENDABLE_CLOSE, type PrivateRun } from './schema.ts';

export function resolveLocalOrigin(port: number) {
  return `http://localhost:${port}`;
}

export function resolveForwardHeaders(source: Headers, port: number) {
  const headers: Record<string, string> = {};
  for (const [name, value] of source) {
    if (PREVIEW_DROPPED_REQUEST_HEADERS.has(name) || name.startsWith('cf-')) continue;
    headers[name] = value;
  }
  const local = resolveLocalOrigin(port);
  headers.host = `localhost:${port}`;
  if (headers.origin) headers.origin = local;
  if (headers.referer) {
    const referer = URL.parse(headers.referer);
    headers.referer = referer ? `${local}${referer.pathname}${referer.search}` : local;
  }
  return headers;
}

export function resolveCloseCode(code: number) {
  const { min, max, reserved } = PREVIEW_SENDABLE_CLOSE;
  return code >= min && code <= max && !reserved.has(code) ? code : 1000;
}

export function resolvePrivateRunKey(run: PrivateRun) {
  return `${run.serviceId}\n${run.taskId ?? ''}`;
}

export function isSocketUpgrade(request: Request) {
  return request.headers.get('upgrade')?.toLowerCase() === 'websocket';
}

export function listSocketProtocols(request: Request) {
  const header = request.headers.get('sec-websocket-protocol');
  if (!header) return [];
  return header
    .split(',')
    .map((protocol) => protocol.trim())
    .filter(Boolean);
}

export function respondPreviewPage(kind: PreviewPageKind, status: number) {
  return new Response(serializePreviewPage(kind), {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      [PREVIEW_PAGE_HEADER]: '1',
    },
  });
}
