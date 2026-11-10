import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type MachineCredentials,
  REMOTE_PATHS,
  SLACK_DECIDE_ACTION,
  SLACK_ENGINE_MESSAGES_PATH,
  SLACK_FORWARD_HEADERS,
  SLACK_GATE_BLOCK,
  SLACK_MODAL_CALLBACK,
  SLACK_RELAY_PATHS,
  SLACK_RESPONSE_INPUT,
  SLACK_VIEW_LIMITS,
  SLACK_WRITE_ACTION,
  type SlackChannelMessage,
  type SlackChannels,
  type SlackLinks,
  type SlackMention,
  serializeSlackDecisionModal,
  serializeSlackDecisionValue,
  verifySlackForwardSignature,
  type RemoteUserId,
} from '@shinsa/core';
import { Effect } from 'effect';
import { SLACK_BOT_SCOPES } from '../src/integrations/slack/schema.ts';
import { SLACK_DECISION_REFUSALS } from '../src/routes/slack-events/schema.ts';
import { SLACK_USER_SCOPES } from '../src/routes/slack-link/schema.ts';
import { SLACK_EVENT_BODY_LIMIT_BYTES } from '../src/slack/schema.ts';
import {
  createHarness,
  createSlackSignature,
  type Harness,
  pairMachine,
  readJson,
  TEST_CONFIG,
} from './harness.ts';

type Fields = Record<string, unknown>;

interface SlackCall {
  method: string;
  body: Fields;
  token: string | null;
}

interface FakeSlack {
  calls: SlackCall[];
  answers: Record<string, (body: Fields) => Fields>;
  callsTo: (method: string) => SlackCall[];
}

const NAMES: Record<string, string> = { U1: 'Christo', U2: 'Mia' };

function createFakeSlack(harness: Harness): FakeSlack {
  const calls: SlackCall[] = [];
  let posted = 0;
  const answers: Record<string, (body: Fields) => Fields> = {
    'oauth.v2.access': (body) =>
      body.code === 'connect'
        ? {
            ok: true,
            team: { id: 'T1', name: 'Acme' },
            authed_user: { id: 'U1', access_token: 'xoxp-user-1' },
          }
        : {
            ok: true,
            access_token: 'xoxb-bot-token',
            bot_user_id: 'B0T',
            team: { id: 'T1', name: 'Acme' },
            authed_user: { id: 'U1', access_token: 'xoxp-user-1' },
          },
    'auth.revoke': () => ({ ok: true, revoked: true }),
    'users.info': (body) => {
      if (body.user === 'U5') return { ok: true, user: { name: 'sam', profile: { real_name: 'Sam Real' } } };
      if (body.user === 'U6') return { ok: true, user: { name: 'kit', profile: {} } };
      const name = NAMES[String(body.user)];
      return name
        ? { ok: true, user: { name: 'x', profile: { display_name: name } } }
        : { ok: false, error: 'user_not_found' };
    },
    'conversations.replies': () => ({ ok: true, messages: [] }),
    'users.conversations': (body) =>
      body.types === 'private_channel'
        ? { ok: true, channels: [{ id: 'G3', name: 'ops', is_private: true }] }
        : {
            ok: true,
            channels: [
              { id: 'C1', name: 'alerts', is_private: false },
              { id: 'C2', name: 'feedback' },
              { id: 'G3', name: 'ops', is_private: true },
              { id: 'G4', name: 'leadership', is_private: true },
            ],
          },
    'chat.getPermalink': (body) => ({
      ok: true,
      permalink: `https://acme.slack.com/archives/C1/p${body.message_ts}`,
    }),
    'conversations.info': (body) => ({ ok: true, channel: { id: body.channel, name: 'support' } }),
    'chat.postMessage': () => ({ ok: true, ts: `300.${++posted}` }),
    'chat.update': () => ({ ok: true }),
    'chat.postEphemeral': () => ({ ok: true, message_ts: '300.0' }),
    'chat.startStream': () => ({ ok: true, ts: `400.${++posted}` }),
    'chat.appendStream': () => ({ ok: true }),
    'chat.stopStream': () => ({ ok: true }),
    'agents.sessions.setStatus': () => ({ ok: true, status: 'processing' }),
    'reactions.add': () => ({ ok: true }),
    'reactions.remove': () => ({ ok: true }),
  };
  harness.handlers.push((call) => {
    if (!call.url.startsWith('https://slack.com/api/')) return new Response('', { status: 599 });
    const method = call.url.slice('https://slack.com/api/'.length);
    const json = (call.headers.get('content-type') ?? '').startsWith('application/json');
    const body = json
      ? (JSON.parse(call.body) as Fields)
      : Object.fromEntries(new URLSearchParams(call.body));
    const token = (call.headers.get('authorization') ?? '').replace('Bearer ', '') || null;
    calls.push({ method, body, token });
    const answer = answers[method];
    const { headers, ...fields } = (
      answer ? answer(body) : { ok: false, error: 'unknown_method' }
    ) as Fields & {
      headers?: Record<string, string>;
    };
    return Response.json(fields, { headers });
  });
  return { calls, answers, callsTo: (method) => calls.filter((call) => call.method === method) };
}

function answerConnectAs(slack: FakeSlack, userId: string, token: string) {
  const install = slack.answers['oauth.v2.access'];
  slack.answers['oauth.v2.access'] = (body) =>
    body.code === 'connect'
      ? { ok: true, team: { id: 'T1', name: 'Acme' }, authed_user: { id: userId, access_token: token } }
      : (install?.(body) ?? {});
}

function sealedUserTokens(harness: Harness) {
  return harness.db.sqlite
    .query('SELECT slack_user_id, sealed_user_token FROM slack_links ORDER BY slack_user_id')
    .all() as { slack_user_id: string; sealed_user_token: string | null }[];
}

async function bringOnline(harness: Harness, machine: MachineCredentials, features: string[] = []) {
  await harness.post(
    REMOTE_PATHS.heartbeat,
    { localUrl: 'http://127.0.0.1:7446', features },
    { bearer: machine.machineToken }
  );
}

