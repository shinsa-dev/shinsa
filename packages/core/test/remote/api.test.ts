import { describe, expect, test } from 'bun:test';
import { Effect, Layer, Redacted, type Scope } from 'effect';
import { HttpClientRequest, HttpServer } from 'effect/http';
import { HttpApi, HttpApiBuilder, HttpApiMiddleware, HttpApiTest } from 'effect/http-api';
import { CurrentUser, MachineSession, PageSession, RemoteApi } from '../../src/remote/api.ts';
import { InstanceId, RemoteUserId } from '../../src/remote/contract.ts';
import {
  HandoffInvalid,
  InviteInvalid,
  NotFound,
  RateLimited,
  Revoked,
  SignedOut,
} from '../../src/remote/errors.ts';

const ROUTES = [
  'GET /__remote/session',
  'POST /__remote/sign-out',
  'POST /__remote/sign-in/token',
  'POST /__remote/pair/start',
  'POST /__remote/pair/poll',
  'GET /__remote/pairs/:claimCode',
  'POST /__remote/pairs/:claimCode/approve',
  'GET /__remote/instances',
  'POST /__remote/instances/:instanceId/connect',
  'POST /__remote/instances/:instanceId/remove',
  'POST /__remote/instances/:instanceId/leave',
  'POST /__remote/invites/accept',
  'POST /__remote/handoffs/accept',
  'POST /__remote/shares/:instanceId/connect',
  'GET /__remote/teams',
  'POST /__remote/teams/join',
  'POST /__remote/teams/preview',
  'POST /__remote/teams/:teamId/leave',
  'POST /__remote/teams/:teamId/connect',
  'POST /__remote/machine/heartbeat',
  'POST /__remote/machine/offline',
  'POST /__remote/machine/remove',
  'POST /__remote/machine/invites',
  'POST /__remote/machine/invites/remove',
  'POST /__remote/machine/requesters/find',
  'POST /__remote/machine/members/add',
  'POST /__remote/machine/members/remove',
  'POST /__remote/machine/handoffs',
  'POST /__remote/machine/handoffs/remove',
  'POST /__remote/machine/guests/add',
  'POST /__remote/machine/guests/remove',
  'POST /__remote/machine/teams',
  'POST /__remote/machine/teams/join',
  'POST /__remote/machine/teams/:teamId/invite',
  'POST /__remote/machine/teams/:teamId/invite/remove',
  'POST /__remote/machine/teams/:teamId/members/add',
  'POST /__remote/machine/teams/:teamId/members/remove',
  'POST /__remote/machine/teams/:teamId/requests/decline',
  'POST /__remote/machine/teams/:teamId/leave',
  'POST /__remote/machine/teams/:teamId/remove',
  'POST /__remote/machine/teams/:teamId/connect',
  'GET /__remote/slack/links',
  'POST /__remote/slack/unlink',
  'POST /__remote/slack/post',
  'POST /__remote/slack/session',
  'POST /__remote/slack/react',
];

function listRoutes() {
  const routes: string[] = [];
  HttpApi.reflect(RemoteApi, {
    onGroup: () => undefined,
    onEndpoint: ({ endpoint }) => routes.push(`${endpoint.method} ${endpoint.path}`),
  });
  return routes;
}

const KAI = { id: RemoteUserId.make('7'), login: 'kai', name: 'Kai Lane', avatarUrl: null };

const PairingHandlers = HttpApiBuilder.group(RemoteApi, 'pairing', (handlers) =>
  handlers
    .handle('start', ({ payload }) =>
      payload.name === 'busy'
        ? Effect.fail(new RateLimited({ message: 'Too many pairings are waiting.' }))
        : Effect.succeed({ claimCode: 'ABCD1234', pollSecret: 's', url: 'https://x/pair', expiresAt: 1 })
    )
    .handle('poll', () => Effect.succeed({ status: 'pending' as const }))
);

const InstancesHandlers = HttpApiBuilder.group(RemoteApi, 'instances', (handlers) =>
  handlers
    .handle('list', () =>
      Effect.gen(function* () {
        const owner = yield* CurrentUser;
        return [
          {
            id: 'laptop',
            name: 'Laptop',
            fingerprint: 'f',
            online: true,
            lastSeenAt: 1,
            createdAt: 1,
            owner,
            role: 'owner' as const,
          },
        ];
      })
    )
    .handle('connect', ({ params }) =>
      Effect.fail(new NotFound({ message: `No machine ${params.instanceId}.` }))
    )
    .handle('remove', () => Effect.succeed({ ok: true as const }))
    .handle('leave', () => Effect.succeed({ ok: true as const }))
    .handle('inviteAccept', () =>
      Effect.fail(new InviteInvalid({ message: 'This invite link was turned off.' }))
    )
    .handle('handoffAccept', () =>
      Effect.fail(new HandoffInvalid({ message: 'This hand-off link was taken back.' }))
    )
);

