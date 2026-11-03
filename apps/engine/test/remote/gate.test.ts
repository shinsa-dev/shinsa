import { describe, expect, test } from 'bun:test';
import { type ChatEntry, createState, type GuestActor, type ShinsaState } from '@shinsa/core';
import { GuestRoute, LocalOnlyRoute, OwnerOnlyRoute } from '@shinsa/core/engine-api/schema';
import { Context, Effect, Layer, Result } from 'effect';
import type { ServerConfig } from '../../src/config/index.ts';
import type { HttpContext, RequestSourceShape } from '../../src/http/schema.ts';
import { HttpServices } from '../../src/http/services/service.ts';
import type { TunnelGate as TunnelGateService } from '../../src/remote/gate/service.ts';
import { TunnelGate } from '../../src/remote/gate/service.ts';
import type { Engine } from '../../src/runtime/index.ts';
import { createHttpContext } from '../helpers/web.ts';

const BRIEF = '<attachments><attachment url="/api/attachments/a1/brief.png" /></attachments>';

const NOTE = '<attachments><attachment url="/api/attachments/a2/note.txt" /></attachments>';

function createGuestState(): ShinsaState {
  const state = createState();
  return {
    ...state,
    tasks: {
      t1: {
        id: 't1',
        request: `Fix it ${BRIEF}`,
        inbox: [{ id: 'm1', text: `And this ${NOTE}`, at: 1 }],
      },
      t2: {
        id: 't2',
        request: 'Other <attachments><attachment url="/api/attachments/a3/secret.png" /></attachments>',
      },
    } as unknown as ShinsaState['tasks'],
    runs: {
      r1: { id: 'r1', taskId: 't1' },
      r2: { id: 'r2', taskId: 't2' },
    } as unknown as ShinsaState['runs'],
    evidence: {
      e1: { id: 'e1', taskId: 't1', uri: '/api/evidence/t1/round-1/shot.png' },
      e2: { id: 'e2', taskId: 't2', uri: '/api/evidence/t2/round-1/other.png' },
      e3: { id: 'e3', taskId: 't1', uri: '/api/evidence/legacy.png' },
    } as unknown as ShinsaState['evidence'],
  };
}

const ENTRIES: Record<string, ChatEntry[]> = {
  r1: [
    { type: 'tool_result', callId: 'c', status: 'ok', output: '', images: ['/api/evidence/tool1.png'] },
    {
      type: 'user',
      from: 'you',
      text: 'Look at /api/evidence/tool2.png',
      attachments: [
        { kind: 'image', name: 'x', url: '/api/attachments/a4/x.png', mimeType: null, size: null },
      ],
    },
    { type: 'agent', phase: 'final', text: '/api/evidence/tool2.png' },
  ] as unknown as ChatEntry[],
  r2: [
    { type: 'tool_result', callId: 'c', status: 'ok', output: '', images: ['/api/evidence/tool2.png'] },
  ] as unknown as ChatEntry[],
};

const transcripts = { listEntries: (runId: string) => ENTRIES[runId] ?? [] };

const APP = 'https://app.shinsa.dev';

const OWNER_ID = 'u-owner';

const GOOD_TOKEN = 'good';

function createRemote(overrides: Record<string, unknown> = {}) {
  return {
    isEnabled: true,
    tunnelHost: 't-k3x9.shinsa.dev',
    appOrigin: APP,
    verifyConnect: (token: string | null) =>
      Promise.resolve(token === GOOD_TOKEN ? { userId: 'u-member', instanceId: 'i', exp: 0 } : null),
    store: { file: { access: { owner: { id: OWNER_ID }, members: [] } } },
    ...overrides,
  } as unknown as HttpContext['remote'];
}

function createGateContext(overrides: Partial<HttpContext> = {}, config: Partial<ServerConfig> = {}) {
  return createHttpContext(
    {
      remote: createRemote(),
      engine: { state: createGuestState() } as unknown as Engine,
      transcripts: transcripts as unknown as HttpContext['transcripts'],
      ...overrides,
    },
    config
  );
}