function readSetCookie(response: Response, name: string) {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`)) ?? '';
  return cookie.split(';')[0] ?? '';
}

function readLocation(response: Response) {
  return new URL(response.headers.get('location') ?? '', TEST_CONFIG.origin);
}

async function followAuthorize(
  harness: Harness,
  session: string,
  response: Response,
  callback: string,
  code: string
) {
  const authorize = readLocation(response);
  const slackCookie = readSetCookie(response, '__Host-shinsa_slack');
  return harness.call(`${callback}?code=${code}&state=${authorize.searchParams.get('state')}`, {
    headers: { cookie: `__Host-shinsa_session=${session}; ${slackCookie}` },
  });
}

async function connectSlack(harness: Harness, session: string, instanceId: string) {
  const start = await harness.call(`${SLACK_RELAY_PATHS.connect}?instance=${instanceId}`, { session });
  const identified = await followAuthorize(
    harness,
    session,
    start,
    SLACK_RELAY_PATHS.connectCallback,
    'connect'
  );
  if (readLocation(identified).hostname !== 'slack.com') return identified;
  return followAuthorize(harness, session, identified, SLACK_RELAY_PATHS.installCallback, 'install');
}

interface Setup {
  harness: Harness;
  slack: FakeSlack;
  session: string;
  machine: MachineCredentials;
  forwards: { body: string; headers: Headers }[];
  tunnel: { answer: () => Response };
}

async function setUp(options: { online?: boolean } = {}): Promise<Setup> {
  const harness = createHarness();
  const slack = createFakeSlack(harness);
  const forwards: Setup['forwards'] = [];
  const tunnel = { answer: () => Response.json({ ok: true }, { status: 202 }) };
  harness.handlers.push((call) => {
    if (!call.url.endsWith('.shinsa.dev/api/slack/events')) return new Response('', { status: 599 });
    forwards.push({ body: call.body, headers: call.headers });
    return tunnel.answer();
  });
  const session = await harness.signIn();
  const machine = await pairMachine(harness, session);
  await connectSlack(harness, session, machine.instanceId);
  if (options.online !== false) await bringOnline(harness, machine);
  return { harness, slack, session, machine, forwards, tunnel };
}

async function grantAccess(
  harness: Harness,
  machine: MachineCredentials,
  session: string,
  role: 'member' | 'guest'
) {
  const studio = { bearer: machine.machineToken, sameOrigin: false };
  if (role === 'member') {
    const invite = await readJson<{ token: string }>(
      await harness.post(REMOTE_PATHS.machineInvites, {}, studio)
    );
    await harness.post(REMOTE_PATHS.inviteAccept, { token: invite.token }, { session });
    await harness.post(REMOTE_PATHS.machineMemberAdd, { userId: '7' }, studio);
    return;
  }
  const handoff = await readJson<{ token: string }>(
    await harness.post(REMOTE_PATHS.machineHandoffs, {}, studio)
  );
  await harness.post(REMOTE_PATHS.handoffAccept, { token: handoff.token }, { session });
  await harness.post(REMOTE_PATHS.machineGuestAdd, { userId: '7' }, studio);
}

function linkedAccounts(harness: Harness) {
  return harness.db.sqlite
    .query('SELECT slack_user_id, user_id, machine_id FROM slack_links ORDER BY slack_user_id')
    .all() as { slack_user_id: string; user_id: string; machine_id: string }[];
}

async function sendEvent(harness: Harness, envelope: unknown, headers: Record<string, string> = {}) {
  const body = typeof envelope === 'string' ? envelope : JSON.stringify(envelope);
  const timestamp = String(Math.floor(harness.clock.now / 1000));
  const signature = await createSlackSignature(TEST_CONFIG.slackSigningSecret, timestamp, body);
  const response = await harness.call(SLACK_RELAY_PATHS.events, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': signature,
      ...headers,
    },
    body,
  });
  await harness.settle();
  return response;
}

let eventCount = 0;

function mentionEnvelope(event: Fields = {}, envelope: Fields = {}) {
  return {
    type: 'event_callback',
    team_id: 'T1',
    event_id: `Ev${++eventCount}`,
    event: {
      type: 'app_mention',
      channel: 'C1',
      user: 'U1',
      ts: '100.1',
      text: '<@B0T> the build hangs',
      ...event,
    },
    ...envelope,
  };
}

let failures: ReturnType<typeof spyOn>;

beforeEach(() => {
  failures = spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  failures.mockRestore();
});

describe('the Slack app’s manifest', () => {
  test('asks for the scopes, redirects and events the relay uses, on app.shinsa.dev', () => {
    const manifest = JSON.parse(
      readFileSync(join(import.meta.dirname, '../slack-manifest.json'), 'utf8')
    ) as {
      oauth_config: { redirect_urls: string[]; scopes: { bot: string[]; user: string[] } };
      settings: {
        event_subscriptions: { request_url: string; bot_events: string[] };
        interactivity: { is_enabled: boolean; request_url: string };
        socket_mode_enabled: boolean;
      };
    };
    expect(manifest.oauth_config.scopes.bot).toEqual([...SLACK_BOT_SCOPES]);
    expect(manifest.oauth_config.scopes.user).toEqual([...SLACK_USER_SCOPES]);
    expect(manifest.oauth_config.redirect_urls).toEqual([
      `${TEST_CONFIG.origin}${SLACK_RELAY_PATHS.connectCallback}`,
      `${TEST_CONFIG.origin}${SLACK_RELAY_PATHS.installCallback}`,
    ]);
    expect(manifest.settings.event_subscriptions.request_url).toBe(
      `${TEST_CONFIG.origin}${SLACK_RELAY_PATHS.events}`
    );
    expect(manifest.settings.event_subscriptions.bot_events).toEqual([
      'app_mention',
      'app_uninstalled',
      'message.channels',
      'message.groups',
      'tokens_revoked',
    ]);
    expect(manifest.settings.interactivity).toEqual({
      is_enabled: true,
      request_url: `${TEST_CONFIG.origin}${SLACK_RELAY_PATHS.interactions}`,
    });
    expect(manifest.settings.socket_mode_enabled).toBe(false);
  });
});

describe('connecting Slack to a machine', () => {
  test('a signed-out browser signs in with GitHub first and comes back to connect', async () => {
    const harness = createHarness();
    const response = await harness.call(`${SLACK_RELAY_PATHS.connect}?instance=abc`);
    expect(response.status).toBe(302);
    const location = readLocation(response);
    expect(location.pathname).toBe(REMOTE_PATHS.signIn);
    expect(location.searchParams.get('return')).toBe(`${SLACK_RELAY_PATHS.connect}?instance=abc`);
  });

  test('the first person in a workspace signs in with Slack, adds the app, and is linked to their machine', async () => {
    const harness = createHarness();
    const slack = createFakeSlack(harness);
    const session = await harness.signIn();
    const machine = await pairMachine(harness, session);
    const start = await harness.call(`${SLACK_RELAY_PATHS.connect}?instance=${machine.instanceId}`, {
      session,
    });
    const authorize = readLocation(start);
    expect(authorize.origin + authorize.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(authorize.searchParams.get('scope')).toBeNull();
    expect(authorize.searchParams.get('user_scope')).toBe(
      'channels:history,groups:history,channels:read,groups:read'
    );
    expect(authorize.searchParams.get('redirect_uri')).toBe(
      `${TEST_CONFIG.origin}${SLACK_RELAY_PATHS.connectCallback}`
    );
    const identified = await followAuthorize(
      harness,
      session,
      start,
      SLACK_RELAY_PATHS.connectCallback,
      'connect'
    );
    const install = readLocation(identified);
    expect(install.origin + install.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(install.searchParams.get('team')).toBe('T1');
    expect(install.searchParams.get('scope')).toBe(
      'app_mentions:read,channels:history,channels:read,groups:history,groups:read,chat:write,reactions:write,users:read'
    );
    expect(install.searchParams.get('user_scope')).toBe(authorize.searchParams.get('user_scope'));
    const linked = await followAuthorize(
      harness,
      session,
      identified,
      SLACK_RELAY_PATHS.installCallback,
      'install'
    );
    expect(linked.headers.get('location')).toBe('/slack/linked?team=Acme');
    expect(readSetCookie(linked, '__Host-shinsa_slack')).toBe('__Host-shinsa_slack=');
    expect(slack.callsTo('oauth.v2.access').map((call) => call.body.client_secret)).toEqual([
      TEST_CONFIG.slackClientSecret,
      TEST_CONFIG.slackClientSecret,
    ]);
    const stored = harness.db.sqlite.query('SELECT sealed_bot_token FROM slack_workspaces').get() as {
      sealed_bot_token: string;
    };
    expect(stored.sealed_bot_token).not.toContain('xoxb');
    const [userToken] = sealedUserTokens(harness);
    expect(userToken?.slack_user_id).toBe('U1');
    expect(userToken?.sealed_user_token).not.toBeNull();
    expect(userToken?.sealed_user_token).not.toContain('xoxp');
    expect(slack.callsTo('auth.revoke')).toEqual([]);
    const links = await readJson<SlackLinks>(
      await harness.call(SLACK_RELAY_PATHS.links, {
        headers: { authorization: `Bearer ${machine.machineToken}` },
      })
    );
    expect(links.links).toEqual([
      {
        teamId: 'T1',
        teamName: 'Acme',
        userId: 'U1',
        userName: 'Christo',
        linkedAt: harness.clock.now,
        accountId: '42' as RemoteUserId,
      },
    ]);
  });

  test('a teammate in a workspace that has the app links without adding it again, to their own machine', async () => {
    const { harness, slack } = await setUp();
    answerConnectAs(slack, 'U2', 'xoxp-user-2');
    const mia = await harness.signIn('mia', 7);
    const laptop = await pairMachine(harness, mia, 'Laptop');
    const linked = await connectSlack(harness, mia, laptop.instanceId);
    expect(linked.headers.get('location')).toBe('/slack/linked?team=Acme');
    expect(slack.callsTo('oauth.v2.access').filter((call) => call.body.code === 'install')).toHaveLength(1);
    expect(slack.callsTo('users.info').at(-1)).toMatchObject({
      token: 'xoxb-bot-token',
      body: { user: 'U2' },
    });
    expect(sealedUserTokens(harness).map((row) => row.sealed_user_token === null)).toEqual([false, false]);
    const links = await readJson<SlackLinks>(
      await harness.call(SLACK_RELAY_PATHS.links, {
        headers: { authorization: `Bearer ${laptop.machineToken}` },
      })
    );
    expect(links.links.map((link) => [link.userId, link.userName])).toEqual([['U2', 'Mia']]);
  });

  test('names someone by their Slack user id when Slack will not say their name', async () => {
    const { harness, slack } = await setUp();
    answerConnectAs(slack, 'U9', 'xoxp-user-9');
    const mia = await harness.signIn('mia', 7);
    const laptop = await pairMachine(harness, mia, 'Laptop');
    expect((await connectSlack(harness, mia, laptop.instanceId)).headers.get('location')).toBe(
      '/slack/linked?team=Acme'
    );
    const links = await readJson<SlackLinks>(
      await harness.call(SLACK_RELAY_PATHS.links, {
        headers: { authorization: `Bearer ${laptop.machineToken}` },
      })
    );
    expect(links.links.map((link) => [link.userId, link.userName])).toEqual([['U9', 'U9']]);
  });

  test('adds the app again when its bot token lacks a scope the relay now asks for', async () => {
    const { harness, session, machine, slack } = await setUp();
    slack.answers['auth.test'] = () => ({ ok: true, headers: { 'x-oauth-scopes': 'chat:write,users:read' } });
    const start = await harness.call(`${SLACK_RELAY_PATHS.connect}?instance=${machine.instanceId}`, {
      session,
    });
    const identified = await followAuthorize(
      harness,
      session,
      start,
      SLACK_RELAY_PATHS.connectCallback,
      'connect'
    );
    expect(readLocation(identified).pathname).toBe('/oauth/v2/authorize');
    expect(readLocation(identified).searchParams.get('scope')).toContain('reactions:write');
    slack.answers['auth.test'] = () => ({
      ok: true,
      headers: { 'x-oauth-scopes': SLACK_BOT_SCOPES.join(',') },
    });
    expect((await connectSlack(harness, session, machine.instanceId)).headers.get('location')).toBe(
      '/slack/linked?team=Acme'
    );
    expect(slack.callsTo('oauth.v2.access').filter((call) => call.body.code === 'install')).toHaveLength(1);
    harness.handlers.unshift((call) =>
      call.url.endsWith('/api/auth.test')
        ? Promise.reject(new Error('offline'))
        : Promise.resolve(new Response('', { status: 599 }))
    );
    expect((await connectSlack(harness, session, machine.instanceId)).headers.get('location')).toBe(
      '/slack/linked?team=Acme'
    );
  });

  test('connecting again keeps a token Slack hands back unchanged, and revokes one it replaced', async () => {
    const { harness, session, machine, slack } = await setUp();
    const before = sealedUserTokens(harness);
    await connectSlack(harness, session, machine.instanceId);
    expect(slack.callsTo('auth.revoke')).toEqual([]);
    expect(sealedUserTokens(harness)).toHaveLength(1);
    expect(sealedUserTokens(harness)[0]?.sealed_user_token).not.toBe(before[0]?.sealed_user_token);
    answerConnectAs(slack, 'U1', 'xoxp-user-1b');
    await connectSlack(harness, session, machine.instanceId);
    expect(slack.callsTo('auth.revoke').map((call) => call.token)).toEqual(['xoxp-user-1']);
    answerConnectAs(slack, 'U1', 'xoxp-user-1c');
    slack.answers['auth.revoke'] = () => ({ ok: false, error: 'ratelimited' });
    const linked = await connectSlack(harness, session, machine.instanceId);
    expect(linked.headers.get('location')).toBe('/slack/linked?team=Acme');
    expect(slack.callsTo('auth.revoke').map((call) => call.token)).toEqual(['xoxp-user-1', 'xoxp-user-1b']);
  });

  test('without a machine named it links the one seen last, and says so when there is none', async () => {
    const harness = createHarness();
    createFakeSlack(harness);
    const session = await harness.signIn();
    const none = await harness.call(SLACK_RELAY_PATHS.connect, { session });
    expect(none.headers.get('location')).toBe('/slack/linked?error=no_machine');
    const studio = await pairMachine(harness, session, 'Studio');
    const laptop = await pairMachine(harness, session, 'Laptop');
    await bringOnline(harness, studio);
    harness.clock.now += 1000;
    await bringOnline(harness, laptop);
    const start = await harness.call(SLACK_RELAY_PATHS.connect, { session });
    expect(readSetCookie(start, '__Host-shinsa_slack')).toEndWith(`.${laptop.instanceId}`);
  });

  test('a member links their own Slack to the machine as themselves, and a guest is refused', async () => {
    const { harness, slack, machine } = await setUp();
    await bringOnline(harness, machine, ['slack-task-owner']);
    answerConnectAs(slack, 'U2', 'xoxp-user-2');
    const mia = await harness.signIn('mia', 7);
    await grantAccess(harness, machine, mia, 'member');
    expect((await connectSlack(harness, mia, machine.instanceId)).headers.get('location')).toBe(
      '/slack/linked?team=Acme'
    );
    expect(linkedAccounts(harness)).toEqual([
      { slack_user_id: 'U1', user_id: '42', machine_id: machine.instanceId },
      { slack_user_id: 'U2', user_id: '7', machine_id: machine.instanceId },
    ]);
    const guest = await harness.signIn('gus', 8);
    await grantAccess(harness, machine, guest, 'guest');
    const refused = await harness.call(`${SLACK_RELAY_PATHS.connect}?instance=${machine.instanceId}`, {
      session: guest,
    });
    expect(refused.status).toBe(404);
  });

  test('a member of a machine whose Shinsa cannot start tasks as them is told to ask its owner', async () => {
    const { harness, slack, machine } = await setUp();
    answerConnectAs(slack, 'U2', 'xoxp-user-2');
    const mia = await harness.signIn('mia', 7);
    await grantAccess(harness, machine, mia, 'member');
    const refused = await harness.call(`${SLACK_RELAY_PATHS.connect}?instance=${machine.instanceId}`, {
      session: mia,
    });
    expect(refused.status).toBe(403);
    await bringOnline(harness, machine, ['slack-task-owner']);
    const start = await harness.call(`${SLACK_RELAY_PATHS.connect}?instance=${machine.instanceId}`, {
      session: mia,
    });
    await bringOnline(harness, machine);
    const callback = await followAuthorize(harness, mia, start, SLACK_RELAY_PATHS.connectCallback, 'connect');
    expect(callback.headers.get('location')).toBe('/slack/linked?error=not_owner');
    expect(linkedAccounts(harness).map((link) => link.slack_user_id)).toEqual(['U1']);
  });

  test('without a machine named it picks their own first, else one they are a member of', async () => {
    const { harness, machine } = await setUp();
    const mia = await harness.signIn('mia', 7);
    await grantAccess(harness, machine, mia, 'member');
    const none = await harness.call(SLACK_RELAY_PATHS.connect, { session: mia });
    expect(none.headers.get('location')).toBe('/slack/linked?error=no_machine');
    await bringOnline(harness, machine, ['slack-task-owner']);
    const shared = await harness.call(SLACK_RELAY_PATHS.connect, { session: mia });
    expect(readSetCookie(shared, '__Host-shinsa_slack')).toEndWith(`.${machine.instanceId}`);
    const laptop = await pairMachine(harness, mia, 'Laptop');
    const own = await harness.call(SLACK_RELAY_PATHS.connect, { session: mia });
    expect(readSetCookie(own, '__Host-shinsa_slack')).toEndWith(`.${laptop.instanceId}`);
  });

  test('refuses a machine that belongs to someone else', async () => {
    const harness = createHarness();
    const owner = await harness.signIn('mona', 1);
    const machine = await pairMachine(harness, owner);
    const stranger = await harness.signIn('eve', 2);
    const response = await harness.call(`${SLACK_RELAY_PATHS.connect}?instance=${machine.instanceId}`, {
      session: stranger,
    });
    expect(response.status).toBe(404);
  });

  test('a denied, expired, signed-out or failed connection lands on the linked page with the reason', async () => {
    const harness = createHarness();
    const slack = createFakeSlack(harness);
    const session = await harness.signIn();
    const machine = await pairMachine(harness, session);
    const begin = () =>
      harness.call(`${SLACK_RELAY_PATHS.connect}?instance=${machine.instanceId}`, { session });
    const reasonOf = (response: Response) => readLocation(response).searchParams.get('error');

    const denied = await harness.call(`${SLACK_RELAY_PATHS.connectCallback}?error=access_denied`, {
      session,
    });
    expect(reasonOf(denied)).toBe('slack_denied');

    const start = await begin();
    const cookie = readSetCookie(start, '__Host-shinsa_slack');
    const forged = await harness.call(`${SLACK_RELAY_PATHS.connectCallback}?code=c&state=forged`, {
      headers: { cookie: `__Host-shinsa_session=${session}; ${cookie}` },
    });
    expect(reasonOf(forged)).toBe('slack_expired');
    const state = readLocation(start).searchParams.get('state');
    const noCode = await harness.call(`${SLACK_RELAY_PATHS.connectCallback}?state=${state}`, {
      headers: { cookie: `__Host-shinsa_session=${session}; ${cookie}` },
    });
    expect(reasonOf(noCode)).toBe('slack_denied');
    const signedOut = await harness.call(`${SLACK_RELAY_PATHS.connectCallback}?code=c&state=${state}`, {
      headers: { cookie },
    });
    expect(reasonOf(signedOut)).toBe('signed_out');

    const refusedWith = async (answer: Fields) => {
      slack.answers['oauth.v2.access'] = () => answer;
      return reasonOf(
        await followAuthorize(harness, session, await begin(), SLACK_RELAY_PATHS.connectCallback, 'connect')
      );
    };
    expect(await refusedWith({ ok: false, error: 'invalid_code' })).toBe('slack_failed');
    expect(await refusedWith({ ok: true, team: { id: 'T1' }, authed_user: { id: 'U1' } })).toBe(
      'slack_failed'
    );
    expect(await refusedWith({ ok: true, authed_user: { id: 'U1', access_token: 'xoxp' } })).toBe(
      'slack_failed'
    );
    expect(await refusedWith({ ok: true, team: { id: 'T1' }, authed_user: { access_token: 'xoxp' } })).toBe(
      'slack_failed'
    );
  });

  test('an install Slack answers without a bot is refused, and an unreadable store fails as a server error', async () => {
    const harness = createHarness();
    const slack = createFakeSlack(harness);
    const session = await harness.signIn();
    const machine = await pairMachine(harness, session);
    slack.answers['oauth.v2.access'] = () => ({
      ok: true,
      team: { id: 'T1' },
      authed_user: { id: 'U1', access_token: 'xoxp' },
    });
    const refused = await connectSlack(harness, session, machine.instanceId);
    expect(refused.headers.get('location')).toBe('/slack/linked?error=slack_failed');

    slack.answers['oauth.v2.access'] = () => ({
      ok: true,
      access_token: 'xoxb',
      bot_user_id: 'B0T',
      team: { id: 'T1' },
      authed_user: { id: 'U9', access_token: 'xoxp' },
    });
    harness.world.config.slackTokenKey = 'short';
    const broken = await connectSlack(harness, session, machine.instanceId);
    expect(broken.headers.get('location')).toBe('/slack/linked?error=server_error');

    harness.world.config.slackTokenKey = TEST_CONFIG.slackTokenKey;
    const named = await connectSlack(harness, session, machine.instanceId);
    expect(named.headers.get('location')).toBe('/slack/linked?team=T1');
    const link = harness.db.sqlite.query('SELECT slack_user_name FROM slack_links').get() as {
      slack_user_name: string;
    };
    expect(link.slack_user_name).toBe('U9');
  });
});

describe('events from Slack', () => {
  test('refuses a request Slack did not sign, or signed too long ago', async () => {
    const { harness, forwards } = await setUp();
    expect((await sendEvent(harness, mentionEnvelope(), { 'x-slack-signature': 'v0=forged' })).status).toBe(
      401
    );
    expect((await sendEvent(harness, mentionEnvelope(), { 'x-slack-request-timestamp': 'now' })).status).toBe(
      401
    );
    const old = String(Math.floor(harness.clock.now / 1000) - 301);
    expect((await sendEvent(harness, mentionEnvelope(), { 'x-slack-request-timestamp': old })).status).toBe(
      401
    );
    harness.world.config.slackSigningSecret = '';
    expect((await sendEvent(harness, mentionEnvelope())).status).toBe(401);
    expect(forwards).toHaveLength(0);
  });

  test('refuses a body over 1 MB or one that is not a JSON object', async () => {
    const { harness } = await setUp();
    expect((await sendEvent(harness, 'x'.repeat(SLACK_EVENT_BODY_LIMIT_BYTES + 1))).status).toBe(413);
    expect((await sendEvent(harness, '{nope')).status).toBe(400);
    expect((await sendEvent(harness, '[1]')).status).toBe(400);
  });

  test('answers Slack’s URL check with its challenge', async () => {
    const harness = createHarness();
    const response = await sendEvent(harness, { type: 'url_verification', challenge: 'c-1' });
    expect(await response.json()).toEqual({ challenge: 'c-1' });
  });

  test('a redelivered event, another kind of callback and a bot’s own mention start nothing', async () => {
    const { harness, forwards } = await setUp();
    const envelope = mentionEnvelope();
    expect((await sendEvent(harness, envelope)).status).toBe(200);
    expect((await sendEvent(harness, envelope)).status).toBe(200);
    await sendEvent(harness, { type: 'app_rate_limited' });
    await sendEvent(harness, mentionEnvelope({ bot_id: 'B9' }));
    await sendEvent(harness, mentionEnvelope({ subtype: 'message_changed' }));
    await sendEvent(harness, mentionEnvelope({ type: 'message' }));
    await sendEvent(harness, mentionEnvelope({ user: undefined }));
    await sendEvent(harness, mentionEnvelope({}, { event: 'none' }));
    await sendEvent(harness, mentionEnvelope({}, { team_id: 'T9' }));
    expect(forwards).toHaveLength(1);
  });

  test('a revoked bot token forgets the workspace and every link in it; a revoked user token alone drops only that token', async () => {
    const { harness, slack } = await setUp();
    const count = () =>
      harness.db.sqlite.query('SELECT COUNT(*) AS n FROM slack_links').get() as { n: number };
    await sendEvent(harness, mentionEnvelope({ type: 'tokens_revoked' }));
    expect(sealedUserTokens(harness)[0]?.sealed_user_token).not.toBeNull();
    await sendEvent(harness, mentionEnvelope({ type: 'tokens_revoked', tokens: { oauth: ['U1'] } }));
    expect(count().n).toBe(1);
    expect(sealedUserTokens(harness)).toEqual([{ slack_user_id: 'U1', sealed_user_token: null }]);
    expect(slack.callsTo('auth.revoke')).toHaveLength(0);
    await sendEvent(harness, mentionEnvelope({ type: 'tokens_revoked', tokens: { bot: ['B0T'] } }));
    expect(count().n).toBe(0);
  });

  test('removing the app forgets the workspace', async () => {
    const { harness } = await setUp();
    await sendEvent(harness, mentionEnvelope({ type: 'app_uninstalled' }));
    expect(harness.db.sqlite.query('SELECT COUNT(*) AS n FROM slack_workspaces').get()).toEqual({ n: 0 });
  });
});

describe('a mention from someone', () => {
  test('not linked to Shinsa gets a private reply in the thread with the link to connect', async () => {
    const { harness, slack, forwards } = await setUp();
    await sendEvent(harness, mentionEnvelope({ user: 'U2', thread_ts: '90.1' }));
    const [ephemeral] = slack.callsTo('chat.postEphemeral');
    expect(ephemeral?.body).toMatchObject({ channel: 'C1', user: 'U2', thread_ts: '90.1' });
    expect(ephemeral?.token).toBe('xoxb-bot-token');
    expect(JSON.stringify(ephemeral?.body.blocks)).toContain(`${TEST_CONFIG.origin}/slack/connect`);
    expect(forwards).toHaveLength(0);
  });

  test('linked reaches their machine signed with its connect key, as readable text with its own message', async () => {
    const { harness, machine, forwards, slack } = await setUp();
    await sendEvent(harness, mentionEnvelope({ text: '<@B0T> ask <@U2> about <#C2|ops>' }));
    expect(forwards).toHaveLength(1);
    const [forward] = forwards;
    const signature = {
      signature: forward?.headers.get(SLACK_FORWARD_HEADERS.signature) ?? null,
      timestamp: forward?.headers.get(SLACK_FORWARD_HEADERS.timestamp) ?? null,
    };
    expect(
      await Effect.runPromise(
        verifySlackForwardSignature(machine.connectKey, signature, forward?.body ?? '', harness.clock.now)
      )
    ).toBe(true);
    const mention = JSON.parse(forward?.body ?? '') as SlackMention;
    expect(mention).toMatchObject({
      teamId: 'T1',
      channelId: 'C1',
      threadTs: '100.1',
      messageTs: '100.1',
      userId: 'U1',
      userName: 'Christo',
      text: 'ask @Mia about #ops',
      permalink: 'https://acme.slack.com/archives/C1/p100.1',
      channelName: 'support',
    });
    expect(slack.callsTo('conversations.info')[0]?.body).toMatchObject({ channel: 'C1' });
    expect(mention.thread).toEqual([
      { ts: '100.1', userId: 'U1', userName: 'Christo', text: 'ask @Mia about #ops', bot: false },
    ]);
    expect(harness.db.sqlite.query('SELECT thread_ts FROM slack_threads').all()).toEqual([
      { thread_ts: '100.1' },
    ]);
  });

  test('linked carries the account it is linked to, so the machine starts the task as them', async () => {
    const { harness, slack, machine, forwards } = await setUp();
    await bringOnline(harness, machine, ['slack-task-owner']);
    answerConnectAs(slack, 'U2', 'xoxp-user-2');
    const mia = await harness.signIn('mia', 7);
    await grantAccess(harness, machine, mia, 'member');
    await connectSlack(harness, mia, machine.instanceId);
    await sendEvent(harness, mentionEnvelope());
    await sendEvent(harness, mentionEnvelope({ user: 'U2', ts: '100.2' }));
    const linked = forwards.map((forward) => String((JSON.parse(forward.body) as SlackMention).linkedUserId));
    expect(linked).toEqual(['42', '7']);
  });

  test('linked by someone no longer on the machine gets the link to connect, and nothing reaches it', async () => {
    const { harness, slack, machine, forwards } = await setUp();
    await bringOnline(harness, machine, ['slack-task-owner']);
    answerConnectAs(slack, 'U2', 'xoxp-user-2');
    const mia = await harness.signIn('mia', 7);
    await grantAccess(harness, machine, mia, 'member');
    await connectSlack(harness, mia, machine.instanceId);
    await harness.post(
      REMOTE_PATHS.machineMemberRemove,
      { userId: '7' },
      { bearer: machine.machineToken, sameOrigin: false }
    );
    await sendEvent(harness, mentionEnvelope({ user: 'U2' }));
    expect(forwards).toHaveLength(0);
    const [ephemeral] = slack.callsTo('chat.postEphemeral');
    expect(ephemeral?.body).toMatchObject({ channel: 'C1', user: 'U2' });
    expect(JSON.stringify(ephemeral?.body.blocks)).toContain(`${TEST_CONFIG.origin}/slack/connect`);
  });

  test('in a thread brings the whole thread, bots and unknown people named as well as Slack allows', async () => {
    const { harness, slack, forwards } = await setUp();
    slack.answers['conversations.replies'] = () => ({
      ok: true,
      messages: [
        { ts: '90.1', user: 'U2', text: 'Deploys fail since Monday.' },
        { ts: '90.2', bot_id: 'BX', bot_profile: { name: 'CI' }, text: 'Build #12 failed.' },
        { ts: '90.3', bot_id: 'BY', username: 'Alerts', text: 'Disk full.' },
        { ts: '90.4', bot_id: 'BZ', text: 'beep' },
        { ts: '90.5', user: 'U7', text: 'same here' },
        { ts: '90.51', user: 'U5', text: 'me too' },
        { ts: '90.52', user: 'U6', text: 'and me' },
        { ts: '90.6', user: 'B0T', text: 'Earlier reply' },
        { ts: '90.7' },
        'noise',
      ],
    });
    slack.answers['chat.getPermalink'] = () => ({ ok: false, error: 'channel_not_found' });
    slack.answers['conversations.info'] = () => ({ ok: false, error: 'missing_scope' });
    await sendEvent(harness, mentionEnvelope({ ts: '90.9', thread_ts: '90.1' }));
    const mention = JSON.parse(forwards[0]?.body ?? '') as SlackMention;
    expect(slack.callsTo('conversations.replies')[0]?.body).toMatchObject({ channel: 'C1', ts: '90.1' });
    expect(mention.threadTs).toBe('90.1');
    expect(mention.permalink).toBeNull();
    expect(mention.channelName).toBeNull();
    expect(mention.thread.map((message) => [message.userName, message.text, message.bot])).toEqual([
      ['Mia', 'Deploys fail since Monday.', false],
      ['CI', 'Build #12 failed.', true],
      ['Alerts', 'Disk full.', true],
      ['Bot', 'beep', true],
      ['U7', 'same here', false],
      ['Sam Real', 'me too', false],
      ['kit', 'and me', false],
      ['B0T', 'Earlier reply', true],
      ['Christo', 'the build hangs', false],
    ]);
  });

  test('in a thread reads a bot report from its blocks and attachments, not its preview text', async () => {
    const { harness, slack, forwards } = await setUp();
    const report = {
      ts: '90.2',
      bot_id: 'BS',
      bot_profile: { name: 'Superwall CLI' },
      text: 'feedback: BUG: Android sw-auto selects wrong offer token. On Android, when a paywall product uses sw-a',
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: 'BUG: Android sw-auto selects wrong offer token' },
        },
        { type: 'divider' },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'On Android, when a paywall product uses sw-auto on a base plan that is not current, the 2023 plan is billed.',
          },
          fields: [{ type: 'mrkdwn', text: '*App* Audiomack' }, 'noise'],
        },
        { type: 'markdown', text: '**Expected** the 2026 plan.' },
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: 'Reported by' },
            { type: 'image', image_url: 'https://x.test/a.png' },
            { type: 'user', user_id: 'U2' },
          ],
        },
        {
          type: 'rich_text',
          elements: [
            {
              type: 'rich_text_section',
              elements: [
                { type: 'text', text: 'Steps from ' },
                { type: 'user', user_id: 'U2' },
                { type: 'text', text: ' in ' },
                { type: 'channel', channel_id: 'C9' },
                { type: 'text', text: ' for ' },
                { type: 'usergroup', usergroup_id: 'S1' },
                { type: 'text', text: ' and ' },
                { type: 'broadcast', range: 'here' },
                { type: 'emoji', name: 'bug' },
                { type: 'link', url: 'https://docs.test/a', text: 'docs' },
                { type: 'link', url: 'https://docs.test/b' },
                { type: 'link', text: 'no address' },
                { type: 'user' },
                { type: 'channel' },
                { type: 'usergroup' },
                { type: 'broadcast' },
                { type: 'emoji' },
                { type: 'color' },
              ],
            },
            {
              type: 'rich_text_list',
              style: 'ordered',
              elements: [
                { type: 'rich_text_section', elements: [{ type: 'text', text: 'Open the paywall' }] },
                { type: 'rich_text_section', elements: [{ type: 'text', text: 'Buy' }] },
              ],
            },
            {
              type: 'rich_text_list',
              style: 'bullet',
              elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'on Pixel 8' }] }],
            },
            { type: 'rich_text_preformatted', elements: [{ type: 'text', text: 'basePlan=audiomack-2023' }] },
            { type: 'rich_text_quote', elements: [{ type: 'text', text: 'first line\nsecond line' }] },
            { type: 'rich_text_section' },
          ],
        },
        { type: 'section', text: 42 },
        'noise',
      ],
      attachments: [
        {
          pretext: 'Logs',
          title: 'Device',
          text: 'Pixel 8, Android 15',
          fields: [{ title: 'SDK', value: '2.3.0' }, { title: 'Store' }, 7],
          blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Attached block' } }],
        },
        { fallback: 'Only the fallback' },
        { fallback: '  ' },
        {},
        'noise',
      ],
    };
    slack.answers['conversations.replies'] = () => ({
      ok: true,
      messages: [
        report,
        {
          ts: '90.3',
          user: 'U2',
          text: 'same on <@U2> side',
          blocks: [
            {
              type: 'rich_text',
              elements: [
                {
                  type: 'rich_text_section',
                  elements: [
                    { type: 'text', text: 'same on ' },
                    { type: 'user', user_id: 'U2' },
                    { type: 'text', text: ' side' },
                  ],
                },
              ],
            },
          ],
        },
        { ts: '90.4', bot_id: 'BA', username: 'Alerts', attachments: [{ fallback: 'Disk full on db-1' }] },
        {
          ts: '90.5',
          user: 'B0T',
          bot_id: 'BSH',
          bot_profile: { name: 'Shinsa' },
          text: 'The parser drops blocks.',
          blocks: [
            { type: 'header', text: { type: 'plain_text', text: 'Result' } },
            { type: 'section', text: { type: 'mrkdwn', text: 'x'.repeat(2800) } },
          ],
        },
      ],
    });
    await sendEvent(harness, mentionEnvelope({ ts: '90.9', thread_ts: '90.2' }));
    const mention = JSON.parse(forwards[0]?.body ?? '') as SlackMention;
    expect(mention.thread.map((message) => [message.userName, message.text])).toEqual([
      [
        'Superwall CLI',
        [
          'BUG: Android sw-auto selects wrong offer token',
          'On Android, when a paywall product uses sw-auto on a base plan that is not current, the 2023 plan is billed.\n*App* Audiomack',
          '**Expected** the 2026 plan.',
          'Reported by @Mia',
          'Steps from @Mia in <#C9> for <!subteam^S1> and @here:bug:docs (https://docs.test/a)https://docs.test/bno address\n1. Open the paywall\n2. Buy\n• on Pixel 8\n```\nbasePlan=audiomack-2023\n```\n> first line\n> second line',
          'Logs\nDevice\nPixel 8, Android 15\nSDK: 2.3.0\nStore\nAttached block',
          'Only the fallback',
        ].join('\n\n'),
      ],
      ['Mia', 'same on @Mia side'],
      ['Alerts', 'Disk full on db-1'],
      ['Shinsa', 'The parser drops blocks.'],
      ['Christo', 'the build hangs'],
    ]);
  });

  test('in a thread Slack will not show still carries their own message', async () => {
    const { harness, slack, forwards } = await setUp();
    slack.answers['conversations.replies'] = () => ({ ok: false, error: 'not_in_channel' });
    await sendEvent(harness, mentionEnvelope({ ts: '90.9', thread_ts: '90.1' }));
    const mention = JSON.parse(forwards[0]?.body ?? '') as SlackMention;
    expect(mention.thread.map((message) => message.ts)).toEqual(['90.9']);
    slack.answers['conversations.replies'] = () => ({ ok: true });
    await sendEvent(harness, mentionEnvelope({ ts: '91.9', thread_ts: '91.1' }));
    expect((JSON.parse(forwards[1]?.body ?? '') as SlackMention).thread).toHaveLength(1);
  });

  test('whose machine is offline, or whose tunnel does not answer, is told so in the thread', async () => {
    const offline = await setUp({ online: false });
    await sendEvent(offline.harness, mentionEnvelope());
    const [said] = offline.slack.callsTo('chat.postMessage');
    expect(said?.body).toMatchObject({ channel: 'C1', thread_ts: '100.1' });
    expect(String(said?.body.text)).toContain('Studio is offline');
    expect(offline.forwards).toHaveLength(0);

    const { harness, slack, tunnel } = await setUp();
    const warnings = spyOn(console, 'warn').mockImplementation(() => undefined);
    tunnel.answer = () => new Response('', { status: 530 });
    await sendEvent(harness, mentionEnvelope());
    tunnel.answer = () => {
      throw new Error('connection refused');
    };
    await sendEvent(harness, mentionEnvelope());
    tunnel.answer = () => new Response('', { status: 500 });
    await sendEvent(harness, mentionEnvelope());
    expect(slack.callsTo('chat.postMessage')).toHaveLength(2);
    expect(failures).toHaveBeenCalledWith('[Cloud] A machine refused a Slack mention', expect.anything());
    expect(warnings.mock.calls).toEqual([
      [
        '[Cloud] Machine offline',
        expect.objectContaining({ surface: 'slack', reason: 'status', status: 530 }),
      ],
      [
        '[Cloud] Machine offline',
        expect.objectContaining({
          surface: 'slack',
          reason: 'unreachable',
          error: expect.stringContaining('connection refused'),
        }),
      ],
    ]);
    expect(failures).toHaveBeenCalledTimes(1);
    warnings.mockRestore();
  });

  test('that fails part way is logged, and Slack still gets its answer at once', async () => {
    const { harness, slack } = await setUp();
    slack.answers['chat.postEphemeral'] = () => ({ ok: false, error: 'channel_not_found' });
    const response = await sendEvent(harness, mentionEnvelope({ user: 'U2' }));
    expect(response.status).toBe(200);
    expect(failures).toHaveBeenCalledWith(
      '[Cloud] A Slack mention could not be forwarded',
      expect.objectContaining({ teamId: 'T1' })
    );
  });

  test('when Slack cannot be reached at all is logged too', async () => {
    const { harness } = await setUp();
    harness.handlers.unshift((call) => {
      if (call.url.startsWith('https://slack.com/api/')) throw new Error('offline');
      return new Response('', { status: 599 });
    });
    await sendEvent(harness, mentionEnvelope({ user: 'U2' }));
    expect(failures).toHaveBeenCalledWith(
      '[Cloud] A Slack mention could not be forwarded',
      expect.anything()
    );
  });
});

const CUSTOMER_LINK =
  '<https://acme.slack.com/archives/C9/p1700000000000200?thread_ts=1700000000.000100&amp;cid=C9|the customer thread>';
const OPS_LINK = '<https://acme.slack.com/archives/G8/p1700000000000300>';

function linkingMention(text: string, event: Fields = {}) {
  return mentionEnvelope({ ts: '1700000001.000001', text: `<@B0T> look at ${text}`, ...event });
}

function answerRepliesByToken(slack: FakeSlack, refused: Record<string, string> = {}) {
  slack.answers['conversations.replies'] = (body) => {
    const error = refused[String(body.channel)];
    if (error) return { ok: false, error };
    return {
      ok: true,
      messages: [
        { ts: String(body.ts), user: 'U2', text: `Opened in <#${String(body.channel)}|ops>` },
        {
          ts: '1700000000.000900',
          bot_id: 'BX',
          bot_profile: { name: 'Intercom' },
          text: 'Customer replied',
        },
      ],
    };
  };
  slack.answers['conversations.info'] = (body) => ({
    ok: true,
    channel: { id: body.channel, name: body.channel === 'C1' ? 'support' : `shared-${String(body.channel)}` },
  });
}

