import { parseRemoteHookPath, REMOTE_PATHS, SLACK_RELAY_PATHS, type TeamAction } from '@shinsa/core';
import { createStore, type Database } from './database.ts';
import { respondHook } from './hooks.ts';
import { applySecurityHeaders, CloudError, respondError, respondJson } from './http.ts';
import {
  NOINDEX,
  respondConnect,
  respondHeartbeat,
  respondInstanceRemove,
  respondInstances,
  respondMachineRemove,
  respondOffline,
  respondShareConnect,
} from './instances.ts';
import { recordFailure } from './log.ts';
import {
  respondInstanceLeave,
  respondInviteAccept,
  respondInviteCreate,
  respondInviteRemove,
  respondMachineMemberAdd,
  respondMachineMemberRemove,
  respondRequesterFind,
} from './members.ts';
import { respondPairApprove, respondPairPoll, respondPairStart, respondPairView } from './pairing.ts';
import {
  resolveCallbackFailureLocation,
  respondSession,
  respondSignIn,
  respondSignInCallback,
  respondSignInToken,
  respondSignOut,
} from './session.ts';
import {
  respondSlackEvents,
  respondSlackInteractions,
  respondSlackLinks,
  respondSlackPost,
  respondSlackReaction,
  respondSlackSession,
  respondSlackUnlink,
} from './slack.ts';
import {
  respondSlackConnect,
  respondSlackConnectCallback,
  respondSlackInstallCallback,
} from './slack-link.ts';
import {
  PAGE_TEAM_ACTIONS,
  respondTeamAction,
  respondTeamCreate,
  respondTeamJoin,
  respondTeamPreview,
  respondTeams,
  TEAM_ACTIONS,
} from './teams.ts';
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

function teamActions(prefix: string, actions: readonly TeamAction[]) {
  return new RegExp(`^${prefix}/${SEGMENT}/(${actions.join('|')})$`);
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
    pattern: new RegExp(`^${REMOTE_PATHS.shares}/${SEGMENT}/connect$`),
    respond: (_request, _url, match, world) => respondShareConnect(match[1] ?? '', world),
  },
  {
    method: 'POST',
    pattern: new RegExp(`^${REMOTE_PATHS.instances}/${SEGMENT}/remove$`),
    respond: (request, _url, match, world) => respondInstanceRemove(request, match[1] ?? '', world),
  },
  {
    method: 'POST',
    pattern: new RegExp(`^${REMOTE_PATHS.instances}/${SEGMENT}/leave$`),
    respond: (request, _url, match, world) => respondInstanceLeave(request, match[1] ?? '', world),
  },
  {
    method: 'POST',
    pattern: exact(REMOTE_PATHS.inviteAccept),
    respond: (request, _url, _match, world) => respondInviteAccept(request, world),
  },
  {
    method: 'POST',
    pattern: exact(REMOTE_PATHS.machineInvites),
    respond: (request, _url, _match, world) => respondInviteCreate(request, world),
  },
  {
    method: 'POST',
    pattern: exact(REMOTE_PATHS.machineInviteRemove),
    respond: (request, _url, _match, world) => respondInviteRemove(request, world),
  },
  {
    method: 'POST',
    pattern: exact(REMOTE_PATHS.machineRequester),
    respond: (request, _url, _match, world) => respondRequesterFind(request, world),
  },
  {
    method: 'POST',
    pattern: exact(REMOTE_PATHS.machineMemberAdd),
    respond: (request, _url, _match, world) => respondMachineMemberAdd(request, world),
  },
  {
    method: 'POST',
    pattern: exact(REMOTE_PATHS.machineMemberRemove),
    respond: (request, _url, _match, world) => respondMachineMemberRemove(request, world),
  },
  {
    method: 'GET',
    pattern: exact(REMOTE_PATHS.teams),
    respond: (request, _url, _match, world) => respondTeams(request, world),
  },
  {
    method: 'POST',
    pattern: exact(REMOTE_PATHS.teamJoin),
    respond: (request, _url, _match, world) => respondTeamJoin(request, 'page', world),
  },
  {
    method: 'POST',
    pattern: exact(REMOTE_PATHS.teamPreview),
    respond: (request, _url, _match, world) => respondTeamPreview(request, world),
  },
  {
    method: 'POST',
    pattern: teamActions(REMOTE_PATHS.teams, PAGE_TEAM_ACTIONS),
    respond: (request, _url, match, world) =>
      respondTeamAction(request, 'page', match[1] ?? '', match[2] as TeamAction, world),
  },
  {
    method: 'POST',
    pattern: exact(REMOTE_PATHS.machineTeams),
    respond: (request, _url, _match, world) => respondTeamCreate(request, world),
  },
  {
    method: 'POST',
    pattern: exact(REMOTE_PATHS.machineTeamJoin),
    respond: (request, _url, _match, world) => respondTeamJoin(request, 'machine', world),
  },
  {
    method: 'POST',
    pattern: teamActions(REMOTE_PATHS.machineTeams, TEAM_ACTIONS),
    respond: (request, _url, match, world) =>
      respondTeamAction(request, 'machine', match[1] ?? '', match[2] as TeamAction, world),
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
  {
    method: 'GET',
    pattern: exact(SLACK_RELAY_PATHS.links),
    respond: (request, _url, _match, world) => respondSlackLinks(request, world),
  },
  {
    method: 'POST',
    pattern: exact(SLACK_RELAY_PATHS.unlink),
    respond: (request, _url, _match, world) => respondSlackUnlink(request, world),
  },
  {
    method: 'POST',
    pattern: exact(SLACK_RELAY_PATHS.post),
    respond: (request, _url, _match, world) => respondSlackPost(request, world),
  },
  {
    method: 'POST',
    pattern: exact(SLACK_RELAY_PATHS.session),
    respond: (request, _url, _match, world) => respondSlackSession(request, world),
  },
  {
    method: 'POST',
    pattern: exact(SLACK_RELAY_PATHS.react),
    respond: (request, _url, _match, world) => respondSlackReaction(request, world),
  },
];

