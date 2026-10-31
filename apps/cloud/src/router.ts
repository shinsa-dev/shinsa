import { parseRemoteHookPath, REMOTE_PATHS } from '@shinsa/core';
import { createStore, type Database } from './database.ts';
import { respondHook } from './hooks.ts';
import { applySecurityHeaders, CloudError, respondError, respondJson } from './http.ts';
import {
  respondConnect,
  respondHeartbeat,
  respondInstanceRemove,
  respondInstances,
  respondMachineRemove,
  respondOffline,
} from './instances.ts';
import { recordFailure } from './log.ts';
import { respondPairApprove, respondPairPoll, respondPairStart, respondPairView } from './pairing.ts';
import {
  resolveCallbackFailureLocation,
  respondSession,
  respondSignIn,
  respondSignInCallback,
  respondSignInToken,
  respondSignOut,
} from './session.ts';
import type { CloudConfig, CloudWorld, Fetch } from './world.ts';

type Handler = (
  request: Request,
  url: URL,
  match: string[],
  world: CloudWorld
) => Promise<Response> | Response;

interface Route {
  method: string;
  pattern: RegExp;
  respond: Handler;
}

const SEGMENT = '([A-Za-z0-9_-]{1,64})';

function exact(path: string) {
  return new RegExp(`^${path.replaceAll('/', '\\/')}$`);
}

const ROUTES: Route[] = [
  {
    method: 'GET',
    pattern: exact(REMOTE_PATHS.session),
    respond: (request, _url, _match, world) => respondSession(request, world),
  },
  {
    method: 'GET',
    pattern: exact(REMOTE_PATHS.signIn),
    respond: (_request, url, _match, world) => respondSignIn(url, world),
  },
  {
    method: 'GET',
    pattern: exact(REMOTE_PATHS.signInCallback),
    respond: (request, url, _match, world) => respondSignInCallback(request, url, world),
  },
  {
    method: 'POST',
    pattern: exact(REMOTE_PATHS.signInToken),
    respond: (request, _url, _match, world) => respondSignInToken(request, world),
  },
  {
    method: 'POST',
    pattern: exact(REMOTE_PATHS.signOut),
    respond: (request, _url, _match, world) => respondSignOut(request, world),
  },
  {
    method: 'POST',
    pattern: exact(REMOTE_PATHS.pairStart),
    respond: (request, _url, _match, world) => respondPairStart(request, world),
  },
  {
    method: 'POST',
    pattern: exact(REMOTE_PATHS.pairPoll),
    respond: (request, _url, _match, world) => respondPairPoll(request, world),
  },
  {
    method: 'GET',
    pattern: new RegExp(`^${REMOTE_PATHS.pairs}/${SEGMENT}$`),
    respond: (request, _url, match, world) => respondPairView(request, match[1] ?? '', world),
  },
  {
    method: 'POST',
    pattern: new RegExp(`^${REMOTE_PATHS.pairs}/${SEGMENT}/approve$`),
    respond: (request, _url, match, world) => respondPairApprove(request, match[1] ?? '', world),
  },
  {
    method: 'GET',
    pattern: exact(REMOTE_PATHS.instances),
    respond: (request, _url, _match, world) => respondInstances(request, world),
  },
  {
    method: 'POST',
    pattern: new RegExp(`^${REMOTE_PATHS.instances}/${SEGMENT}/connect$`),
    respond: (request, _url, match, world) => respondConnect(request, match[1] ?? '', world),
  },
  {
    method: 'POST',
    pattern: new RegExp(`^${REMOTE_PATHS.instances}/${SEGMENT}/remove$`),
    respond: (request, _url, match, world) => respondInstanceRemove(request, match[1] ?? '', world),
  },
  {
    method: 'POST',
    pattern: exact(REMOTE_PATHS.heartbeat),
    respond: (request, _url, _match, world) => respondHeartbeat(request, world),
  },
  {
    method: 'POST',
    pattern: exact(REMOTE_PATHS.offline),
    respond: (request, _url, _match, world) => respondOffline(request, world),
  },
  {
    method: 'POST',
    pattern: exact(REMOTE_PATHS.machineRemove),
    respond: (request, _url, _match, world) => respondMachineRemove(request, world),
  },
];

const API_PREFIX = '/__remote/';

function respondCallbackFailure(request: Request, error: CloudError) {
  return new Response(null, {
    status: 302,
    headers: {
      location: resolveCallbackFailureLocation(request, error.code),
      'cache-control': 'no-store',
    },
  });
}

function describeFailure(error: unknown) {
  if (error instanceof CloudError && error.status < 500) return error;
  recordFailure('[Cloud] Request failed', { error });
  if (error instanceof CloudError) return error;
  return new CloudError('server_error', 'Something went wrong on app.shinsa.dev. Try again.', 500);
}

async function respondApi(request: Request, url: URL, world: CloudWorld) {
  for (const route of ROUTES) {
    const match = route.pattern.exec(url.pathname);
    if (!match || route.method !== request.method) continue;
    try {
      return await route.respond(request, url, [...match], world);
    } catch (error) {
      const failure = describeFailure(error);
      if (url.pathname === REMOTE_PATHS.signInCallback) return respondCallbackFailure(request, failure);
      return respondError(failure);
    }
  }
  return respondError(new CloudError('not_found', 'No such endpoint.', 404));
}

export async function respond(request: Request, world: CloudWorld) {
  const url = new URL(request.url);
  if (url.pathname.startsWith(API_PREFIX)) return applySecurityHeaders(await respondApi(request, url, world));
  const hook = parseRemoteHookPath(url.pathname);
  if (hook) {
    try {
      return await respondHook(request, url, hook, world);
    } catch (error) {
      return respondError(describeFailure(error));
    }
  }
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return respondJson({ error: { code: 'method_not_allowed', message: 'Only GET is served here.' } }, 405);
  return applySecurityHeaders(await world.assets(request));
}

export interface CloudBindings {
  db: Database;
  assets: (request: Request) => Promise<Response>;
  fetch: Fetch;
  now: () => number;
  config: CloudConfig;
}

export function createWorld(bindings: CloudBindings): CloudWorld {
  return {
    store: createStore(bindings.db),
    assets: bindings.assets,
    fetch: bindings.fetch,
    now: bindings.now,
    config: bindings.config,
  };
}