async function setUpLinking() {
  const setup = await setUp();
  await bringOnline(setup.harness, setup.machine, ['slack-linked-threads']);
  answerRepliesByToken(setup.slack);
  return setup;
}

const UNOPENABLE_TOKEN = 'A'.repeat(64);

function readForward(forwards: Setup['forwards'], index = 0) {
  return JSON.parse(forwards[index]?.body ?? '') as SlackMention;
}

describe('a mention that links to other threads', () => {
  test('reads each linked thread with the mentioner’s own token and forwards it beside their own', async () => {
    const { harness, slack, forwards } = await setUpLinking();
    await sendEvent(harness, linkingMention(`${CUSTOMER_LINK} and ${OPS_LINK}`));
    const linkedReads = slack.callsTo('conversations.replies');
    expect(linkedReads.map((call) => [call.body.channel, call.body.ts, call.token])).toEqual([
      ['C9', '1700000000.000100', 'xoxp-user-1'],
      ['G8', '1700000000.000300', 'xoxp-user-1'],
    ]);
    expect(slack.callsTo('conversations.info').map((call) => [call.body.channel, call.token])).toEqual([
      ['C9', 'xoxp-user-1'],
      ['G8', 'xoxp-user-1'],
      ['C1', 'xoxb-bot-token'],
    ]);
    const mention = readForward(forwards);
    expect(mention.linkedThreads).toEqual([
      {
        channelId: 'C9',
        threadTs: '1700000000.000100',
        permalink:
          'https://acme.slack.com/archives/C9/p1700000000000200?thread_ts=1700000000.000100&amp;cid=C9',
        channelName: 'shared-C9',
        thread: [
          { ts: '1700000000.000100', userId: 'U2', userName: 'Mia', text: 'Opened in #ops', bot: false },
          {
            ts: '1700000000.000900',
            userId: 'BX',
            userName: 'Intercom',
            text: 'Customer replied',
            bot: true,
          },
        ],
      },
      {
        channelId: 'G8',
        threadTs: '1700000000.000300',
        permalink: 'https://acme.slack.com/archives/G8/p1700000000000300',
        channelName: 'shared-G8',
        thread: [
          { ts: '1700000000.000300', userId: 'U2', userName: 'Mia', text: 'Opened in #ops', bot: false },
          {
            ts: '1700000000.000900',
            userId: 'BX',
            userName: 'Intercom',
            text: 'Customer replied',
            bot: true,
          },
        ],
      },
    ]);
    expect(slack.callsTo('chat.postEphemeral')).toHaveLength(0);
  });

  test('reads at most three, and skips a link to the thread it was mentioned in', async () => {
    const { harness, slack, forwards } = await setUpLinking();
    const links = ['C2', 'C3', 'C4', 'C5'].map(
      (channel) => `<https://acme.slack.com/archives/${channel}/p1700000000000400>`
    );
    const own = '<https://acme.slack.com/archives/C1/p1700000001000001>';
    await sendEvent(harness, linkingMention([own, ...links].join(' ')));
    expect(slack.callsTo('conversations.replies').map((call) => call.body.channel)).toEqual(['C2', 'C3']);
    expect(readForward(forwards).linkedThreads).toHaveLength(2);
  });

  test('never falls back to the bot’s token, and says privately which links it could not read', async () => {
    const { harness, slack, forwards } = await setUpLinking();
    const warnings = spyOn(console, 'warn').mockImplementation(() => undefined);
    answerRepliesByToken(slack, { C9: 'not_in_channel' });
    await sendEvent(harness, linkingMention(`${CUSTOMER_LINK} and ${OPS_LINK}`));
    expect(warnings).toHaveBeenCalledWith(
      '[Cloud] A linked Slack thread could not be read',
      expect.objectContaining({ code: 'not_in_channel', teamId: 'T1' })
    );
    warnings.mockRestore();
    expect(failures).not.toHaveBeenCalled();
    expect(slack.callsTo('conversations.replies').every((call) => call.token === 'xoxp-user-1')).toBe(true);
    expect(readForward(forwards).linkedThreads.map((thread) => thread.channelId)).toEqual(['G8']);
    const [ephemeral] = slack.callsTo('chat.postEphemeral');
    expect(ephemeral?.token).toBe('xoxb-bot-token');
    expect(ephemeral?.body).toMatchObject({
      channel: 'C1',
      user: 'U1',
      thread_ts: '1700000001.000001',
      text: 'I could not read the thread you linked. Check that you can open it in Slack.',
    });
    answerRepliesByToken(slack, { C9: 'channel_not_found', G8: 'thread_not_found' });
    await sendEvent(harness, linkingMention(`${CUSTOMER_LINK} and ${OPS_LINK}`));
    expect(slack.callsTo('chat.postEphemeral')[1]?.body.text).toBe(
      'I could not read 2 of the threads you linked. Check that you can open them in Slack.'
    );
    expect(readForward(forwards, 1).linkedThreads).toEqual([]);
  });

  test('asks to connect again when the person has no token yet, or Slack refuses the one kept', async () => {
    const { harness, slack, forwards } = await setUpLinking();
    answerRepliesByToken(slack, { C9: 'missing_scope' });
    await sendEvent(harness, linkingMention(`${CUSTOMER_LINK} and ${OPS_LINK}`));
    const [refused] = slack.callsTo('chat.postEphemeral');
    expect(refused?.body.text).toBe('Connect Slack again so I can read the threads you link.');
    expect(failures).toHaveBeenCalledWith(
      '[Cloud] A linked Slack thread could not be read',
      expect.objectContaining({ code: 'missing_scope', teamId: 'T1' })
    );
    expect(JSON.stringify(refused?.body.blocks)).toContain(`${TEST_CONFIG.origin}/slack/connect`);
    harness.db.sqlite.query('UPDATE slack_links SET sealed_user_token = NULL').run();
    const reads = slack.callsTo('conversations.replies').length;
    await sendEvent(harness, linkingMention(CUSTOMER_LINK));
    expect(slack.callsTo('conversations.replies')).toHaveLength(reads);
    expect(slack.callsTo('chat.postEphemeral')[1]?.body.text).toBe(
      'Connect Slack again so I can read the threads you link.'
    );
    expect(readForward(forwards, 1).linkedThreads).toEqual([]);
  });

  test('asks to connect again, and still forwards the mention, when the kept token no longer opens', async () => {
    const { harness, session, machine, slack, forwards } = await setUpLinking();
    const warnings = spyOn(console, 'warn').mockImplementation(() => undefined);
    harness.db.sqlite.query('UPDATE slack_links SET sealed_user_token = ?').run(UNOPENABLE_TOKEN);
    await sendEvent(harness, linkingMention(CUSTOMER_LINK));
    expect(slack.callsTo('conversations.replies')).toHaveLength(0);
    expect(readForward(forwards).linkedThreads).toEqual([]);
    expect(slack.callsTo('chat.postEphemeral')[0]?.body.text).toBe(
      'Connect Slack again so I can read the threads you link.'
    );
    expect(warnings).toHaveBeenCalledWith(
      '[Cloud] A stored Slack user token does not open',
      expect.anything()
    );
    warnings.mockRestore();
    const linked = await connectSlack(harness, session, machine.instanceId);
    expect(linked.headers.get('location')).toBe('/slack/linked?team=Acme');
    expect(slack.callsTo('auth.revoke')).toEqual([]);
    expect(sealedUserTokens(harness)[0]?.sealed_user_token).not.toBe(UNOPENABLE_TOKEN);
  });

  test('reads nothing linked for a machine that does not take linked threads, and asks nothing', async () => {
    const { harness, machine, slack, forwards } = await setUpLinking();
    await bringOnline(harness, machine);
    await sendEvent(harness, linkingMention(CUSTOMER_LINK));
    expect(slack.callsTo('conversations.replies')).toHaveLength(0);
    expect(readForward(forwards).linkedThreads).toEqual([]);
    expect(slack.callsTo('chat.postEphemeral')).toHaveLength(0);
  });

  test('from someone outside the workspace, such as a customer in a shared channel, gets no reply at all', async () => {
    const { harness, slack, forwards } = await setUpLinking();
    await sendEvent(harness, linkingMention(CUSTOMER_LINK, { user: 'U3', user_team: 'T9' }));
    await sendEvent(harness, linkingMention(CUSTOMER_LINK, { user_team: 'T9' }));
    expect(forwards).toHaveLength(0);
    expect(
      slack.calls.filter((call) => call.method !== 'oauth.v2.access' && call.method !== 'users.info')
    ).toEqual([]);
    await sendEvent(harness, linkingMention(CUSTOMER_LINK, { user_team: 'T1' }));
    expect(forwards).toHaveLength(1);
  });
});

