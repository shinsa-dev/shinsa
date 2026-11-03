import { describe, expect, test } from 'bun:test';
import {
  type InviteCreateResponse,
  type MachineCredentials,
  REMOTE_APP_ORIGIN,
  REMOTE_PATHS,
  resolveInstanceConnectPath,
  resolveInstanceLeavePath,
  resolveInstanceRemovePath,
  resolveMachineTeamPath,
  resolveTeamConnectPath,
  resolveTeamLeavePath,
  type TeamCreateResponse,
} from '@shinsa/core';
import { MachineSession, PageSession, RemoteApi } from '@shinsa/core/remote/api';
import { HttpApi } from 'effect/http-api';
import { createHarness, type Harness, pairMachine, readJson } from './harness.ts';

type Gate = 'page' | 'machine' | 'open';

interface Route {
  readonly name: string;
  readonly method: string;
  readonly path: string;
  readonly gate: Gate;
}

const OPEN_ROUTES = [
  'session.read',
  'session.signOut',
  'session.signInToken',
  'pairing.start',
  'pairing.poll',
  'shares.connect',
];

function listRoutes() {
  const routes: Route[] = [];
  HttpApi.reflect(RemoteApi, {
    onGroup: () => undefined,
    onEndpoint: ({ group, endpoint, middleware }) => {
      const keys = new Set([...middleware].map((service) => service.key));
      const gate: Gate = keys.has(PageSession.key)
        ? 'page'
        : keys.has(MachineSession.key)
          ? 'machine'
          : 'open';
      routes.push({
        name: `${group.identifier}.${endpoint.identifier}`,
        method: endpoint.method,
        path: endpoint.path,
        gate,
      });
    },
  });
  return routes;
}

const ROUTES = listRoutes();

function machineAuth(credentials: MachineCredentials) {
  return { bearer: credentials.machineToken, sameOrigin: false };
}

async function readCode(response: Response) {
  return (await readJson<{ error: { code: string } }>(response)).error.code;
}

async function createWorld() {
  const harness = createHarness();
  const mona = await harness.signIn('mona', 1);
  const kai = await harness.signIn('kai', 2);
  const gus = await harness.signIn('gus', 3);
  const tess = await harness.signIn('tess', 4);
  const eve = await harness.signIn('eve', 5);
  const studio = await pairMachine(harness, mona);
  const invite = await readJson<InviteCreateResponse>(
    await harness.post(REMOTE_PATHS.machineInvites, {}, machineAuth(studio))
  );
  await harness.post(REMOTE_PATHS.inviteAccept, { token: invite.token }, { session: kai });
  await harness.post(REMOTE_PATHS.machineMemberAdd, { userId: '2' }, machineAuth(studio));
  const handoff = await readJson<InviteCreateResponse>(
    await harness.post(REMOTE_PATHS.machineHandoffs, {}, machineAuth(studio))
  );
  await harness.post(REMOTE_PATHS.handoffAccept, { token: handoff.token }, { session: gus });
  await harness.post(REMOTE_PATHS.machineGuestAdd, { userId: '3' }, machineAuth(studio));
  const created = await readJson<TeamCreateResponse>(
    await harness.post(REMOTE_PATHS.machineTeams, { name: 'Payments' }, machineAuth(studio))
  );
  await harness.post(REMOTE_PATHS.teamJoin, { invite: created.invite }, { session: tess });
  await harness.post(
    resolveMachineTeamPath(created.team.id, 'members/add'),
    { userId: '4' },
    machineAuth(studio)
  );
  return { harness, mona, kai, gus, tess, eve, studio, teamId: created.team.id };
}

type World = Awaited<ReturnType<typeof createWorld>>;

function resolvePath(route: Route, world: World) {
  return route.path
    .replace(':instanceId', world.studio.instanceId)
    .replace(':teamId', world.teamId)
    .replace(':claimCode', 'ABCD2345');
}

function send(harness: Harness, route: Route, path: string, init: RequestInit & { session?: string } = {}) {
  const headers = new Headers(init.headers);
  if (route.method !== 'GET') headers.set('content-type', 'application/json');
  return harness.call(path, {
    ...init,
    method: route.method,
    headers,
    ...(route.method === 'GET' ? {} : { body: '{}' }),
  });
}

