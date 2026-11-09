import { describe, expect, test } from 'bun:test';
import {
  listEngineBaselineRoutes,
  listEngineRoutes,
  resolveEngineFeatureRoutes,
  resolveEngineRouteKey,
} from '../../src/engine-api/routes.ts';
import { ATTACHMENT_UPLOAD_LIMIT_BYTES, ENGINE_BODY_LIMIT_BYTES } from '../../src/engine-api/schema.ts';
import { ENGINE_FEATURES } from '../../src/protocol/engine.ts';

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

const FEATURE_ROUTES = {
  'task.share': [],
  feedback: ['GET /api/feedback'],
  teams: [
    'POST /api/remote/members/grant',
    'POST /api/remote/teams/create',
    'POST /api/remote/teams/join',
    'POST /api/remote/teams/link',
    'POST /api/remote/teams/link/renew',
    'POST /api/remote/teams/link/remove',
    'POST /api/remote/teams/requests/accept',
    'POST /api/remote/teams/requests/decline',
    'POST /api/remote/teams/members/remove',
    'POST /api/remote/teams/leave',
    'POST /api/remote/teams/remove',
    'GET /api/teams/tasks',
  ],
  'review.approve_after_fix': [],
  'message.line_comments': [],
  changelog: ['GET /api/changelog'],
  'remote.terminals': [],
  attention: [],
  'worktree-root': ['POST /api/onboarding/worktrees', 'GET /api/onboarding/worktrees/usage'],
  'team-access': [
    'POST /api/remote/teams/scopes',
    'POST /api/remote/teams/extra',
    'GET /api/remote/teams/keys',
  ],
  'team-keys': ['POST /api/remote/teams/key/request', 'POST /api/remote/teams/key/answer'],
  'usage.pace_limits': [],
  'usage.auto_pace': [],
  'team-relay': ['GET /api/teams/relays'],
  'usage.watchdog_limits': [],
  'share.scopes': [],
  'suggestion.bundle': [],
  'shared-machine': ['GET /api/github-token', 'POST /api/github-token', 'POST /api/remote/teams/share'],
  'focus.projects': [],
};

const LOCAL_ONLY = [
  { pattern: /^\/api\/remote(?:\/(?:pair|pair\/cancel|enable|disable|remove))?$/, writesOnly: true },
  { pattern: /^\/api\/extensions\/servers\/sign-in$/, writesOnly: true },
  { pattern: /^\/api\/tasks\/[^/]+\/open$/, writesOnly: true },
  { pattern: /^\/api\/onboarding\/install$/, writesOnly: true },
  { pattern: /^\/api\/teams\/relays$/, writesOnly: false },
];

const OWNER_ONLY = [
  'GET /api/github-token',
  'POST /api/github-token',
  'POST /api/remote/link/create',
  'POST /api/remote/link/remove',
  'POST /api/remote/members/grant',
  'POST /api/remote/members/remove',
  'POST /api/remote/teams/share',
  'POST /api/remote/devices/remove',
  'POST /api/remote/teams/create',
  'POST /api/remote/teams/join',
  'POST /api/remote/teams/link',
  'POST /api/remote/teams/link/renew',
  'POST /api/remote/teams/link/remove',
  'POST /api/remote/teams/requests/accept',
  'POST /api/remote/teams/requests/decline',
  'POST /api/remote/teams/members/remove',
  'POST /api/remote/teams/leave',
  'POST /api/remote/teams/remove',
  'POST /api/remote/teams/scopes',
  'POST /api/remote/teams/extra',
  'POST /api/remote/teams/key/request',
  'POST /api/remote/teams/key/answer',
  'POST /api/slack/disconnect',
  'POST /api/engine/restart',
  'POST /api/onboarding/setup',
  'POST /api/onboarding/privacy',
  'POST /api/onboarding/flow',
  'POST /api/onboarding/worktrees',
  'POST /api/accounts/refresh',
  'POST /api/accounts/login',
  'POST /api/accounts/login/code',
  'POST /api/accounts/login/cancel',
  'POST /api/accounts/import',
  'POST /api/accounts/update',
  'POST /api/accounts/remove',
  'POST /api/schedules/([^/]+)/webhook',
  'POST /api/secrets/([^/]+)',
  'POST /api/extensions/check',
  'POST /api/extensions/servers/add',
  'POST /api/extensions/servers/update',
  'POST /api/extensions/servers/remove',
  'POST /api/extensions/servers/choose',
  'POST /api/extensions/servers/sign-in',
  'POST /api/extensions/servers/sign-out',
  'POST /api/extensions/skills/choose',
  'POST /api/extensions/plugins/choose',
  'POST /api/extensions/optimizer',
  'POST /api/versions/update',
  'GET /api/services/suggestions',
  'GET /api/remote/teams/keys',
  'POST /api/services',
  'POST /api/services/batch',
  'POST /api/services/remove',
  'POST /api/services/([^/]+)/update',
  'GET /api/terminals',
  'GET /api/terminals/([^/]+)/foreground',
  'POST /api/terminals',
  'POST /api/terminals/([^/]+)/close',
  'POST /api/terminals/([^/]+)/rename',
  'POST /api/terminals/([^/]+)/restart',
  'POST /api/terminals/order',
];