describe('what a machine does through the relay', () => {
  async function forwardedSetup() {
    const setup = await setUp();
    await sendEvent(setup.harness, mentionEnvelope());
    const post = (body: unknown, bearer = setup.machine.machineToken) =>
      setup.harness.post(SLACK_RELAY_PATHS.post, body, { bearer, sameOrigin: false });
    return { ...setup, post };
  }

  const MESSAGE = {
    text: 'Planning',
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Planning' } }],
  };

  const POST = { teamId: 'T1', channelId: 'C1', threadTs: '100.1', replaceTs: null, message: MESSAGE };

  test('posts in a thread it was sent, then edits that post', async () => {
    const { slack, post } = await forwardedSetup();
    const posted = await post(POST);
    expect(posted.status).toBe(200);
    const { ts } = await readJson<{ ts: string }>(posted);
    expect(slack.callsTo('chat.postMessage').at(-1)?.body).toMatchObject({
      channel: 'C1',
      thread_ts: '100.1',
      text: 'Planning',
      unfurl_links: false,
    });
    const edited = await post({ ...POST, replaceTs: ts, message: { ...MESSAGE, text: 'Building' } });
    expect(await edited.json()).toEqual({ ts });
    expect(slack.callsTo('chat.update').at(-1)?.body).toMatchObject({ channel: 'C1', ts, text: 'Building' });
  });

  test('cannot post in a thread it was never sent, or edit a message it did not post', async () => {
    const { post } = await forwardedSetup();
    const elsewhere = await post({ ...POST, threadTs: '555.1' });
    expect(elsewhere.status).toBe(403);
    expect((await readJson<{ error: { code: string } }>(elsewhere)).error.code).toBe('thread_not_forwarded');
    const foreign = await post({ ...POST, replaceTs: '999.9' });
    expect((await readJson<{ error: { code: string } }>(foreign)).error.code).toBe('post_not_yours');
  });

  test('needs the machine token and a post it understands', async () => {
    const { post } = await forwardedSetup();
    expect((await post(POST, 'stolen')).status).toBe(401);
    expect((await post({ ...POST, message: { text: '', blocks: [] } })).status).toBe(400);
  });

  test('says when Slack refuses, answers without a message id, or the app was removed', async () => {
    const { harness, slack, post } = await forwardedSetup();
    slack.answers['chat.postMessage'] = () => ({ ok: false, error: 'msg_too_long' });
    const refused = await post(POST);
    expect(refused.status).toBe(502);
    expect((await readJson<{ error: { message: string } }>(refused)).error.message).toBe(
      'Slack did not take the post (msg_too_long).'
    );
    slack.answers['chat.postMessage'] = () => ({ ok: false, error: 'invalid_blocks' });
    const blocks = await post(POST);
    expect(blocks.status).toBe(422);
    expect((await readJson<{ error: { code: string } }>(blocks)).error.code).toBe('slack_blocks_refused');
    slack.answers['chat.postMessage'] = () => ({ ok: false, error: 'msg_blocks_too_long' });
    expect((await post(POST)).status).toBe(422);
    expect(failures).toHaveBeenCalledWith('[Cloud] Slack did not take a post', {
      error: expect.objectContaining({ code: 'msg_blocks_too_long' }),
      code: 'msg_blocks_too_long',
    });
    slack.answers['chat.postMessage'] = () => ({ ok: true });
    expect((await post(POST)).status).toBe(502);
    harness.handlers.unshift((call) => {
      if (call.url.startsWith('https://slack.com/api/')) throw new Error('offline');
      return new Response('', { status: 599 });
    });
    const unreachable = await post(POST);
    expect((await readJson<{ error: { message: string } }>(unreachable)).error.message).toBe(
      'Slack did not take the post (unreachable).'
    );
    harness.db.sqlite.exec('DELETE FROM slack_workspaces');
    expect((await post(POST)).status).toBe(410);
  });

  test('disconnecting removes every link of the machine, so its mentions get the link to connect again', async () => {
    const { harness, machine, slack } = await forwardedSetup();
    const removed = await harness.post(
      SLACK_RELAY_PATHS.unlink,
      {},
      { bearer: machine.machineToken, sameOrigin: false }
    );
    expect(removed.status).toBe(200);
    const links = await readJson<SlackLinks>(
      await harness.call(SLACK_RELAY_PATHS.links, {
        headers: { authorization: `Bearer ${machine.machineToken}` },
      })
    );
    expect(links.links).toEqual([]);
    await sendEvent(harness, mentionEnvelope());
    expect(slack.callsTo('chat.postEphemeral')).toHaveLength(1);
  });

  test('disconnecting and removing the machine revoke each linked person’s Slack token, whatever Slack answers', async () => {
    const { harness, session, machine, slack } = await forwardedSetup();
    answerConnectAs(slack, 'U2', 'xoxp-user-2');
    await connectSlack(harness, session, machine.instanceId);
    slack.answers['auth.revoke'] = (body) => ({ ok: false, error: 'token_revoked', ...body });
    const unlinked = await harness.post(
      SLACK_RELAY_PATHS.unlink,
      {},
      { bearer: machine.machineToken, sameOrigin: false }
    );
    expect(unlinked.status).toBe(200);
    expect(
      slack
        .callsTo('auth.revoke')
        .map((call) => call.token)
        .sort()
    ).toEqual(['xoxp-user-1', 'xoxp-user-2']);
    expect(sealedUserTokens(harness)).toEqual([]);

    answerConnectAs(slack, 'U1', 'xoxp-user-3');
    await connectSlack(harness, session, machine.instanceId);
    answerConnectAs(slack, 'U2', 'xoxp-user-4');
    await connectSlack(harness, session, machine.instanceId);
    harness.db.sqlite.exec(
      "UPDATE slack_links SET sealed_user_token = 'not-sealed' WHERE slack_user_id = 'U2'"
    );
    slack.answers['auth.revoke'] = () => ({ ok: false, error: 'ratelimited' });
    const removed = await harness.post(
      REMOTE_PATHS.machineRemove,
      {},
      { bearer: machine.machineToken, sameOrigin: false }
    );
    expect(removed.status).toBe(200);
    expect(slack.callsTo('auth.revoke').at(-1)?.token).toBe('xoxp-user-3');
    expect(slack.callsTo('auth.revoke')).toHaveLength(3);
    expect(sealedUserTokens(harness)).toEqual([]);
  });

  test('sets the thread’s status in Slack, says so when the workspace cannot show one, and fails and logs any other refusal', async () => {
    const { harness, machine, slack } = await forwardedSetup();
    const session = (body: unknown) =>
      harness.post(SLACK_RELAY_PATHS.session, body, { bearer: machine.machineToken, sameOrigin: false });
    const set = await session({ teamId: 'T1', channelId: 'C1', threadTs: '100.1', status: 'suspended' });
    expect(await set.json()).toEqual({ applied: true });
    expect(slack.callsTo('agents.sessions.setStatus').at(-1)?.body).toEqual({
      channel_id: 'C1',
      thread_ts: '100.1',
      status: 'suspended',
    });
    for (const code of ['feature_disabled', 'not_authorized']) {
      slack.answers['agents.sessions.setStatus'] = () => ({ ok: false, error: code });
      const unavailable = await session({
        teamId: 'T1',
        channelId: 'C1',
        threadTs: '100.1',
        status: 'active',
      });
      expect(await unavailable.json()).toEqual({ applied: false });
    }
    expect(failures).not.toHaveBeenCalled();
    slack.answers['agents.sessions.setStatus'] = () => ({ ok: false, error: 'channel_not_found' });
    const refused = await session({ teamId: 'T1', channelId: 'C1', threadTs: '100.1', status: 'active' });
    expect(refused.status).toBe(502);
    expect(await refused.json()).toMatchObject({ error: { code: 'slack_failed' } });
    expect(failures).toHaveBeenCalledWith('[Cloud] Slack did not take a thread status', {
      error: expect.objectContaining({ code: 'channel_not_found' }),
      teamId: 'T1',
    });
    expect((await session({ teamId: 'T1', channelId: 'C1', threadTs: '100.1', status: 'busy' })).status).toBe(
      400
    );
    expect(
      (await session({ teamId: 'T1', channelId: 'C1', threadTs: '555.1', status: 'active' })).status
    ).toBe(403);
  });

  test('moves the reaction on a mention, taking the old one off first, and says when Slack will not', async () => {
    const { harness, machine, slack } = await forwardedSetup();
    const react = (body: unknown) =>
      harness.post(SLACK_RELAY_PATHS.react, body, { bearer: machine.machineToken, sameOrigin: false });
    const target = { teamId: 'T1', channelId: 'C1', threadTs: '100.1', messageTs: '100.1' };
    const moved = await react({ ...target, add: 'white_check_mark', remove: 'hammer_and_wrench' });
    expect(await moved.json()).toEqual({ applied: true });
    expect(slack.calls.slice(-2).map((call) => [call.method, call.body])).toEqual([
      ['reactions.remove', { channel: 'C1', timestamp: '100.1', name: 'hammer_and_wrench' }],
      ['reactions.add', { channel: 'C1', timestamp: '100.1', name: 'white_check_mark' }],
    ]);
    slack.answers['reactions.add'] = () => ({ ok: false, error: 'already_reacted' });
    slack.answers['reactions.remove'] = () => ({ ok: false, error: 'no_reaction' });
    expect(await (await react({ ...target, add: 'x', remove: 'raised_hand' })).json()).toEqual({
      applied: true,
    });
    expect(await (await react({ ...target, add: null, remove: 'x' })).json()).toEqual({ applied: true });
    expect(await (await react({ ...target, add: 'x', remove: null })).json()).toEqual({ applied: true });
    slack.answers['reactions.add'] = () => ({ ok: false, error: 'missing_scope' });
    expect(await (await react({ ...target, add: 'x', remove: null })).json()).toEqual({ applied: false });
    expect((await react({ ...target, add: null, remove: null })).status).toBe(400);
    expect((await react({ ...target, threadTs: '555.1', add: 'x', remove: null })).status).toBe(403);
  });
});

