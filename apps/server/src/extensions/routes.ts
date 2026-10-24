import { type JsonObject, readJsonObject } from '../http/body.ts';
import type { ApiRoute } from '../http/routes.ts';
import type { Extensions } from './index.ts';

export function respondSignInPage(extensions: Extensions, request: Request) {
  return extensions.finishSignIn(new URL(request.url)).then(
    (html) =>
      new Response(html, {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      })
  );
}

export function createExtensionRoutes(extensions: Extensions): ApiRoute[] {
  const post = (path: string, act: (fields: JsonObject) => unknown): ApiRoute => ({
    method: 'POST',
    pattern: new RegExp(`^/api/extensions${path}$`),
    respond: async (_match, request) => Response.json(await act(await readJsonObject(request))),
  });
  return [
    {
      method: 'GET',
      pattern: /^\/api\/extensions$/,
      respond: () => Promise.resolve(Response.json(extensions.snapshot())),
    },
    post('/check', (fields) => extensions.check(fields.serverId)),
    post('/servers/add', (fields) => extensions.createServer(fields.server)),
    post('/servers/update', (fields) => extensions.updateServer(fields.serverId, fields.server)),
    post('/servers/remove', (fields) => extensions.removeServer(fields.serverId)),
    post('/servers/choose', (fields) => extensions.updateServerChoice(fields.serverId, fields)),
    post('/servers/sign-in', (fields) => extensions.startSignIn(fields.serverId)),
    post('/servers/sign-out', (fields) => extensions.signOut(fields.serverId)),
    post('/skills/choose', (fields) => extensions.updateSkillChoice(fields.skillId, fields.enabled)),
    post('/plugins/choose', (fields) => extensions.updatePluginChoice(fields.pluginId, fields.enabled)),
    post('/optimizer', (fields) => extensions.updateOptimizer(fields)),
  ];
}
