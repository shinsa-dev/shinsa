import { describe, expect, test } from 'bun:test';
import {
  type ConnectResponse,
  type HeartbeatResponse,
  MAX_OWNED_TEAMS,
  MAX_TEAM_MEMBERS,
  type MachineCredentials,
  REMOTE_PATHS,
  type RemoteMember,
  type RemoteTeam,
  type RemoteUser,
  resolveMachineTeamPath,
  resolveTeamConnectPath,
  resolveTeamLeavePath,
  type TeamAction,
  type TeamCreateResponse,
  type TeamInviteResponse,
  type TeamJoinResponse,
  type TeamPreviewResponse,
  verifyConnectToken,
} from '@shinsa/core';
import { createHarness, type Harness, heartbeat, pairMachine, readJson } from './harness.ts';

const MONA: RemoteUser = { id: '1', login: 'mona', name: 'Mona Lisa', avatarUrl: null };

const KAI: RemoteUser = { id: '2', login: 'kai', name: null, avatarUrl: null };

function machineAuth(credentials: MachineCredentials) {
  return { bearer: credentials.machineToken, sameOrigin: false };
}

function act(
  harness: Harness,
  credentials: MachineCredentials,
  teamId: string,
  action: TeamAction,
  body = {}
) {
  return harness.post(resolveMachineTeamPath(teamId, action), body, machineAuth(credentials));
}

function createTeam(harness: Harness, credentials: MachineCredentials, name = 'Payments') {
  return harness.post(REMOTE_PATHS.machineTeams, { name }, machineAuth(credentials));
}

function joinTeam(harness: Harness, session: string, invite: string) {
  return harness.post(REMOTE_PATHS.teamJoin, { invite }, { session });
}

async function listTeams(harness: Harness, session: string) {
  return readJson<RemoteTeam[]>(await harness.call(REMOTE_PATHS.teams, { session }));
}

async function readCode(response: Response) {
  return (await readJson<{ error: { code: string } }>(response)).error.code;
}

async function startTeam() {
  const harness = createHarness();
  const mona = await harness.signIn('mona', 1, 'Mona Lisa');
  const kai = await harness.signIn('kai', 2);
  const studio = await pairMachine(harness, mona);
  const laptop = await pairMachine(harness, kai, 'Laptop');
  const created = await readJson<TeamCreateResponse>(await createTeam(harness, studio));
  return { harness, mona, kai, studio, laptop, team: created.team, invite: created.invite };
}

async function joinedTeam() {
  const started = await startTeam();
  await joinTeam(started.harness, started.kai, started.invite);
  await act(started.harness, started.studio, started.team.id, 'members/add', { userId: KAI.id });
  return started;
}

describe('creating a team', () => {
  test('the machine makes a team its owner owns, with a reusable invite kept only as a hash', async () => {
    const { harness, studio, team, invite } = await startTeam();
    expect(team).toMatchObject({ name: 'Payments', owner: MONA, role: 'owner', members: [], requests: [] });
    expect(team.machines.map((machine) => machine.id)).toEqual([studio.instanceId]);
    const stored = harness.db.sqlite.query('SELECT token_hash FROM team_invites').all() as {
      token_hash: string;
    }[];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.token_hash).not.toBe(invite);
  });

  test('a team needs a name and an owner may own only so many', async () => {
    const { harness, studio } = await startTeam();
    const blank = await createTeam(harness, studio, '   ');
    expect(blank.status).toBe(400);
    expect(await readCode(blank)).toBe('body_invalid');
    for (let count = 1; count < MAX_OWNED_TEAMS; count++) await createTeam(harness, studio, `Team ${count}`);
    const full = await createTeam(harness, studio);
    expect(full.status).toBe(409);
    expect(await readCode(full)).toBe('teams_full');
  });

  test('only a paired machine makes a team', async () => {
    const harness = createHarness();
    const refused = await harness.post(REMOTE_PATHS.machineTeams, { name: 'X' }, { bearer: 'nope' });
    expect(refused.status).toBe(401);
  });
});