describe('deciding from the card', () => {
  const CARD = {
    text: 'LOC-7: Plan ready for your approval',
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: '*Plan ready for your approval*' } },
      { type: 'actions', block_id: `${SLACK_GATE_BLOCK}.g1`, elements: [] },
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'LOC-7' }] },
    ],
  };

  const APPROVE = { gateId: 'g1', decision: 'approve', choice: null, planVersion: 2 } as const;

  const REVISE = { gateId: 'g1', decision: 'revise', choice: null, planVersion: 2 } as const;

  async function cardSetup() {
    const setup = await setUp();
    setup.slack.answers['views.open'] = () => ({ ok: true });
    await sendEvent(setup.harness, mentionEnvelope());
    const posted = await setup.harness.post(
      SLACK_RELAY_PATHS.post,
      { teamId: 'T1', channelId: 'C1', threadTs: '100.1', replaceTs: null, message: CARD },
      { bearer: setup.machine.machineToken, sameOrigin: false }
    );
    const { ts } = await readJson<{ ts: string }>(posted);
    const decisions: { url: string; body: Fields; headers: Headers }[] = [];
    const reply = {
      answer: (): Response => Response.json({ decided: true, text: 'approved the plan' }),
    };
    const replies: Fields[] = [];
    setup.harness.handlers.unshift((call) => {
      if (call.url.endsWith('.shinsa.dev/api/slack/interactions')) {
        decisions.push({ url: call.url, body: JSON.parse(call.body) as Fields, headers: call.headers });
        return reply.answer();
      }
      if (call.url.startsWith('https://hooks.slack.com/')) {
        replies.push(JSON.parse(call.body) as Fields);
        return new Response('ok');
      }
      return new Response('', { status: 599 });
    });
    return { ...setup, ts, decisions, reply, replies };
  }

  type CardSetup = Awaited<ReturnType<typeof cardSetup>>;

  async function addTeammate(setup: CardSetup, role: 'member' | 'guest' | 'stranger') {
    const { harness, slack, machine } = setup;
    answerConnectAs(slack, 'U2', 'xoxp-user-2');
    const mia = await harness.signIn('mia', 7);
    const laptop = await pairMachine(harness, mia, 'Laptop');
    await connectSlack(harness, mia, laptop.instanceId);
    await bringOnline(harness, laptop);
    if (role !== 'stranger') await grantAccess(harness, machine, mia, role);
    return laptop;
  }

  function clickPayload(ts: string, overrides: Fields = {}, action: Fields = {}) {
    return {
      type: 'block_actions',
      trigger_id: '13345.73847.8088',
      team: { id: 'T1' },
      user: { id: 'U1' },
      channel: { id: 'C1' },
      message: { ts, thread_ts: '100.1', ...CARD },
      response_url: 'https://hooks.slack.com/actions/T1/1/abc',
      actions: [
        {
          action_id: `${SLACK_DECIDE_ACTION}.approve`,
          value: serializeSlackDecisionValue(APPROVE),
          action_ts: '500.1',
          ...action,
        },
      ],
      ...overrides,
    };
  }

  function writePayload(ts: string, overrides: Fields = {}) {
    return clickPayload(ts, overrides, {
      action_id: `${SLACK_WRITE_ACTION}.revise`,
      value: serializeSlackDecisionValue(REVISE),
    });
  }

  function submitPayload(
    ts: string,
    overrides: { user?: string; metadata?: string; text?: string | null } = {}
  ) {
    const metadata =
      overrides.metadata ?? JSON.stringify({ ...REVISE, channelId: 'C1', threadTs: '100.1', messageTs: ts });
    return {
      type: 'view_submission',
      trigger_id: '777.1',
      team: { id: 'T1' },
      user: { id: overrides.user ?? 'U1' },
      view: {
        id: 'V1',
        callback_id: SLACK_MODAL_CALLBACK,
        private_metadata: metadata,
        state: {
          values: {
            [SLACK_RESPONSE_INPUT.block]: {
              [SLACK_RESPONSE_INPUT.action]: {
                value: overrides.text === undefined ? ' Use JSON ' : overrides.text,
              },
            },
          },
        },
      },
    };
  }

  async function sendInteraction(harness: Harness, payload: unknown, signature?: string) {
    const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
    const timestamp = String(Math.floor(harness.clock.now / 1000));
    const response = await harness.call(SLACK_RELAY_PATHS.interactions, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature':
          signature ?? (await createSlackSignature(TEST_CONFIG.slackSigningSecret, timestamp, body)),
      },
      body,
    });
    await harness.settle();
    return response;
  }

  test('a button reaches the machine that posted the card, signed, and the buttons become who decided', async () => {
    const { harness, machine, ts, decisions, replies } = await cardSetup();
    const response = await sendInteraction(harness, clickPayload(ts));
    expect(response.status).toBe(200);
    const [decision] = decisions;
    expect(decision?.url).toBe(`https://t-${machine.instanceId}.shinsa.dev/api/slack/interactions`);
    expect(decision?.body).toEqual({
      ...APPROVE,
      channelId: 'C1',
      threadTs: '100.1',
      messageTs: ts,
      interactionId: '13345.73847.8088',
      teamId: 'T1',
      userId: 'U1',
      response: null,
    });
    const signature = {
      signature: decision?.headers.get(SLACK_FORWARD_HEADERS.signature) ?? null,
      timestamp: decision?.headers.get(SLACK_FORWARD_HEADERS.timestamp) ?? null,
    };
    expect(
      await Effect.runPromise(
        verifySlackForwardSignature(
          machine.connectKey,
          signature,
          JSON.stringify(decision?.body),
          harness.clock.now
        )
      )
    ).toBe(true);
    expect(replies).toEqual([
      {
        replace_original: true,
        text: CARD.text,
        blocks: [
          CARD.blocks[0],
          { type: 'context', elements: [{ type: 'mrkdwn', text: '<@U1> approved the plan' }] },
          CARD.blocks[2],
        ],
      },
    ]);
  });

  test('a choice is sent as its index, and the id falls back to the action’s time', async () => {
    const setup = await cardSetup();
    const reply = { gateId: 'g1', decision: 'reply', choice: 1, planVersion: null } as const;
    await sendInteraction(
      setup.harness,
      clickPayload(
        setup.ts,
        { trigger_id: undefined },
        { action_id: `${SLACK_DECIDE_ACTION}.choice.1`, value: serializeSlackDecisionValue(reply) }
      )
    );
    expect(setup.decisions[0]?.body).toMatchObject({ ...reply, interactionId: '500.1', response: null });
  });

  test('a member of the posting machine decides on it, even linked to a machine of their own', async () => {
    const setup = await cardSetup();
    const laptop = await addTeammate(setup, 'member');
    await sendInteraction(setup.harness, clickPayload(setup.ts, { user: { id: 'U2' } }));
    expect(setup.decisions.map((decision) => decision.url)).toEqual([
      `https://t-${setup.machine.instanceId}.shinsa.dev/api/slack/interactions`,
    ]);
    expect(setup.decisions[0]?.url).not.toContain(laptop.instanceId);
    expect(setup.decisions[0]?.body.userId).toBe('U2');
  });

  test('a guest, someone without access, or someone not linked is refused privately and nothing reaches the machine', async () => {
    for (const role of ['guest', 'stranger'] as const) {
      const setup = await cardSetup();
      await addTeammate(setup, role);
      await sendInteraction(setup.harness, clickPayload(setup.ts, { user: { id: 'U2' } }));
      await sendInteraction(setup.harness, writePayload(setup.ts, { user: { id: 'U2' } }));
      await sendInteraction(setup.harness, clickPayload(setup.ts, { user: { id: 'U9' } }));
      expect(setup.decisions).toHaveLength(0);
      expect(setup.slack.callsTo('views.open')).toHaveLength(0);
      expect(setup.replies).toEqual([
        { response_type: 'ephemeral', replace_original: false, text: SLACK_DECISION_REFUSALS.noAccess },
        { response_type: 'ephemeral', replace_original: false, text: SLACK_DECISION_REFUSALS.noAccess },
        { response_type: 'ephemeral', replace_original: false, text: SLACK_DECISION_REFUSALS.notLinked },
      ]);
    }
  });

  test('a message Shinsa did not post, an offline machine and a refusal from Shinsa are told only to the clicker', async () => {
    const setup = await cardSetup();
    await sendInteraction(setup.harness, clickPayload('999.9'));
    setup.reply.answer = () =>
      Response.json({ decided: false, reason: 'This plan changed. Decide the new one.' });
    await sendInteraction(setup.harness, clickPayload(setup.ts));
    setup.reply.answer = () => new Response('', { status: 530 });
    await sendInteraction(setup.harness, clickPayload(setup.ts));
    setup.reply.answer = () => new Response('not json');
    await sendInteraction(setup.harness, clickPayload(setup.ts));
    setup.harness.clock.now += 10 * 60_000;
    await sendInteraction(setup.harness, clickPayload(setup.ts));
    const offline = 'Studio is offline, so nothing was sent. Try again once Shinsa runs there.';
    expect(setup.replies.map((reply) => reply.text)).toEqual([
      SLACK_DECISION_REFUSALS.noAccess,
      'This plan changed. Decide the new one.',
      offline,
      offline,
      offline,
    ]);
    expect(setup.decisions).toHaveLength(3);
    expect(setup.replies.every((reply) => reply.response_type === 'ephemeral')).toBe(true);
  });

  test('a written decision opens a form that carries the card, and sends nothing yet', async () => {
    const setup = await cardSetup();
    await sendInteraction(setup.harness, writePayload(setup.ts));
    expect(setup.decisions).toHaveLength(0);
    expect(setup.slack.callsTo('views.open').map((call) => call.body)).toEqual([
      {
        trigger_id: '13345.73847.8088',
        view: serializeSlackDecisionModal({
          ...REVISE,
          channelId: 'C1',
          threadTs: '100.1',
          messageTs: setup.ts,
        }),
      },
    ]);
    expect(setup.slack.callsTo('views.open')[0]?.token).toBe('xoxb-bot-token');
    const sent = setup.slack.callsTo('views.open')[0]?.body as {
      view: { private_metadata: string; blocks: unknown[] };
    };
    expect(sent.view.blocks).toEqual([
      expect.objectContaining({
        element: expect.objectContaining({ max_length: SLACK_VIEW_LIMITS.input }),
      }),
    ]);
    expect(SLACK_VIEW_LIMITS.input).toBe(3000);
    expect(sent.view.private_metadata.length).toBeLessThanOrEqual(SLACK_VIEW_LIMITS.privateMetadata);
  });

  test('a form Slack will not open is told to the clicker and logged', async () => {
    const setup = await cardSetup();
    setup.slack.answers['views.open'] = () => ({ ok: false, error: 'expired_trigger_id' });
    await sendInteraction(setup.harness, writePayload(setup.ts));
    expect(setup.replies.map((reply) => reply.text)).toEqual([SLACK_DECISION_REFUSALS.formFailed]);
    expect(failures).toHaveBeenCalled();
  });

  test('a submitted form is decided with its words, and closes with nothing more to say', async () => {
    const setup = await cardSetup();
    const response = await sendInteraction(setup.harness, submitPayload(setup.ts));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(setup.decisions.map((decision) => decision.body)).toEqual([
      {
        ...REVISE,
        channelId: 'C1',
        threadTs: '100.1',
        messageTs: setup.ts,
        interactionId: '777.1',
        teamId: 'T1',
        userId: 'U1',
        response: 'Use JSON',
      },
    ]);
    expect(setup.slack.callsTo('chat.postEphemeral')).toHaveLength(0);
    expect(setup.replies).toHaveLength(0);
  });

  test('a submitted form that is refused tells only its author, in the thread', async () => {
    const setup = await cardSetup();
    setup.reply.answer = () => Response.json({ decided: false, reason: 'This is no longer open.' });
    await sendInteraction(setup.harness, submitPayload(setup.ts));
    await sendInteraction(setup.harness, submitPayload(setup.ts, { user: 'U9' }));
    expect(setup.decisions).toHaveLength(1);
    expect(setup.slack.callsTo('chat.postEphemeral').map((call) => call.body)).toEqual([
      { channel: 'C1', user: 'U1', thread_ts: '100.1', text: 'This is no longer open.' },
      { channel: 'C1', user: 'U9', thread_ts: '100.1', text: SLACK_DECISION_REFUSALS.notLinked },
    ]);
  });

  test('a link button, a written decision without its form, another form or a reply address off Slack does nothing', async () => {
    const setup = await cardSetup();
    const open = { action_id: 'shinsa.open', value: serializeSlackDecisionValue(APPROVE) };
    expect((await sendInteraction(setup.harness, clickPayload(setup.ts, {}, open))).status).toBe(200);
    await sendInteraction(
      setup.harness,
      clickPayload(setup.ts, {}, { action_id: `${SLACK_WRITE_ACTION}.approve` })
    );
    await sendInteraction(setup.harness, writePayload(setup.ts, { trigger_id: undefined }));
    await sendInteraction(setup.harness, clickPayload(setup.ts, {}, { value: 'nope' }));
    await sendInteraction(setup.harness, clickPayload(setup.ts, { response_url: 'https://evil.test/x' }));
    await sendInteraction(setup.harness, clickPayload(setup.ts, { channel: {}, team: 'T1', user: null }));
    const other = submitPayload(setup.ts);
    await sendInteraction(setup.harness, { ...other, view: { ...other.view, callback_id: 'other' } });
    await sendInteraction(setup.harness, submitPayload(setup.ts, { metadata: '{"gateId":1}' }));
    await sendInteraction(setup.harness, submitPayload(setup.ts, { text: '   ' }));
    await sendInteraction(setup.harness, submitPayload(setup.ts, { text: null }));
    await sendInteraction(setup.harness, 'noise');
    expect(setup.decisions).toHaveLength(0);
    expect(setup.replies).toHaveLength(0);
    expect(setup.slack.callsTo('views.open')).toHaveLength(0);
  });

  test('is refused unsigned, too large or not JSON, and a failed reply is logged', async () => {
    const setup = await cardSetup();
    expect((await sendInteraction(setup.harness, clickPayload(setup.ts), 'v0=forged')).status).toBe(401);
    const large = await setup.harness.call(SLACK_RELAY_PATHS.interactions, {
      method: 'POST',
      body: 'x'.repeat(SLACK_EVENT_BODY_LIMIT_BYTES + 1),
    });
    expect(large.status).toBe(413);
    const body = 'payload=%7Bnope';
    const timestamp = String(Math.floor(setup.harness.clock.now / 1000));
    const broken = await setup.harness.call(SLACK_RELAY_PATHS.interactions, {
      method: 'POST',
      headers: {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': await createSlackSignature(TEST_CONFIG.slackSigningSecret, timestamp, body),
      },
      body,
    });
    expect(broken.status).toBe(400);
    setup.harness.handlers.unshift((call) =>
      call.url.startsWith('https://hooks.slack.com/')
        ? Promise.reject(new Error('down'))
        : new Response('', { status: 599 })
    );
    await sendInteraction(setup.harness, clickPayload(setup.ts));
    setup.reply.answer = () => Response.json({ decided: false, reason: 'This is no longer open.' });
    setup.slack.answers['chat.postEphemeral'] = () => ({ ok: false, error: 'channel_not_found' });
    await sendInteraction(setup.harness, submitPayload(setup.ts));
    const logged = (failures.mock.calls as [string, Fields][]).filter(
      ([text]) => text === '[Cloud] A Slack decision could not be passed on'
    );
    expect(logged.map(([, fields]) => [fields.kind, fields.teamId])).toEqual([
      ['decide', 'T1'],
      ['submit', 'T1'],
    ]);
  });
});

