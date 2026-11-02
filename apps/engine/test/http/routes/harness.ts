import type { ServerConfig } from '../../../src/config/index.ts';
import { ApiRoutes } from '../../../src/http/app.ts';
import type { RequestSourceShape } from '../../../src/http/schema.ts';
import type { HttpContext } from '../../../src/http/server.ts';
import { createHttpContext, createWebHandler } from '../../helpers/web.ts';

const BASE = 'http://127.0.0.1:5180';

type ContextExtras = Partial<HttpContext> | ((base: HttpContext) => Partial<HttpContext>);

export function startRoutes(extras: ContextExtras = {}, config: Partial<ServerConfig> = {}) {
  const base = createHttpContext({}, config);
  const context = { ...base, ...(typeof extras === 'function' ? extras(base) : extras) };
  const handle = createWebHandler(context, ApiRoutes);
  const send = (input: string, init: RequestInit = {}, source?: RequestSourceShape) => {
    const headers = new Headers(init.headers);
    if (!headers.has('host')) headers.set('host', '127.0.0.1:5180');
    if (typeof init.body === 'string' && !headers.has('content-length'))
      headers.set('content-length', String(Buffer.byteLength(init.body)));
    const url = input.startsWith('http') ? input : `${BASE}${input}`;
    return handle(new Request(url, { ...init, headers }), source);
  };
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    send(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  return { context, base: BASE, send, post };
}

export async function readFailure(response: Response) {
  const body = (await response.json()) as { error: { code: string; message: string } };
  return { status: response.status, ...body.error };
}