const PageSessionLayer = Layer.succeed(
  PageSession,
  PageSession.of({
    bearer: Effect.fn(function* (effect, { credential }) {
      if (Redacted.value(credential) !== 'session')
        return yield* new SignedOut({ message: 'Sign in with GitHub first.' });
      return yield* Effect.provideService(effect, CurrentUser, KAI);
    }),
    cookie: Effect.fn(function* () {
      return yield* new SignedOut({ message: 'Sign in with GitHub first.' });
    }),
  })
);

const MachineSessionLayer = Layer.succeed(
  MachineSession,
  MachineSession.of({
    bearer: Effect.fn(function* () {
      return yield* new Revoked({ message: 'This machine is not paired.' });
    }),
  })
);

const pageClient = (token: string) =>
  HttpApiMiddleware.layerClient(PageSession, ({ next, request }) =>
    next(HttpClientRequest.bearerToken(request, token))
  );

const machineClient = HttpApiMiddleware.layerClient(MachineSession, ({ next, request }) => next(request));

const Handlers = Layer.mergeAll(PairingHandlers, InstancesHandlers).pipe(
  Layer.provideMerge(Layer.mergeAll(PageSessionLayer, MachineSessionLayer))
);

const TestLayer = Layer.mergeAll(Handlers, HttpServer.layerServices, machineClient);

type TestServices = Layer.Success<typeof TestLayer> | HttpApiMiddleware.ForClient<PageSession> | Scope.Scope;

function run<A, E>(effect: Effect.Effect<A, E, TestServices>, token = 'session') {
  return Effect.runPromise(
    Effect.scoped(effect).pipe(Effect.provide(Layer.mergeAll(TestLayer, pageClient(token))))
  );
}

describe('the remote API', () => {
  test('declares exactly the routes the Worker answers', () => {
    expect(listRoutes().sort()).toEqual([...ROUTES].sort());
  });

  test('a typed client gets the answer and the typed failure through the wire', async () => {
    const result = await run(
      Effect.gen(function* () {
        const client = yield* HttpApiTest.groups(RemoteApi, ['pairing']);
        const started = yield* client.pairing.start({
          payload: { name: 'Laptop', publicKey: 'k', version: '1' },
        });
        const refused = yield* Effect.flip(
          client.pairing.start({ payload: { name: 'busy', publicKey: 'k', version: '1' } })
        );
        const polled = yield* client.pairing.poll({ payload: { claimCode: 'ABCD1234', pollSecret: 's' } });
        return { started, refused, polled };
      })
    );
    expect(result.started.claimCode).toBe('ABCD1234');
    expect(result.refused).toBeInstanceOf(RateLimited);
    expect(result.refused.message).toBe('Too many pairings are waiting.');
    expect(result.polled).toEqual({ status: 'pending' });
  });

  test('the page session provides the account to every handler behind it', async () => {
    const result = await run(
      Effect.gen(function* () {
        const client = yield* HttpApiTest.groups(RemoteApi, ['instances']);
        const list = yield* client.instances.list();
        const missing = yield* Effect.flip(
          client.instances.connect({ params: { instanceId: InstanceId.make('gone') } })
        );
        const removed = yield* client.instances.remove({ params: { instanceId: InstanceId.make('laptop') } });
        const left = yield* client.instances.leave({ params: { instanceId: InstanceId.make('laptop') } });
        const invite = yield* Effect.flip(client.instances.inviteAccept({ payload: { token: 't' } }));
        const handoff = yield* Effect.flip(client.instances.handoffAccept({ payload: { token: 't' } }));
        return { list, missing, removed, left, invite, handoff };
      })
    );
    expect(result.list[0]?.owner.login).toBe('kai');
    expect(result.missing).toBeInstanceOf(NotFound);
    expect(result.missing.message).toBe('No machine gone.');
    expect([result.removed, result.left]).toEqual([{ ok: true }, { ok: true }]);
    expect(result.invite).toBeInstanceOf(InviteInvalid);
    expect(result.handoff).toBeInstanceOf(HandoffInvalid);
  });

  test('a request without a session is signed out before any handler runs', async () => {
    const out = await run(
      Effect.gen(function* () {
        const client = yield* HttpApiTest.groups(RemoteApi, ['instances']);
        return yield* Effect.flip(client.instances.list());
      }),
      'stale'
    );
    expect(out).toBeInstanceOf(SignedOut);
  });
});
