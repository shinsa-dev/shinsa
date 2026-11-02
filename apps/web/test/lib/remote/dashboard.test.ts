import { describe, expect, it } from 'bun:test';
import {
  createDashboardClient,
  describeSignInError,
  isMachineGone,
  resolveSignInUrl,
} from '@/lib/remote/dashboard.ts';
import { CloudRefused } from '@/lib/runtime/remote/schema.ts';
import { answerFetch } from '../../support/fetch-fake.ts';

const USER = { id: '7', login: 'kai', name: null, avatarUrl: null };

const INSTANCE = {
  id: 'k3x9',
  name: 'Studio',
  fingerprint: 'abcd',
  online: true,
  lastSeenAt: 1,
  createdAt: 0,
  owner: USER,
  role: 'owner',
};

const CONNECT = { url: 'wss://t-k3x9.shinsa.dev/remote', expiresAt: 0 };

const ACCEPTED = { instanceId: 'k3x9', name: 'Studio', owner: USER, user: USER, connect: CONNECT };

const TEAM_PREVIEW = { name: 'Design', owner: USER };

const PAIR = { claimCode: 'K7PQ', name: 'Studio', fingerprint: 'abcd', expiresAt: 9, claimed: false };

const ANSWERS: Record<string, unknown> = {
  'GET /__remote/session': { user: USER },
  'GET /__remote/instances': [INSTANCE],
  'POST /__remote/instances/k3x9/connect': CONNECT,
  'POST /__remote/instances/k3x9/remove': { ok: true },
  'POST /__remote/instances/k3x9/leave': { ok: true },
  'POST /__remote/invites/accept': ACCEPTED,
  'POST /__remote/handoffs/accept': ACCEPTED,
  'GET /__remote/teams': [],
  'POST /__remote/teams/join': { teamId: 't1', name: 'Design', owner: USER, status: 'requested' },
  'POST /__remote/teams/preview': TEAM_PREVIEW,
  'GET /__remote/pairs/K7PQ': PAIR,
  'POST /__remote/pairs/K7PQ/approve': { instanceId: 'k3x9', name: 'Studio' },
  'POST /__remote/sign-out': { ok: true },
};

describe('the dashboard client', () => {
  it('calls each route of app.shinsa.dev with the right method and body', async () => {
    const requests = answerFetch(({ method, path }) => Response.json(ANSWERS[`${method} ${path}`] ?? null));
    const client = createDashboardClient();
    await client.readSession();
    await client.listInstances();
    await client.requestConnect('k3x9');
    await client.removeInstance('k3x9');
    await client.leaveInstance('k3x9');
    await client.acceptInvite('invite-1');
    await client.acceptHandoff('handoff-1');
    await client.listTeams();
    await client.joinTeam('team-invite');
    await client.previewTeam('team-invite');
    await client.readPair('K7PQ');
    await client.approvePair('K7PQ');
    await client.signOut();
    expect(requests.map(({ method, path, body }) => ({ path, method, body }))).toEqual([
      { path: '/__remote/session', method: 'GET', body: null },
      { path: '/__remote/instances', method: 'GET', body: null },
      { path: '/__remote/instances/k3x9/connect', method: 'POST', body: null },
      { path: '/__remote/instances/k3x9/remove', method: 'POST', body: null },
      { path: '/__remote/instances/k3x9/leave', method: 'POST', body: null },
      { path: '/__remote/invites/accept', method: 'POST', body: { token: 'invite-1' } },
      { path: '/__remote/handoffs/accept', method: 'POST', body: { token: 'handoff-1' } },
      { path: '/__remote/teams', method: 'GET', body: null },
      { path: '/__remote/teams/join', method: 'POST', body: { invite: 'team-invite' } },
      { path: '/__remote/teams/preview', method: 'POST', body: { invite: 'team-invite' } },
      { path: '/__remote/pairs/K7PQ', method: 'GET', body: null },
      { path: '/__remote/pairs/K7PQ/approve', method: 'POST', body: null },
      { path: '/__remote/sign-out', method: 'POST', body: null },
    ]);
  });

  it('turns a refusal into an error with its code and message', async () => {
    answerFetch(() =>
      Response.json(
        { error: { code: 'pair_expired', message: 'This pairing code expired.' } },
        { status: 404 }
      )
    );
    const error = await createDashboardClient()
      .readPair('K7PQ')
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CloudRefused);
    expect(error).toMatchObject({ code: 'pair_expired', message: 'This pairing code expired.', status: 404 });
  });

  it('says what happened when the answer is not one of its errors, or nothing answered', async () => {
    answerFetch(() => Response.json({ error: { code: 1 } }, { status: 500 }));
    await expect(createDashboardClient().listInstances()).rejects.toMatchObject({
      code: 'failed',
      message: 'Shinsa Cloud answered 500.',
    });
    answerFetch(() => new Response('<html>', { status: 502 }));
    await expect(createDashboardClient().listInstances()).rejects.toMatchObject({
      code: 'failed',
      status: 502,
    });
    answerFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(createDashboardClient().listInstances()).rejects.toMatchObject({
      _tag: 'CloudUnreachable',
      message: 'Couldn’t reach Shinsa Cloud.',
    });
  });

  it('answers not found for an id no route could name, without asking Shinsa Cloud', async () => {
    const requests = answerFetch(() => Response.json({ ok: true }));
    const client = createDashboardClient();
    const gone = await client.requestConnect('not/an id').catch((caught: unknown) => caught);
    expect(isMachineGone(gone)).toBe(true);
    await expect(client.readPair('')).rejects.toMatchObject({ status: 404, code: 'not_found' });
    expect(requests).toEqual([]);
  });

  it('tells a machine Shinsa Cloud no longer knows from every other failure', () => {
    expect(isMachineGone(new CloudRefused({ status: 404, code: 'not_found', message: 'Gone.' }))).toBe(true);
    expect(isMachineGone(new CloudRefused({ status: 403, code: 'forbidden', message: 'No.' }))).toBe(false);
    expect(isMachineGone(new Error('Offline.'))).toBe(false);
  });

  it('builds the sign-in link back to where you were, and says why a sign-in failed', () => {
    expect(decodeURIComponent(resolveSignInUrl('/pair?code=K7PQ'))).toBe(
      '/__remote/sign-in?return=/pair?code=K7PQ'
    );
    expect(describeSignInError('sign_in_failed')).toBe('GitHub did not finish the sign-in. Try again.');
    expect(describeSignInError('other')).toBe('Signing in did not work. Try again.');
  });
});