type Gate = TunnelGateService['Service'];

function runGate<A, E>(use: (gate: Gate) => Effect.Effect<A, E>, context = createGateContext()) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const gate = yield* TunnelGate;
      return yield* Effect.result(use(gate));
    }).pipe(Effect.provide(TunnelGate.layer.pipe(Layer.provide(HttpServices.layer(context)))))
  );
}

function readGate<A>(use: (gate: Gate) => A, context = createGateContext()) {
  return Effect.runSync(
    Effect.gen(function* () {
      return use(yield* TunnelGate);
    }).pipe(Effect.provide(TunnelGate.layer.pipe(Layer.provide(HttpServices.layer(context)))))
  );
}

function refusalOf<A, E extends { readonly _tag: string }>(result: Result.Result<A, E>) {
  return Result.isFailure(result) ? result.failure._tag : null;
}

const GUEST: GuestActor = { taskId: 't1' } as GuestActor;

function channelSource(userId: string | null, guest: GuestActor | null = null): RequestSourceShape {
  return { via: 'channel', guest, userId };
}

const LOCAL: RequestSourceShape = { via: 'local', guest: null, userId: null };

const TUNNEL: RequestSourceShape = { via: 'tunnel', guest: null, userId: null };

function request(path: string, init: RequestInit = {}) {
  return new Request(`http://127.0.0.1${path}`, init);
}

function annotate(entries: {
  guest?: 'none' | 'any' | 'own_task' | 'task_file';
  localOnly?: boolean;
  ownerOnly?: boolean;
}) {
  return Context.empty().pipe(
    Context.add(GuestRoute, entries.guest ?? 'none'),
    Context.add(LocalOnlyRoute, entries.localOnly ?? false),
    Context.add(OwnerOnlyRoute, entries.ownerOnly ?? false)
  ) as Context.Context<never>;
}

async function canRead(path: string, method = 'GET') {
  const result = await runGate((gate) =>
    gate.admitEndpoint(
      annotate({ guest: 'task_file' }),
      { method, pathname: path },
      channelSource('u-guest', GUEST)
    )
  );
  return Result.isSuccess(result);
}

async function upgrade(
  path: string,
  headers: Record<string, string> = { origin: APP },
  context = createGateContext()
) {
  const result = await runGate(
    (gate) => gate.admitUpgrade(request(path, { headers }), new URL(`http://x${path}`)),
    context
  );
  return Result.isSuccess(result) ? result.success : result.failure._tag;
}

describe('what counts as the tunnel', () => {
  test('a request Cloudflare forwarded or one naming the tunnel host, and nothing without remote access', () => {
    expect(
      readGate((gate) => gate.isTunnel(request('/', { headers: { 'cf-connecting-ip': '1.2.3.4' } })))
    ).toBe(true);
    expect(
      readGate((gate) => gate.isTunnel(request('/', { headers: { host: 'T-K3X9.shinsa.dev:443' } })))
    ).toBe(true);
    expect(readGate((gate) => gate.isTunnel(request('/')))).toBe(false);
    const noHost = createGateContext({ remote: createRemote({ tunnelHost: null }) });
    expect(
      readGate((gate) => gate.isTunnel(request('/', { headers: { host: 't-k3x9.shinsa.dev' } })), noHost)
    ).toBe(false);
    const off = createGateContext({ remote: undefined });
    expect(
      readGate((gate) => gate.isTunnel(request('/', { headers: { 'cf-connecting-ip': '1.2.3.4' } })), off)
    ).toBe(false);
  });

  test('the route table names every route the tunnel has, with its methods', () => {
    const route = (pathname: string, method = 'GET') =>
      readGate((gate) => gate.resolveRoute({ method, pathname }));
    expect(route('/health')).toBe('health');
    expect(route('/health', 'POST')).toBeNull();
    expect(route('/api/hooks/s/t', 'POST')).toBe('hook');
    expect(route('/remote')).toBe('channel');
    expect(route('/remote', 'POST')).toBeNull();
    expect(route('/share')).toBe('share');
    expect(route('/share', 'POST')).toBeNull();
    expect(route('/team')).toBe('team');
    expect(route('/__preview/AAAAAAAAAAAAAA/api', 'POST')).toBe('preview');
    expect(route('/api/slack/events', 'POST')).toBe('slack');
    expect(route('/api/slack/interactions', 'POST')).toBe('slack');
    expect(route('/api/slack/events')).toBeNull();
    expect(route('/api/tasks')).toBeNull();
    expect(route('/ws')).toBeNull();
    expect(route('/')).toBeNull();
  });
});