const SLACK_ROUTES: Route[] = [
  {
    method: 'GET',
    pattern: exact(SLACK_RELAY_PATHS.connect),
    respond: (request, url, _match, world) => respondSlackConnect(request, url, world),
  },
  {
    method: 'GET',
    pattern: exact(SLACK_RELAY_PATHS.connectCallback),
    respond: (request, url, _match, world) => respondSlackConnectCallback(request, url, world),
  },
  {
    method: 'GET',
    pattern: exact(SLACK_RELAY_PATHS.installCallback),
    respond: (request, url, _match, world) => respondSlackInstallCallback(request, url, world),
  },
  {
    method: 'POST',
    pattern: exact(SLACK_RELAY_PATHS.events),
    respond: (request, _url, _match, world) => respondSlackEvents(request, world),
  },
  {
    method: 'POST',
    pattern: exact(SLACK_RELAY_PATHS.interactions),
    respond: (request, _url, _match, world) => respondSlackInteractions(request, world),
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
  const slack = SLACK_ROUTES.find(
    (route) => route.method === request.method && route.pattern.test(url.pathname)
  );
  if (slack) {
    try {
      return applySecurityHeaders(await slack.respond(request, url, [], world));
    } catch (error) {
      return applySecurityHeaders(respondError(describeFailure(error)));
    }
  }
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
  const page = applySecurityHeaders(await world.assets(request));
  if (url.pathname.startsWith(`${REMOTE_PATHS.sharePage}/`) || url.pathname === REMOTE_PATHS.teamJoinPage)
    page.headers.set('x-robots-tag', NOINDEX);
  return page;
}

export interface CloudBindings {
  db: Database;
  assets: (request: Request) => Promise<Response>;
  fetch: Fetch;
  now: () => number;
  defer: (work: Promise<unknown>) => void;
  config: CloudConfig;
}

export function createWorld(bindings: CloudBindings): CloudWorld {
  return {
    store: createStore(bindings.db),
    assets: bindings.assets,
    fetch: bindings.fetch,
    now: bindings.now,
    defer: bindings.defer,
    config: bindings.config,
  };
}