describe('the Worker gates every route by who asks', () => {
  test('only the routes meant for anyone are open, so a new route needs a sign-in unless it is named here', () => {
    expect(ROUTES.filter((route) => route.gate === 'open').map((route) => route.name)).toEqual(OPEN_ROUTES);
  });

  test('every signed-in route refuses a request with no session, a machine token or a cookie from another site', async () => {
    const world = await createWorld();
    for (const route of ROUTES.filter((entry) => entry.gate === 'page')) {
      const path = resolvePath(route, world);
      const anonymous = await send(world.harness, route, path, { headers: { origin: REMOTE_APP_ORIGIN } });
      expect([route.name, anonymous.status]).toEqual([route.name, 401]);
      const machine = await send(world.harness, route, path, {
        headers: { authorization: `Bearer ${world.studio.machineToken}`, origin: REMOTE_APP_ORIGIN },
      });
      expect([route.name, machine.status]).toEqual([route.name, 401]);
      if (route.method === 'GET') continue;
      const crossSite = await send(world.harness, route, path, {
        session: world.mona,
        headers: { origin: 'https://evil.example' },
      });
      expect([route.name, crossSite.status, await readCode(crossSite)]).toEqual([
        route.name,
        403,
        'forbidden',
      ]);
    }
  });

  test('every machine route refuses a request with no token, a page session or a cookie', async () => {
    const world = await createWorld();
    for (const route of ROUTES.filter((entry) => entry.gate === 'machine')) {
      const path = resolvePath(route, world);
      const attempts: (RequestInit & { session?: string })[] = [
        {},
        { headers: { authorization: `Bearer ${world.mona}` } },
        { session: world.mona, headers: { origin: REMOTE_APP_ORIGIN } },
      ];
      for (const init of attempts) {
        const refused = await send(world.harness, route, path, init);
        expect([route.name, refused.status]).toEqual([route.name, 401]);
      }
    }
  });

  test('a machine’s routes answer its owner, its members, its guests and its owner’s teammates by role, and nobody else', async () => {
    const world = await createWorld();
    const { harness, studio } = world;
    const post = (path: string, session: string) => harness.post(path, {}, { session });
    const connect = resolveInstanceConnectPath(studio.instanceId);
    for (const session of [world.mona, world.kai, world.gus, world.tess])
      expect((await post(connect, session)).status).toBe(200);
    const refused = await post(connect, world.eve);
    expect([refused.status, await readCode(refused)]).toEqual([404, 'not_found']);
    const remove = resolveInstanceRemovePath(studio.instanceId);
    for (const session of [world.kai, world.gus]) {
      const refused = await post(remove, session);
      expect([refused.status, await readCode(refused)]).toEqual([403, 'not_owner']);
    }
    for (const session of [world.tess, world.eve]) expect((await post(remove, session)).status).toBe(404);
    const leave = resolveInstanceLeavePath(studio.instanceId);
    expect((await post(leave, world.eve)).status).toBe(404);
    expect(await readCode(await post(leave, world.mona))).toBe('owner_cannot_leave');
  });

  test('a team’s routes answer its owner and its members, and nobody else', async () => {
    const world = await createWorld();
    const { harness, teamId } = world;
    const connect = resolveTeamConnectPath(teamId);
    const body = { instanceId: world.studio.instanceId };
    for (const session of [world.mona, world.tess])
      expect((await harness.post(connect, body, { session })).status).toBe(200);
    for (const session of [world.kai, world.gus, world.eve]) {
      const refused = await harness.post(connect, body, { session });
      expect([refused.status, await readCode(refused)]).toEqual([404, 'not_found']);
      expect((await harness.post(resolveTeamLeavePath(teamId), {}, { session })).status).toBe(404);
    }
  });

  test('a body is measured in bytes, so wide characters cannot carry more than the limit', async () => {
    const harness = createHarness();
    const wide = await harness.post(REMOTE_PATHS.pairStart, {
      name: 'é'.repeat(9000),
      publicKey: '',
      version: '1',
    });
    expect([wide.status, await readCode(wide)]).toEqual([413, 'body_too_large']);
    const declared = await harness.call(REMOTE_PATHS.pairStart, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(64 * 1024) },
      body: '{}',
    });
    expect(declared.status).toBe(413);
  });

  test('a machine token reaches only its own machine’s teams', async () => {
    const world = await createWorld();
    const laptop = await pairMachine(world.harness, world.eve, 'Laptop');
    const refused = await world.harness.post(
      resolveMachineTeamPath(world.teamId, 'connect'),
      { instanceId: world.studio.instanceId },
      machineAuth(laptop)
    );
    expect([refused.status, await readCode(refused)]).toEqual([404, 'not_found']);
  });
});
