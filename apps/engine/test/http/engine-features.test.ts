import { describe, expect, test } from 'bun:test';
import { ENGINE_FEATURES } from '@shinsa/core';
import { ENGINE_FEATURE_ROUTES } from '../../src/http/features.ts';
import { type ApiContext, type ApiRoute, listApiRoutes } from '../../src/http/routes.ts';
import { createScheduleRoutes } from '../../src/schedules/routes.ts';
import { Slack } from '../../src/slack/index.ts';
import { createTerminalRoutes } from '../../src/terminals/index.ts';
import { createTestConfig } from '../helpers/index.ts';

const BASELINE_ROUTES = [
  'GET /api/accounts',
  'GET /api/activity',
  'GET /api/attachments/(.+)',
  'GET /api/delegations',
  'GET /api/evidence/(.+)',
  'GET /api/extensions',
  'GET /api/health',
  'GET /api/memory',
  'GET /api/models',
  'GET /api/onboarding',
  'GET /api/onboarding/flow',
  'GET /api/onboarding/prerequisites',
  'GET /api/onboarding/roots',
  'GET /api/projects',
  'GET /api/providers',
  'GET /api/queue',
  'GET /api/remote',
  'GET /api/repos',
  'GET /api/repos/coverage',
  'GET /api/repos/local',
  'GET /api/schedules',
  'GET /api/schedules/([^/]+)/webhook',
  'GET /api/services/suggestions',
  'GET /api/settings',
  'GET /api/slack',
  'GET /api/tasks',
  'GET /api/tasks/([^/]+)',
  'GET /api/tasks/([^/]+)/blob',
  'GET /api/tasks/([^/]+)/chat',
  'GET /api/tasks/([^/]+)/diff',
  'GET /api/tasks/([^/]+)/paths',
  'GET /api/tasks/([^/]+)/raw',
  'GET /api/tasks/([^/]+)/refs',
  'GET /api/tasks/([^/]+)/search',
  'GET /api/tasks/([^/]+)/tree',
  'GET /api/terminals',
  'GET /api/terminals/([^/]+)/foreground',
  'GET /api/versions',
  'POST /api/accounts/import',
  'POST /api/accounts/login',
  'POST /api/accounts/login/cancel',
  'POST /api/accounts/login/code',
  'POST /api/accounts/refresh',
  'POST /api/accounts/remove',
  'POST /api/accounts/update',
  'POST /api/attachments',
  'POST /api/commands',
  'POST /api/engine/restart',
  'POST /api/extensions/check',
  'POST /api/extensions/optimizer',
  'POST /api/extensions/plugins/choose',
  'POST /api/extensions/servers/add',
  'POST /api/extensions/servers/choose',
  'POST /api/extensions/servers/remove',
  'POST /api/extensions/servers/sign-in',
  'POST /api/extensions/servers/sign-out',
  'POST /api/extensions/servers/update',
  'POST /api/extensions/skills/choose',
  'POST /api/onboarding/flow',
  'POST /api/onboarding/install',
  'POST /api/onboarding/privacy',
  'POST /api/onboarding/setup',
  'POST /api/placement',
  'POST /api/projects/([^/]+)/folders',
  'POST /api/projects/([^/]+)/repos',
  'POST /api/remote/devices/remove',
  'POST /api/remote/disable',
  'POST /api/remote/enable',
  'POST /api/remote/link/create',
  'POST /api/remote/link/remove',
  'POST /api/remote/members/remove',
  'POST /api/remote/pair',
  'POST /api/remote/pair/cancel',
  'POST /api/remote/remove',
  'POST /api/remote/requests/accept',
  'POST /api/remote/requests/decline',
  'POST /api/schedules/([^/]+)/webhook',
  'POST /api/secrets/([^/]+)',
  'POST /api/services',
  'POST /api/services/([^/]+)/restart',
  'POST /api/services/([^/]+)/start',
  'POST /api/services/([^/]+)/stop',
  'POST /api/services/([^/]+)/update',
  'POST /api/services/batch',
  'POST /api/services/remove',
  'POST /api/services/start-all',
  'POST /api/slack/disconnect',
  'POST /api/tasks/([^/]+)/file',
  'POST /api/tasks/([^/]+)/open',
  'POST /api/terminals',
  'POST /api/terminals/([^/]+)/close',
  'POST /api/terminals/([^/]+)/rename',
  'POST /api/terminals/([^/]+)/restart',
  'POST /api/terminals/order',
  'POST /api/versions/refresh',
  'POST /api/versions/update',
];

const ROUTE_RULE =
  'is in neither BASELINE_ROUTES nor a feature: name it in ENGINE_FEATURES (packages/core) and ENGINE_FEATURE_ROUTES (src/http/features.ts), and gate what calls it with useEngineFeature';

function resolveRouteKey(route: Pick<ApiRoute, 'method' | 'pattern'>) {
  return `${route.method} ${route.pattern.source.slice(1, -1).replaceAll('\\/', '/')}`;
}

function listRouteKeys() {
  const engine = {} as never;
  const stub = {} as never;
  const context: Required<ApiContext> = {
    engine,
    remote: stub,
    shares: stub,
    slack: { routes: () => Slack.prototype.routes.call(stub) } as never,
    config: createTestConfig(),
    instance: stub,
    evidence: stub,
    models: stub,
    providers: stub,
    onboarding: stub,
    launch: stub,
    accounts: stub,
    schedules: { routes: () => createScheduleRoutes(engine, stub, stub) } as never,
    transcripts: stub,
    extensions: stub,
    versions: stub,
    roots: stub,
    resolveLogin: stub,
    classify: stub,
    place: stub,
    workspaces: stub,
    restarter: stub,
    previews: stub,
    teams: stub,
    teamFeeds: stub,
  };
  return listApiRoutes(context, createTerminalRoutes(engine, { home: '/tmp' } as never)).map(resolveRouteKey);
}

const featureRoutes = Object.values(ENGINE_FEATURE_ROUTES).flat();

describe('engine routes', () => {
  test('every API route is in the baseline or belongs to a named feature, so a page can tell whether an engine has it', () => {
    const known = new Set([...BASELINE_ROUTES, ...featureRoutes]);
    const unknown = listRouteKeys().filter((key) => !known.has(key));
    expect(unknown.map((key) => `${key} ${ROUTE_RULE}`)).toEqual([]);
  });

  test('the baseline and every feature name only routes the engine still serves', () => {
    const served = new Set(listRouteKeys());
    expect([...BASELINE_ROUTES, ...featureRoutes].filter((key) => !served.has(key))).toEqual([]);
  });

  test('a route belongs to the baseline or to one feature, never both', () => {
    const keys = [...BASELINE_ROUTES, ...featureRoutes];
    expect(keys.filter((key, index) => keys.indexOf(key) !== index)).toEqual([]);
  });

  test('every feature has its routes listed', () => {
    expect(Object.keys(ENGINE_FEATURE_ROUTES).sort()).toEqual([...ENGINE_FEATURES].sort());
  });

  test('reads a route as its method and path', () => {
    expect(resolveRouteKey({ method: 'GET', pattern: /^\/api\/tasks\/([^/]+)\/refs$/ })).toBe(
      'GET /api/tasks/([^/]+)/refs'
    );
  });
});
