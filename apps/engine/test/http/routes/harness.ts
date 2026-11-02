import { EngineApi } from '@shinsa/core/engine-api';
import { Layer } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import type { ServerConfig } from '../../../src/config/index.ts';
import { EngineGateLive } from '../../../src/http/gate/middleware.ts';
import { AccountsHandlers } from '../../../src/http/routes/accounts/handler.ts';
import { CodeHandlers } from '../../../src/http/routes/code/handler.ts';
import { CommandsHandlers } from '../../../src/http/routes/commands/handler.ts';
import { ExtensionsHandlers } from '../../../src/http/routes/extensions/handler.ts';
import { FilesHandlers } from '../../../src/http/routes/files/handler.ts';
import { OnboardingHandlers } from '../../../src/http/routes/onboarding/handler.ts';
import { PlacementHandlers } from '../../../src/http/routes/placement/handler.ts';
import { ProjectsHandlers } from '../../../src/http/routes/projects/handler.ts';
import { RemoteHandlers } from '../../../src/http/routes/remote/handler.ts';
import { SecretsHandlers } from '../../../src/http/routes/secrets/handler.ts';
import { ServerHandlers } from '../../../src/http/routes/server/handler.ts';
import { ServicesHandlers } from '../../../src/http/routes/services/handler.ts';
import { SlackHandlers } from '../../../src/http/routes/slack/handler.ts';
import { StateHandlers } from '../../../src/http/routes/state/handler.ts';
import { TasksHandlers } from '../../../src/http/routes/tasks/handler.ts';
import { TeamsHandlers } from '../../../src/http/routes/teams/handler.ts';
import { TerminalsHandlers } from '../../../src/http/routes/terminals/handler.ts';
import { VersionsHandlers } from '../../../src/http/routes/versions/handler.ts';
import type { RequestSourceShape } from '../../../src/http/schema.ts';
import type { HttpContext } from '../../../src/http/server.ts';
import { createHttpContext, createWebHandler } from '../../helpers/web.ts';

export const BASE = 'http://127.0.0.1:5180';

const Routes = HttpApiBuilder.layer(EngineApi).pipe(
  Layer.provide([
    TasksHandlers,
    CodeHandlers,
    CommandsHandlers,
    ServerHandlers,
    FilesHandlers,
    StateHandlers,
    OnboardingHandlers,
    AccountsHandlers,
    SecretsHandlers,
    ExtensionsHandlers,
    VersionsHandlers,
    RemoteHandlers,
    TeamsHandlers,
    PlacementHandlers,
    SlackHandlers,
    ProjectsHandlers,
    TerminalsHandlers,
    ServicesHandlers,
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

export async function readFailure(response: Response) {
  const body = (await response.json()) as { error: { code: string; message: string } };
  return { status: response.status, ...body.error };
}