interface ChannelSetup extends Setup {
  messages: { instanceId: string; body: string; headers: Headers }[];
  messageTunnel: { answer: () => Response };
  watch: (watches: { teamId: string; channelId: string }[], bearer?: string) => Promise<Response>;
}

function watchedChannels(harness: Harness) {
  return harness.db.sqlite
    .query('SELECT workspace_id, channel_id FROM slack_channel_watches ORDER BY workspace_id, channel_id')
    .all() as { workspace_id: string; channel_id: string }[];
}

async function setUpChannel(): Promise<ChannelSetup> {
  const setup = await setUp();
  const messages: ChannelSetup['messages'] = [];
  const messageTunnel = { answer: () => Response.json({ ok: true }, { status: 202 }) };
  setup.harness.handlers.push((call) => {
    const url = new URL(call.url);
    if (!url.hostname.endsWith('.shinsa.dev') || url.pathname !== SLACK_ENGINE_MESSAGES_PATH)
      return new Response('', { status: 599 });
    messages.push({
      instanceId: url.hostname.slice(2, -'.shinsa.dev'.length),
      body: call.body,
      headers: call.headers,
    });
    return messageTunnel.answer();
  });
  const watch: ChannelSetup['watch'] = (watches, bearer = setup.machine.machineToken) =>
    setup.harness.post(SLACK_RELAY_PATHS.watches, { watches }, { bearer, sameOrigin: false });
  await bringOnline(setup.harness, setup.machine, ['slack-channel-triggers']);
  await watch([{ teamId: 'T1', channelId: 'C1' }]);
  return { ...setup, messages, messageTunnel, watch };
}