describe('a plain request over the tunnel', () => {
  const admit = (path: string, method = 'GET', source = TUNNEL, context = createGateContext()) =>
    runGate(
      (gate) => gate.admitRequest(request(path, { method }), new URL(`http://x${path}`), source),
      context
    ).then(refusalOf);

  test('reaches only health, webhooks and Slack, and nothing while remote access is off', async () => {
    expect(await admit('/health')).toBeNull();
    expect(await admit('/api/hooks/s/t', 'POST')).toBeNull();
    expect(await admit('/api/slack/events', 'POST')).toBeNull();
    expect(await admit('/remote')).toBe('RouteNotFound');
    expect(await admit('/__preview/AAAAAAAAAAAAAA/')).toBe('RouteNotFound');
    expect(await admit('/api/tasks')).toBe('RouteNotFound');
    expect(await admit('/')).toBe('RouteNotFound');
    const off = createGateContext({ remote: createRemote({ isEnabled: false }) });
    expect(await admit('/health', 'GET', TUNNEL, off)).toBe('RouteNotFound');
  });

  test('keeps webhooks and Slack read-only in inspect mode', async () => {
    const inspect = createGateContext({}, { inspect: true });
    expect(await admit('/api/hooks/s/t', 'POST', TUNNEL, inspect)).toBe('InspectReadOnly');
    expect(await admit('/api/slack/events', 'POST', TUNNEL, inspect)).toBe('InspectReadOnly');
    expect(await admit('/health', 'GET', TUNNEL, inspect)).toBeNull();
  });

  test('a tunnel-only route does not exist on this machine', async () => {
    expect(await admit('/health', 'GET', LOCAL)).toBe('RouteNotFound');
    expect(await admit('/api/slack/events', 'POST', LOCAL)).toBe('RouteNotFound');
    expect(await admit('/api/tasks', 'GET', LOCAL)).toBeNull();
    expect(await admit('/api/hooks/s/t', 'POST', LOCAL)).toBeNull();
  });

  test('inside the channel reaches only the API, and never an extension’s sign-in callback', async () => {
    const extensions = {
      isCallback: (path: string) => path === '/api/mcp/oauth/callback',
    } as unknown as HttpContext['extensions'];
    const context = createGateContext({ extensions });
    const member = channelSource('u-member');
    expect(await admit('/tasks/SW-1', 'GET', member, context)).toBe('RouteNotFound');
    expect(await admit('/api/queue', 'GET', member, context)).toBeNull();
    expect(await admit('/api/mcp/oauth/callback', 'GET', member, context)).toBe('LocalOnly');
    expect(await admit('/api/mcp/oauth/callback', 'GET', channelSource('u-guest', GUEST), context)).toBe(
      'ScopeRefused'
    );
    expect(await admit('/api/queue', 'GET', member, createGateContext({ extensions: undefined }))).toBeNull();
  });
});

