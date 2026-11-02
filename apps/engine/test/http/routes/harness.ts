import { EngineApi } from '@shinsa/core/engine-api';
import { Layer } from 'effect';
import { HttpApi, HttpApiBuilder } from 'effect/http-api';
import type { ServerConfig } from '../../../src/config/index.ts';
import { EngineGateLive } from '../../../src/http/gate/middleware.ts';
import { CodeHandlers } from '../../../src/http/routes/code/handler.ts';
import { CommandsHandlers } from '../../../src/http/routes/commands/handler.ts';
import { FilesHandlers } from '../../../src/http/routes/files/handler.ts';
import { OnboardingHandlers } from '../../../src/http/routes/onboarding/handler.ts';
import { ServerHandlers } from '../../../src/http/routes/server/handler.ts';
import { StateHandlers } from '../../../src/http/routes/state/handler.ts';
import { TasksHandlers } from '../../../src/http/routes/tasks/handler.ts';
import type { RequestSourceShape } from '../../../src/http/schema.ts';
import type { HttpContext } from '../../../src/http/server.ts';
import { createHttpContext, createWebHandler } from '../../helpers/web.ts';

export const BASE = 'http://127.0.0.1:5180';

class RoutesApi extends HttpApi.make('engine').add(
  EngineApi.groups.tasks,
  EngineApi.groups.code,
  EngineApi.groups.commands,
  EngineApi.groups.server,
  EngineApi.groups.files,
  EngineApi.groups.state,
  EngineApi.groups.onboarding
) {}

const Routes = HttpApiBuilder.layer(RoutesApi).pipe(
  Layer.provide([
    TasksHandlers,
    CodeHandlers,
    CommandsHandlers,
    ServerHandlers,
    FilesHandlers,
    StateHandlers,
    OnboardingHandlers,
  ]),
  Layer.provide(EngineGateLive)
);

type ContextExtras = Partial<HttpContext> | ((base: HttpContext) => Partial<HttpContext>);

export function startRoutes(extras: ContextExtras = {}, config: Partial<ServerConfig> = {}) {
  const base = createHttpContext({}, config);
  const context = { ...base, ...(typeof extras === 'function' ? extras(base) : extras) };
  const handle = createWebHandler(context, Routes);
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