function messageEnvelope(event: Fields = {}, envelope: Fields = {}) {
  return {
    type: 'event_callback',
    team_id: 'T1',
    event_id: `Ev${++eventCount}`,
    event: {
      type: 'message',
      channel: 'C1',
      channel_type: 'channel',
      user: 'U2',
      ts: '200.1',
      text: 'Checkout is down, <@U1> can you look? <https://status.acme.dev|status>',
      ...event,
    },
    ...envelope,
  };
}

describe('the channels a machine may set a trigger on', () => {
  const readChannels = (harness: Harness, machine: MachineCredentials) =>
    harness.call(SLACK_RELAY_PATHS.channels, {
      headers: { authorization: `Bearer ${machine.machineToken}` },
    });

  test('are the ones the bot is in, in each workspace the machine is linked to, read page by page', async () => {
    const { harness, slack, machine } = await setUp();
    slack.answers['users.conversations'] = (body) => {
      if (body.types === 'private_channel')
        return { ok: true, channels: [{ id: 'G3', name: 'ops', is_private: true }] };
      if (body.cursor === 'next-1')
        return { ok: true, channels: [{ id: 'G3', name: 'ops', is_private: true }] };
      return {
        ok: true,
        channels: [
          { id: 'C1', name: 'alerts', is_private: false },
          { id: 'C2', name: 'feedback' },
        ],
        response_metadata: { next_cursor: 'next-1' },
      };
    };
    const channels = await readJson<SlackChannels>(await readChannels(harness, machine));
    const acme = { teamId: 'T1', teamName: 'Acme' };
    expect(channels.channels).toEqual([
      { ...acme, channelId: 'C1', channelName: 'alerts', private: false },
      { ...acme, channelId: 'C2', channelName: 'feedback', private: false },
      { ...acme, channelId: 'G3', channelName: 'ops', private: true },
    ]);
    const [first, second, asPerson] = slack.callsTo('users.conversations');
    expect([asPerson?.token, asPerson?.body.types]).toEqual(['xoxp-user-1', 'private_channel']);
    expect(first?.token).toBe('xoxb-bot-token');
    expect(first?.body).toEqual({
      types: 'public_channel,private_channel',
      exclude_archived: 'true',
      limit: '200',
    });
    expect(second?.body.cursor).toBe('next-1');
  });

  test('leave out a private channel no person linked to the machine is a member of', async () => {
    const { harness, slack, machine } = await setUp();
    const warnings = spyOn(console, 'warn').mockImplementation(() => undefined);
    const listed = await readJson<SlackChannels>(await readChannels(harness, machine));
    expect(listed.channels.map((channel) => channel.channelId)).toEqual(['C1', 'C2', 'G3']);
    slack.answers['users.conversations'] = (body) =>
      body.types === 'private_channel'
        ? { ok: false, error: 'token_revoked' }
        : {
            ok: true,
            channels: [
              { id: 'C1', name: 'alerts' },
              { id: 'G3', name: 'ops', is_private: true },
            ],
          };
    const withoutAccess = await readJson<SlackChannels>(await readChannels(harness, machine));
    expect(withoutAccess.channels.map((channel) => channel.channelId)).toEqual(['C1']);
    expect(warnings).toHaveBeenCalledWith(
      '[Cloud] Slack did not list a linked person’s private channels',
      expect.objectContaining({ code: 'token_revoked', teamId: 'T1' })
    );
    warnings.mockRestore();
    harness.db.sqlite.run('UPDATE slack_links SET sealed_user_token = NULL');
    slack.calls.length = 0;
    const withoutToken = await readJson<SlackChannels>(await readChannels(harness, machine));
    expect(withoutToken.channels.map((channel) => channel.channelId)).toEqual(['C1']);
    expect(slack.callsTo('users.conversations').map((call) => call.token)).toEqual(['xoxb-bot-token']);
  });

  test('ask as no person when the bot is in public channels only', async () => {
    const { harness, slack, machine } = await setUp();
    slack.answers['users.conversations'] = () => ({ ok: true, channels: [{ id: 'C1', name: 'alerts' }] });
    await readChannels(harness, machine);
    expect(slack.callsTo('users.conversations').map((call) => call.token)).toEqual(['xoxb-bot-token']);
  });

  test('are none when Slack lists none or the machine is not linked, and a refusal from Slack is said and logged', async () => {
    const { harness, slack, machine, session } = await setUp();
    slack.answers['users.conversations'] = () => ({ ok: true });
    expect(await readJson<SlackChannels>(await readChannels(harness, machine))).toEqual({ channels: [] });
    const laptop = await pairMachine(harness, session, 'Laptop');
    expect(await readJson<SlackChannels>(await readChannels(harness, laptop))).toEqual({ channels: [] });
    expect(slack.callsTo('users.conversations')).toHaveLength(1);
    slack.answers['users.conversations'] = () => ({ ok: false, error: 'missing_scope' });
    const refused = await readChannels(harness, machine);
    expect(refused.status).toBe(502);
    expect((await readJson<{ error: { message: string } }>(refused)).error.message).toBe(
      'Slack did not list the channels (missing_scope).'
    );
    expect(failures).toHaveBeenCalledWith(
      '[Cloud] Slack did not list the channels',
      expect.objectContaining({ code: 'missing_scope', teamId: 'T1' })
    );
  });
});