const OLD_TASK_READS = /^\/api\/tasks\/:taskRef(?:\/(?:blob|chat|diff|paths|raw|refs|search|tree))?$/;

function isLocalOnly(method: string, path: string) {
  const writes = method !== 'GET';
  return LOCAL_ONLY.some((route) => route.pattern.test(path) && (writes || !route.writesOnly));
}

function resolveOldGuest(method: string, path: string) {
  if (method !== 'GET') return 'none';
  if (path === '/api/health') return 'any';
  if (path === '/api/terminals') return 'filtered';
  if (OLD_TASK_READS.test(path)) return 'own_task';
  if (path === '/api/evidence/*' || path === '/api/attachments/*') return 'task_file';
  return 'none';
}

const sorted = (keys: readonly string[]) => [...keys].sort();

describe('EngineApi routes', () => {
  test('declares exactly the routes the engine serves: the frozen baseline and every feature', () => {
    const keys = listEngineRoutes().map((route) => route.key);
    expect(sorted(keys)).toEqual(sorted([...BASELINE_ROUTES, ...Object.values(FEATURE_ROUTES).flat()]));
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('names the routes of each feature from its annotation, and the rest are the baseline', () => {
    const features = resolveEngineFeatureRoutes();
    expect(sorted(Object.keys(features))).toEqual(sorted(ENGINE_FEATURES));
    for (const feature of ENGINE_FEATURES)
      expect(sorted(features[feature])).toEqual(sorted(FEATURE_ROUTES[feature]));
    expect(sorted(listEngineBaselineRoutes())).toEqual(sorted(BASELINE_ROUTES));
  });

  test('keeps at the machine only what needs its screen or ends the channel', () => {
    for (const route of listEngineRoutes())
      expect([route.key, route.localOnly]).toEqual([route.key, isLocalOnly(route.method, route.path)]);
  });

  test('lets a guest read only the health check, the scoped terminals list, its own task and that task’s files', () => {
    for (const route of listEngineRoutes())
      expect([route.key, route.guest]).toEqual([route.key, resolveOldGuest(route.method, route.path)]);
  });

  test('settings, accounts, MCPs, secrets, versions, restarting, teams, Slack, the invite link, members, devices, a service’s command and terminals are for the owner, and only an attachment upload takes a larger body', () => {
    const routes = listEngineRoutes();
    expect(sorted(routes.filter((route) => route.ownerOnly).map((route) => route.key))).toEqual(
      sorted(OWNER_ONLY)
    );
    const larger = routes.filter((route) => route.bodyLimit !== ENGINE_BODY_LIMIT_BYTES);
    expect(larger.map((route) => [route.key, route.bodyLimit])).toEqual([
      ['POST /api/attachments', ATTACHMENT_UPLOAD_LIMIT_BYTES],
    ]);
  });

  test('opens to a shared machine’s members only their own Claude accounts and GitHub token, each still owner-only elsewhere', () => {
    const shared = listEngineRoutes().filter((route) => route.sharedMember);
    expect(sorted(shared.map((route) => route.key))).toEqual(
      sorted([
        'POST /api/accounts/refresh',
        'POST /api/accounts/login',
        'POST /api/accounts/login/code',
        'POST /api/accounts/login/cancel',
        'POST /api/accounts/import',
        'POST /api/accounts/update',
        'POST /api/accounts/remove',
        'GET /api/github-token',
        'POST /api/github-token',
      ])
    );
    expect(shared.every((route) => route.ownerOnly)).toBe(true);
  });

  test('marks the routes only Shinsa’s own page may call', () => {
    const browserOnly = listEngineRoutes()
      .filter((route) => route.browserOnly)
      .map((route) => route.key);
    expect(sorted(browserOnly)).toEqual(
      sorted([
        'POST /api/onboarding/install',
        'POST /api/services',
        'POST /api/services/([^/]+)/update',
        'POST /api/services/batch',
        'POST /api/services/remove',
        'POST /api/terminals',
        'POST /api/terminals/([^/]+)/close',
        'POST /api/terminals/([^/]+)/rename',
        'POST /api/terminals/([^/]+)/restart',
        'POST /api/terminals/order',
      ])
    );
  });

  test('reads a path as its method and the pattern the frozen baseline uses', () => {
    expect(resolveEngineRouteKey('GET', '/api/tasks/:taskRef/refs')).toBe('GET /api/tasks/([^/]+)/refs');
    expect(resolveEngineRouteKey('GET', '/api/evidence/*')).toBe('GET /api/evidence/(.+)');
  });
});