describe('an endpoint inside the channel', () => {
  const admit = (
    annotations: Context.Context<never>,
    source: RequestSourceShape,
    method = 'GET',
    context = createGateContext()
  ) =>
    runGate((gate) => gate.admitEndpoint(annotations, { method, pathname: '/api/x' }, source), context).then(
      refusalOf
    );

  test('asks nothing of a request from this machine', async () => {
    expect(await admit(annotate({ localOnly: true, ownerOnly: true }), LOCAL, 'POST')).toBeNull();
  });

  test('refuses a local-only route to the owner and to members', async () => {
    expect(await admit(annotate({ localOnly: true }), channelSource(OWNER_ID), 'POST')).toBe('LocalOnly');
    expect(await admit(annotate({ localOnly: true }), channelSource('u-member'))).toBe('LocalOnly');
  });

  test('lets only the machine’s owner through an owner-only route', async () => {
    const ownerOnly = annotate({ ownerOnly: true });
    expect(await admit(ownerOnly, channelSource(OWNER_ID), 'POST')).toBeNull();
    expect(await admit(ownerOnly, channelSource('u-member'), 'POST')).toBe('NotMachineOwner');
    expect(await admit(ownerOnly, channelSource(null), 'POST')).toBe('NotMachineOwner');
    const unknown = createGateContext({ remote: createRemote({ store: { file: { access: null } } }) });
    expect(await admit(ownerOnly, channelSource(OWNER_ID), 'POST', unknown)).toBe('NotMachineOwner');
  });

  test('refuses a guest every route but its own task’s and the ones any guest may read', async () => {
    expect(await admit(annotate({}), channelSource('u-guest', GUEST))).toBe('ScopeRefused');
    expect(await admit(annotate({ guest: 'any' }), channelSource('u-guest', GUEST))).toBeNull();
    expect(await admit(annotate({ guest: 'any', localOnly: true }), channelSource('u-guest', GUEST))).toBe(
      'LocalOnly'
    );
  });

  test('keeps writes read-only in inspect mode', async () => {
    const inspect = createGateContext({}, { inspect: true });
    expect(await admit(annotate({}), channelSource(OWNER_ID), 'POST', inspect)).toBe('InspectReadOnly');
    expect(await admit(annotate({}), channelSource(OWNER_ID), 'GET', inspect)).toBeNull();
  });
});