describe('the channels a machine watches', () => {
  test('are replaced as a whole, keep only channels it may set a trigger on, and go when it disconnects Slack', async () => {
    const { harness, machine, watch, slack } = await setUpChannel();
    const replaced = await watch([
      { teamId: 'T1', channelId: 'C2' },
      { teamId: 'T1', channelId: 'C2' },
      { teamId: 'T1', channelId: 'G3' },
      { teamId: 'T1', channelId: 'G4' },
      { teamId: 'T1', channelId: 'C404' },
      { teamId: 'T9', channelId: 'C1' },
    ]);
    expect([replaced.status, await replaced.json()]).toEqual([200, { ok: true }]);
    expect(watchedChannels(harness)).toEqual([
      { workspace_id: 'T1', channel_id: 'C2' },
      { workspace_id: 'T1', channel_id: 'G3' },
    ]);
    await harness.post(SLACK_RELAY_PATHS.unlink, {}, { bearer: machine.machineToken, sameOrigin: false });
    expect(watchedChannels(harness)).toEqual([]);
    await watch([{ teamId: 'T1', channelId: 'C2' }]);
    expect(watchedChannels(harness)).toEqual([]);
    slack.calls.length = 0;
    await watch([]);
    expect(slack.callsTo('users.conversations')).toHaveLength(0);
  });

  test('stay as they were when Slack does not list the channels', async () => {
    const { harness, watch, slack } = await setUpChannel();
    slack.answers['users.conversations'] = () => ({ ok: false, error: 'ratelimited' });
    expect((await watch([{ teamId: 'T1', channelId: 'C2' }])).status).toBe(502);
    expect(watchedChannels(harness)).toEqual([{ workspace_id: 'T1', channel_id: 'C1' }]);
  });

  test('are refused without the machine token, as a list it does not understand, or past the limit', async () => {
    const { harness, watch } = await setUpChannel();
    expect((await watch([{ teamId: 'T1', channelId: 'C2' }], 'forged')).status).toBe(401);
    expect((await watch([{ teamId: 'T 1', channelId: 'C2' }])).status).toBe(400);
    const many = Array.from({ length: 101 }, (_, index) => ({ teamId: 'T1', channelId: `C${index}` }));
    expect((await watch(many)).status).toBeGreaterThanOrEqual(400);
    expect(watchedChannels(harness)).toEqual([{ workspace_id: 'T1', channel_id: 'C1' }]);
  });

  test('go with the app when it is removed from the workspace', async () => {
    const { harness } = await setUpChannel();
    await sendEvent(harness, mentionEnvelope({ type: 'app_uninstalled' }));
    expect(watchedChannels(harness)).toEqual([]);
  });
});

describe('a message in a watched channel', () => {
  test('reaches the watching machine signed with its connect key, as readable text with who wrote it and its link', async () => {
    const { harness, machine, messages, forwards, slack } = await setUpChannel();
    expect((await sendEvent(harness, messageEnvelope({}, { event_id: 'EvChannel' }))).status).toBe(200);
    expect(messages).toHaveLength(1);
    const [forward] = messages;
    expect(forward?.instanceId).toBe(machine.instanceId);
    const signature = {
      signature: forward?.headers.get(SLACK_FORWARD_HEADERS.signature) ?? null,
      timestamp: forward?.headers.get(SLACK_FORWARD_HEADERS.timestamp) ?? null,
    };
    expect(
      await Effect.runPromise(
        verifySlackForwardSignature(machine.connectKey, signature, forward?.body ?? '', harness.clock.now)
      )
    ).toBe(true);
    expect(JSON.parse(forward?.body ?? '') as SlackChannelMessage).toEqual({
      eventId: 'EvChannel',
      teamId: 'T1',
      channelId: 'C1',
      messageTs: '200.1',
      userId: 'U2',
      userName: 'Mia',
      bot: false,
      text: 'Checkout is down, @Christo can you look? status (https://status.acme.dev)',
      permalink: 'https://acme.slack.com/archives/C1/p200.1',
      channelName: 'support',
    });
    expect(forwards).toHaveLength(0);
    expect(slack.callsTo('chat.postMessage')).toHaveLength(0);
    expect(harness.db.sqlite.query('SELECT COUNT(*) AS n FROM slack_threads').get()).toEqual({ n: 0 });
  });

  test('from a bot, such as an alert, is read from its blocks and attachments and named after the bot', async () => {
    const { harness, messages } = await setUpChannel();
    await sendEvent(
      harness,
      messageEnvelope({
        user: undefined,
        subtype: 'bot_message',
        bot_id: 'B7',
        bot_profile: { name: 'Sentry' },
        ts: '200.2',
        thread_ts: '200.2',
        text: 'New issue',
        attachments: [{ title: 'TypeError in checkout', text: 'Cannot read properties of undefined' }],
      })
    );
    expect(JSON.parse(messages[0]?.body ?? '')).toMatchObject({
      messageTs: '200.2',
      userId: 'B7',
      userName: 'Sentry',
      bot: true,
      text: 'New issue\n\nTypeError in checkout\nCannot read properties of undefined',
    });
  });

  test('with a file, or from someone Slack will not name, still reaches the machine, named by their id', async () => {
    const { harness, messages } = await setUpChannel();
    await sendEvent(
      harness,
      messageEnvelope({ subtype: 'file_share', user: 'U9', text: 'See the screenshot' })
    );
    expect(JSON.parse(messages[0]?.body ?? '')).toMatchObject({ userId: 'U9', userName: 'U9', bot: false });
  });

  test('never fires for a thread reply, an edit, a join, Shinsa’s own post, a mention of Shinsa, another channel or a redelivery', async () => {
    const { harness, messages, slack } = await setUpChannel();
    await sendEvent(harness, messageEnvelope({ thread_ts: '150.1' }));
    await sendEvent(harness, messageEnvelope({ subtype: 'message_changed' }));
    await sendEvent(harness, messageEnvelope({ subtype: 'channel_join' }));
    await sendEvent(harness, messageEnvelope({ subtype: 'thread_broadcast', thread_ts: '150.1' }));
    await sendEvent(harness, messageEnvelope({ user: 'B0T', bot_id: 'B1', text: 'Planning' }));
    await sendEvent(harness, messageEnvelope({ user: undefined }));
    await sendEvent(harness, messageEnvelope({ text: '<@B0T> fix the build' }));
    await sendEvent(harness, messageEnvelope({ channel: 'C2' }));
    await sendEvent(harness, messageEnvelope({}, { team_id: 'T9' }));
    expect(messages).toHaveLength(0);
    expect(slack.callsTo('chat.getPermalink')).toHaveLength(0);
    const envelope = messageEnvelope();
    await sendEvent(harness, envelope);
    await sendEvent(harness, envelope);
    expect(messages).toHaveLength(1);
  });

  test('is not sent to a machine whose Shinsa does not take channel messages, or one that is offline', async () => {
    const { harness, machine, messages, slack } = await setUpChannel();
    const before = slack.calls.length;
    await bringOnline(harness, machine, ['slack-task-owner']);
    await sendEvent(harness, messageEnvelope());
    expect(messages).toHaveLength(0);
    await bringOnline(harness, machine, ['slack-channel-triggers']);
    await harness.post(REMOTE_PATHS.offline, {}, { bearer: machine.machineToken, sameOrigin: false });
    await sendEvent(harness, messageEnvelope());
    expect(messages).toHaveLength(0);
    expect(slack.calls).toHaveLength(before);
  });

  test('reaches every machine that watches the channel, and no longer one whose Slack link moved away', async () => {
    const { harness, slack, machine, messages, watch } = await setUpChannel();
    answerConnectAs(slack, 'U2', 'xoxp-user-2');
    const mia = await harness.signIn('mia', 7);
    const laptop = await pairMachine(harness, mia, 'Laptop');
    await connectSlack(harness, mia, laptop.instanceId);
    await bringOnline(harness, laptop, ['slack-channel-triggers']);
    await watch([{ teamId: 'T1', channelId: 'C1' }], laptop.machineToken);
    await sendEvent(harness, messageEnvelope());
    expect(messages.map((message) => message.instanceId).sort()).toEqual(
      [machine.instanceId, laptop.instanceId].sort()
    );
    harness.db.sqlite.exec(`UPDATE slack_links SET machine_id = '${laptop.instanceId}'`);
    messages.length = 0;
    await sendEvent(harness, messageEnvelope({ ts: '200.3' }));
    expect(messages.map((message) => message.instanceId)).toEqual([laptop.instanceId]);
  });

  test('whose tunnel does not answer is a warning, one the machine refuses is logged, and nothing is said in the channel', async () => {
    const { harness, machine, messageTunnel, slack } = await setUpChannel();
    const warnings = spyOn(console, 'warn').mockImplementation(() => undefined);
    messageTunnel.answer = () => new Response('', { status: 530 });
    await sendEvent(harness, messageEnvelope());
    expect(warnings).toHaveBeenCalledWith(
      '[Cloud] Machine offline',
      expect.objectContaining({ surface: 'slack', instanceId: machine.instanceId, status: 530 })
    );
    warnings.mockRestore();
    expect(failures).not.toHaveBeenCalled();
    messageTunnel.answer = () => new Response('', { status: 401 });
    await sendEvent(harness, messageEnvelope());
    expect(failures).toHaveBeenCalledWith('[Cloud] A machine refused a Slack channel message', {
      instanceId: machine.instanceId,
      status: 401,
    });
    expect(slack.callsTo('chat.postMessage')).toHaveLength(0);
    expect(slack.callsTo('chat.postEphemeral')).toHaveLength(0);
  });

  test('that fails part way is logged, and Slack still gets its answer at once', async () => {
    const { harness, messages } = await setUpChannel();
    harness.db.sqlite.exec("UPDATE slack_workspaces SET sealed_bot_token = 'unreadable'");
    const response = await sendEvent(harness, messageEnvelope({}, { event_id: 'EvBroken' }));
    expect(response.status).toBe(200);
    expect(failures).toHaveBeenCalledWith(
      '[Cloud] A Slack channel message could not be forwarded',
      expect.objectContaining({ teamId: 'T1', eventId: 'EvBroken' })
    );
    expect(messages).toHaveLength(0);
  });
});