describe('joining a team', () => {
  test('opens a join page that search engines are told not to keep', async () => {
    const page = await createHarness().call(REMOTE_PATHS.teamJoinPage);
    expect(page.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
  });

  test('opening the link asks to join, and the owner sees the request', async () => {
    const { harness, mona, kai, studio, team, invite } = await startTeam();
    const answer = await readJson<TeamJoinResponse>(await joinTeam(harness, kai, invite));
    expect(answer).toEqual({ teamId: team.id, name: 'Payments', owner: MONA, status: 'requested' });
    expect(await listTeams(harness, kai)).toEqual([]);
    const [owned] = await listTeams(harness, mona);
    expect(owned?.requests.map((request) => request.user)).toEqual([KAI]);
    const beat = await readJson<HeartbeatResponse>(await heartbeat(harness, studio));
    expect(beat.teams[0]?.requests.map((request) => request.user.id)).toEqual([KAI.id]);
  });

  test('the link names its team and owner before anyone asks, and records no request', async () => {
    const { harness, mona, kai, invite } = await startTeam();
    const preview = await harness.post(REMOTE_PATHS.teamPreview, { invite }, { session: kai });
    expect(await readJson<TeamPreviewResponse>(preview)).toEqual({ name: 'Payments', owner: MONA });
    expect((await listTeams(harness, mona))[0]?.requests).toEqual([]);
    const stale = await harness.post(REMOTE_PATHS.teamPreview, { invite: 'nope' }, { session: kai });
    expect(await readCode(stale)).toBe('invite_invalid');
    expect((await harness.post(REMOTE_PATHS.teamPreview, { invite })).status).toBe(401);
  });

  test('a machine can ask to join for its owner', async () => {
    const { harness, mona, laptop, invite } = await startTeam();
    const answer = await harness.post(REMOTE_PATHS.machineTeamJoin, { invite }, machineAuth(laptop));
    expect((await readJson<TeamJoinResponse>(answer)).status).toBe('requested');
    expect((await listTeams(harness, mona))[0]?.requests.map((request) => request.user)).toEqual([KAI]);
  });

  test('the owner opening the link is already in the team', async () => {
    const { harness, mona, invite } = await startTeam();
    const answer = await readJson<TeamJoinResponse>(await joinTeam(harness, mona, invite));
    expect(answer.status).toBe('member');
    expect((await listTeams(harness, mona))[0]?.requests).toEqual([]);
  });

  test('a link turned off or replaced no longer works', async () => {
    const { harness, kai, studio, team, invite } = await startTeam();
    const next = await readJson<TeamInviteResponse>(await act(harness, studio, team.id, 'invite'));
    const stale = await joinTeam(harness, kai, invite);
    expect(stale.status).toBe(404);
    expect(await readCode(stale)).toBe('invite_invalid');
    expect((await joinTeam(harness, kai, next.invite)).status).toBe(200);
    await act(harness, studio, team.id, 'invite/remove');
    expect((await joinTeam(harness, kai, next.invite)).status).toBe(404);
  });

  test('a page asking to join must come from app.shinsa.dev', async () => {
    const { harness, kai, invite } = await startTeam();
    const forged = await harness.post(REMOTE_PATHS.teamJoin, { invite }, { session: kai, sameOrigin: false });
    expect(forged.status).toBe(403);
  });
});

describe('the owner and the members', () => {
  test('accepting a request makes a member who sees the team and its machines', async () => {
    const { harness, kai, studio, laptop, team, invite } = await startTeam();
    expect((await act(harness, studio, team.id, 'members/add', { userId: KAI.id })).status).toBe(404);
    await joinTeam(harness, kai, invite);
    const member = await readJson<RemoteMember>(
      await act(harness, studio, team.id, 'members/add', { userId: KAI.id })
    );
    expect(member.user).toEqual(KAI);
    const [seen] = await listTeams(harness, kai);
    expect(seen).toMatchObject({ id: team.id, role: 'member', owner: MONA, requests: [] });
    expect(seen?.members.map((entry) => entry.user)).toEqual([KAI]);
    expect(seen?.machines.map((machine) => machine.id).sort()).toEqual(
      [studio.instanceId, laptop.instanceId].sort()
    );
    expect((await act(harness, studio, team.id, 'members/add', { userId: KAI.id })).status).toBe(200);
    expect((await listTeams(harness, kai))[0]?.members).toHaveLength(1);
  });

  test('a team holds at most so many members', async () => {
    const { harness, studio, team, invite } = await startTeam();
    for (let index = 0; index <= MAX_TEAM_MEMBERS; index++) {
      const session = await harness.signIn(`user${index}`, 100 + index);
      await joinTeam(harness, session, invite);
    }
    for (let index = 0; index < MAX_TEAM_MEMBERS; index++)
      await act(harness, studio, team.id, 'members/add', { userId: String(100 + index) });
    const full = await act(harness, studio, team.id, 'members/add', {
      userId: String(100 + MAX_TEAM_MEMBERS),
    });
    expect(full.status).toBe(409);
    expect(await readCode(full)).toBe('members_full');
  });

  test('declining a request drops it, so it can no longer be accepted', async () => {
    const { harness, mona, kai, studio, team, invite } = await startTeam();
    await joinTeam(harness, kai, invite);
    await act(harness, studio, team.id, 'requests/decline', { userId: KAI.id });
    expect((await listTeams(harness, mona))[0]?.requests).toEqual([]);
    expect((await act(harness, studio, team.id, 'members/add', { userId: KAI.id })).status).toBe(404);
  });

  test('only the owner manages the team, and a stranger cannot see it', async () => {
    const { harness, laptop, team } = await joinedTeam();
    for (const action of [
      'invite',
      'invite/remove',
      'members/remove',
      'requests/decline',
      'remove',
    ] as const) {
      const refused = await act(harness, laptop, team.id, action, { userId: MONA.id });
      expect(refused.status).toBe(403);
      expect(await readCode(refused)).toBe('not_owner');
    }
    const stranger = await pairMachine(harness, await harness.signIn('lee', 3), 'Lee');
    expect((await act(harness, stranger, team.id, 'leave')).status).toBe(404);
    expect((await act(harness, laptop, 'missing', 'leave')).status).toBe(404);
  });

  test('a removed member loses the team at once', async () => {
    const { harness, kai, studio, team } = await joinedTeam();
    await act(harness, studio, team.id, 'members/remove', { userId: KAI.id });
    expect(await listTeams(harness, kai)).toEqual([]);
    const refused = await harness.post(
      resolveTeamConnectPath(team.id),
      { instanceId: studio.instanceId },
      {
        session: kai,
      }
    );
    expect(refused.status).toBe(404);
  });

  test('a member leaves from a page or a machine, and the owner cannot leave', async () => {
    const { harness, mona, kai, studio, laptop, team, invite } = await joinedTeam();
    expect((await harness.post(resolveTeamLeavePath(team.id), {}, { session: kai })).status).toBe(200);
    expect(await listTeams(harness, kai)).toEqual([]);
    await joinTeam(harness, kai, invite);
    await act(harness, studio, team.id, 'members/add', { userId: KAI.id });
    expect((await act(harness, laptop, team.id, 'leave')).status).toBe(200);
    expect(await listTeams(harness, kai)).toEqual([]);
    const owner = await harness.post(resolveTeamLeavePath(team.id), {}, { session: mona });
    expect(owner.status).toBe(409);
    expect(await readCode(owner)).toBe('owner_cannot_leave');
  });

  test('removing the team ends it for everyone', async () => {
    const { harness, mona, kai, studio, team } = await joinedTeam();
    expect((await act(harness, studio, team.id, 'remove')).status).toBe(200);
    expect(await listTeams(harness, mona)).toEqual([]);
    expect(await listTeams(harness, kai)).toEqual([]);
  });

  test('listing teams needs a session', async () => {
    const harness = createHarness();
    expect((await harness.call(REMOTE_PATHS.teams)).status).toBe(401);
  });
});

describe('team connect tokens', () => {
  test('a member gets a token for a teammate’s machine, for the team channel', async () => {
    const { harness, kai, studio, team } = await joinedTeam();
    const answer = await readJson<ConnectResponse>(
      await harness.post(resolveTeamConnectPath(team.id), { instanceId: studio.instanceId }, { session: kai })
    );
    const url = new URL(answer.url);
    expect(url.host).toBe(`t-${studio.instanceId}.shinsa.dev`);
    expect(url.pathname).toBe('/team');
    const token = url.searchParams.get('token') ?? '';
    const claim = await verifyConnectToken(studio.connectKey, token, studio.instanceId, harness.clock.now);
    expect(claim?.userId).toBe(KAI.id);
  });

  test('a machine gets a token for its owner, as the local app watches through it', async () => {
    const { harness, studio, laptop, team } = await joinedTeam();
    const answer = await readJson<ConnectResponse>(
      await act(harness, laptop, team.id, 'connect', { instanceId: studio.instanceId })
    );
    const token = new URL(answer.url).searchParams.get('token') ?? '';
    const claim = await verifyConnectToken(studio.connectKey, token, studio.instanceId, harness.clock.now);
    expect(claim?.userId).toBe(KAI.id);
  });

  test('no token for a machine outside the team', async () => {
    const { harness, kai, team } = await joinedTeam();
    const outside = await pairMachine(harness, await harness.signIn('lee', 3), 'Lee');
    const refused = await harness.post(
      resolveTeamConnectPath(team.id),
      { instanceId: outside.instanceId },
      {
        session: kai,
      }
    );
    expect(refused.status).toBe(404);
    expect(await readCode(refused)).toBe('not_found');
  });
});

describe('machine access for a teammate', () => {
  test('a machine adds a teammate of its owner as a member without the teammate asking first', async () => {
    const { harness, studio } = await joinedTeam();
    const found = await harness.post(REMOTE_PATHS.machineRequester, { userId: KAI.id }, machineAuth(studio));
    expect(await readJson<RemoteUser>(found)).toEqual(KAI);
    const added = await harness.post(REMOTE_PATHS.machineMemberAdd, { userId: KAI.id }, machineAuth(studio));
    expect(await readJson<RemoteMember>(added)).toMatchObject({ user: KAI });
  });

  test('someone who only asked to join a team is no teammate, so the machine cannot add them', async () => {
    const { harness, kai, studio, invite } = await startTeam();
    await joinTeam(harness, kai, invite);
    const refused = await harness.post(
      REMOTE_PATHS.machineMemberAdd,
      { userId: KAI.id },
      machineAuth(studio)
    );
    expect(refused.status).toBe(404);
    expect(await readCode(refused)).toBe('not_found');
  });
});