describe('a socket over the tunnel', () => {
  const shares = { acceptsShare: (id: string) => id === 's1' } as unknown as HttpContext['shares'];
  const teams = { acceptsViewer: () => true } as unknown as HttpContext['teams'];
  const previews = {} as HttpContext['previews'];
  const full = () => createGateContext({ shares, teams, previews });

  test('opens the channel from app.shinsa.dev with a good connect token, for that token’s user', async () => {
    expect(await upgrade(`/remote?token=${GOOD_TOKEN}`, { origin: APP }, full())).toEqual({
      route: 'channel',
      userId: 'u-member',
    });
    expect(await upgrade(`/remote?token=${GOOD_TOKEN}`, { origin: 'https://evil.dev' }, full())).toBe(
      'RequestForbidden'
    );
    expect(await upgrade(`/remote?token=${GOOD_TOKEN}`, {}, full())).toBe('RequestForbidden');
    expect(await upgrade('/remote?token=bad', { origin: APP }, full())).toBe('ConnectRefused');
    expect(await upgrade('/remote', { origin: APP }, full())).toBe('ConnectRefused');
  });

  test('opens a share link only from app.shinsa.dev and only for a link the machine shares', async () => {
    expect(await upgrade('/share?id=s1', { origin: APP }, full())).toEqual({ route: 'share', shareId: 's1' });
    expect(await upgrade('/share?id=s2', { origin: APP }, full())).toBe('RouteNotFound');
    expect(await upgrade('/share', { origin: APP }, full())).toBe('RouteNotFound');
    expect(await upgrade('/share?id=s1', { origin: 'https://evil.dev' }, full())).toBe('RequestForbidden');
    expect(await upgrade('/share?id=s1')).toBe('RouteNotFound');
  });

  test('opens a team view only for a machine in a team, from app.shinsa.dev, with a connect token', async () => {
    expect(await upgrade(`/team?token=${GOOD_TOKEN}`, { origin: APP }, full())).toEqual({
      route: 'team',
      userId: 'u-member',
    });
    expect(await upgrade('/team?token=bad', { origin: APP }, full())).toBe('ConnectRefused');
    expect(await upgrade(`/team?token=${GOOD_TOKEN}`, { origin: 'https://evil.dev' }, full())).toBe(
      'RequestForbidden'
    );
    const lonely = createGateContext({
      teams: { acceptsViewer: () => false } as unknown as HttpContext['teams'],
    });
    expect(await upgrade(`/team?token=${GOOD_TOKEN}`, { origin: APP }, lonely)).toBe('RouteNotFound');
    expect(await upgrade(`/team?token=${GOOD_TOKEN}`)).toBe('RouteNotFound');
  });

  test('sends a preview to the previews only when there are some, and plain routes to the handler', async () => {
    expect(await upgrade('/__preview/AAAAAAAAAAAAAA/', {}, full())).toEqual({ route: 'preview' });
    expect(await upgrade('/__preview/AAAAAAAAAAAAAA/', {})).toBe('RouteNotFound');
    expect(await upgrade('/health', {})).toEqual({ route: 'http' });
  });

  test('opens nothing outside the route table or while remote access is off', async () => {
    expect(await upgrade('/ws', { origin: APP }, full())).toBe('RouteNotFound');
    expect(await upgrade('/api/tasks', { origin: APP }, full())).toBe('RouteNotFound');
    const off = createGateContext({ remote: createRemote({ isEnabled: false }), shares, teams, previews });
    expect(await upgrade(`/remote?token=${GOOD_TOKEN}`, { origin: APP }, off)).toBe('RouteNotFound');
    expect(await upgrade('/health', {}, off)).toBe('RouteNotFound');
    const none = createGateContext({ remote: undefined });
    expect(await upgrade(`/remote?token=${GOOD_TOKEN}`, { origin: APP }, none)).toBe('RouteNotFound');
  });
});

describe('a guest’s reads inside the channel', () => {
  test('reads the task handed off and its code, never another task or the task list', async () => {
    expect(await canRead('/api/tasks/t1')).toBe(true);
    expect(await canRead('/api/tasks/t1/diff', 'HEAD')).toBe(true);
    expect(await canRead('/api/tasks/t1/chat')).toBe(true);
    expect(await canRead('/api/tasks/t2')).toBe(false);
    expect(await canRead('/api/tasks/t1/open')).toBe(false);
    expect(await canRead('/api/tasks')).toBe(false);
    expect(await canRead('/api/health')).toBe(true);
  });

  test('reads its evidence, its attachments and the images its own chat shows', async () => {
    expect(await canRead('/api/evidence/t1/round-1/shot.png')).toBe(true);
    expect(await canRead('/api/evidence/t1/round-2/later.md')).toBe(true);
    expect(await canRead('/api/evidence/legacy.png')).toBe(true);
    expect(await canRead('/api/attachments/a1/brief.png')).toBe(true);
    expect(await canRead('/api/attachments/a2/note.txt')).toBe(true);
    expect(await canRead('/api/evidence/tool1.png')).toBe(true);
    expect(await canRead('/api/attachments/a4/x.png')).toBe(true);
  });

  test('never reads another task’s file, even when its own text names the path', async () => {
    expect(await canRead('/api/evidence/t2/round-1/other.png')).toBe(false);
    expect(await canRead('/api/attachments/a3/secret.png')).toBe(false);
    expect(await canRead('/api/evidence/tool2.png')).toBe(false);
    expect(await canRead('/api/evidence/t1')).toBe(false);
  });

  test('writes nothing and reads nothing else', async () => {
    expect(await canRead('/api/commands', 'POST')).toBe(false);
    expect(await canRead('/api/attachments', 'POST')).toBe(false);
    expect(await canRead('/api/settings')).toBe(false);
  });
});
