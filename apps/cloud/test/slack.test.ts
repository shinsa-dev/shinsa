import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type MachineCredentials,
  type PairPollResponse,
  type PairStartResponse,
  REMOTE_KEY_ALGORITHM,
  REMOTE_PATHS,
  resolvePairApprovePath,
  SLACK_ANSWER_ACTION,
  SLACK_FORWARD_HEADERS,
  SLACK_QUESTION_BLOCK,
  SLACK_RELAY_PATHS,
  type SlackLinks,
  type SlackMention,
  serializePublicKey,
  serializeSlackAnswerValue,
  verifySlackForwardSignature,
} from '@shinsa/core';
import { createSlackSignature } from '../src/crypto.ts';
import { SLACK_EVENT_BODY_LIMIT_BYTES } from '../src/slack.ts';
import { SLACK_BOT_SCOPES, SLACK_USER_SCOPES } from '../src/slack-api.ts';
import { createHarness, type Harness, readJson, TEST_CONFIG } from './harness.ts';

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
    'openid.connect.token': () => ({ ok: true, access_token: 'xoxp-user' }),
    'openid.connect.userInfo': () => ({
      ok: true,
      'https://slack.com/team_id': 'T1',
      'https://slack.com/user_id': 'U1',
      'https://slack.com/team_name': 'Acme',
      name: 'Christo T',
    }),
    'oauth.v2.access': () => ({
      ok: true,
      access_token: 'xoxb-bot-token',
      bot_user_id: 'B0T',
      team: { id: 'T1', name: 'Acme' },
      authed_user: { id: 'U1' },
    }),
    'users.info': (body) => {
      if (body.user === 'U5') return { ok: true, user: { name: 'sam', profile: { real_name: 'Sam Real' } } };
      if (body.user === 'U6') return { ok: true, user: { name: 'kit', profile: {} } };
      const name = NAMES[String(body.user)];
      return name
        ? { ok: true, user: { name: 'x', profile: { display_name: name } } }
        : { ok: false, error: 'user_not_found' };
    },
    'conversations.replies': () => ({ ok: true, messages: [] }),
    'chat.getPermalink': (body) => ({
      ok: true,
      permalink: `https://acme.slack.com/archives/C1/p${body.message_ts}`,
    }),
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

async function pairMachine(harness: Harness, session: string, name = 'Studio') {
  const pair = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, ['deriveBits'])) as CryptoKeyPair;
  const start = await readJson<PairStartResponse>(
    await harness.post(REMOTE_PATHS.pairStart, {
      name,
      publicKey: await serializePublicKey(pair.publicKey),
      version: '1',
    })
  );
  await harness.post(resolvePairApprovePath(start.claimCode), {}, { session });
  const claimed = await readJson<PairPollResponse>(
    await harness.post(REMOTE_PATHS.pairPoll, { claimCode: start.claimCode, pollSecret: start.pollSecret })
  );
  if (claimed.status !== 'claimed') throw new Error('Pairing was not claimed.');
  return claimed.credentials;
}

async function bringOnline(harness: Harness, machine: MachineCredentials) {
  await harness.post(
    REMOTE_PATHS.heartbeat,
    { localUrl: 'http://127.0.0.1:7446' },
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
    'oidc'
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
    expect(authorize.origin + authorize.pathname).toBe('https://slack.com/openid/connect/authorize');
    expect(authorize.searchParams.get('scope')).toBe('openid profile');
    expect(authorize.searchParams.get('redirect_uri')).toBe(
      `${TEST_CONFIG.origin}${SLACK_RELAY_PATHS.connectCallback}`
    );
    const identified = await followAuthorize(
      harness,
      session,
      start,
      SLACK_RELAY_PATHS.connectCallback,
      'oidc'
    );
    const install = readLocation(identified);
    expect(install.origin + install.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(install.searchParams.get('team')).toBe('T1');
    expect(install.searchParams.get('scope')).toBe(
      'app_mentions:read,channels:history,groups:history,chat:write,reactions:write,users:read'
    );
    const linked = await followAuthorize(
      harness,
      session,
      identified,
      SLACK_RELAY_PATHS.installCallback,
      'install'
    );
    expect(linked.headers.get('location')).toBe('/slack/linked?team=Acme');
    expect(readSetCookie(linked, '__Host-shinsa_slack')).toBe('__Host-shinsa_slack=');
    expect(slack.callsTo('oauth.v2.access')[0]?.body.client_secret).toBe(TEST_CONFIG.slackClientSecret);
    const stored = harness.db.sqlite.query('SELECT bot_token FROM slack_workspaces').get() as {
      bot_token: string;
    };
    expect(stored.bot_token).not.toContain('xoxb');
    const links = await readJson<SlackLinks>(
      await harness.call(SLACK_RELAY_PATHS.links, {
        headers: { authorization: `Bearer ${machine.machineToken}` },
      })
    );
    expect(links.links).toEqual([
      { teamId: 'T1', teamName: 'Acme', userId: 'U1', userName: 'Christo', linkedAt: harness.clock.now },
    ]);
  });

  test('a teammate in a workspace that has the app links without adding it again, to their own machine', async () => {
    const { harness, slack } = await setUp();
    slack.answers['openid.connect.userInfo'] = () => ({
      ok: true,
      'https://slack.com/team_id': 'T1',
      'https://slack.com/user_id': 'U2',
      name: 'Mia',
    });
    const mia = await harness.signIn('mia', 7);
    const laptop = await pairMachine(harness, mia, 'Laptop');
    const linked = await connectSlack(harness, mia, laptop.instanceId);
    expect(linked.headers.get('location')).toBe('/slack/linked?team=Acme');
    expect(slack.callsTo('oauth.v2.access')).toHaveLength(1);
    const links = await readJson<SlackLinks>(
      await harness.call(SLACK_RELAY_PATHS.links, {
        headers: { authorization: `Bearer ${laptop.machineToken}` },
      })
    );
    expect(links.links.map((link) => [link.userId, link.userName])).toEqual([['U2', 'Mia']]);
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
      'oidc'
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
    expect(slack.callsTo('oauth.v2.access')).toHaveLength(1);
    harness.handlers.unshift((call) =>
      call.url.endsWith('/api/auth.test')
        ? Promise.reject(new Error('offline'))
        : Promise.resolve(new Response('', { status: 599 }))
    );
    expect((await connectSlack(harness, session, machine.instanceId)).headers.get('location')).toBe(
      '/slack/linked?team=Acme'
    );
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

    slack.answers['openid.connect.token'] = () => ({ ok: false, error: 'invalid_code' });
    expect(
      reasonOf(await followAuthorize(harness, session, await begin(), SLACK_RELAY_PATHS.connectCallback, 'c'))
    ).toBe('slack_failed');
    slack.answers['openid.connect.token'] = () => ({ ok: true });
    expect(
      reasonOf(await followAuthorize(harness, session, await begin(), SLACK_RELAY_PATHS.connectCallback, 'c'))
    ).toBe('slack_failed');
    slack.answers['openid.connect.token'] = () => ({ ok: true, access_token: 'xoxp' });
    slack.answers['openid.connect.userInfo'] = () => ({ ok: true });
    expect(
      reasonOf(await followAuthorize(harness, session, await begin(), SLACK_RELAY_PATHS.connectCallback, 'c'))
    ).toBe('slack_failed');
  });

  test('an install Slack answers without a bot is refused, and an unreadable store fails as a server error', async () => {
    const harness = createHarness();
    const slack = createFakeSlack(harness);
    const session = await harness.signIn();
    const machine = await pairMachine(harness, session);
    slack.answers['oauth.v2.access'] = () => ({ ok: true, team: { id: 'T1' }, authed_user: { id: 'U1' } });
    const refused = await connectSlack(harness, session, machine.instanceId);
    expect(refused.headers.get('location')).toBe('/slack/linked?error=slack_failed');

    slack.answers['oauth.v2.access'] = () => ({
      ok: true,
      access_token: 'xoxb',
      bot_user_id: 'B0T',
      team: { id: 'T1' },
      authed_user: { id: 'U9' },
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
    const { harness } = await setUp();
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

  test('removing the app forgets the workspace and every link in it; a revoked user token alone keeps it', async () => {
    const { harness } = await setUp();
    const count = () =>
      harness.db.sqlite.query('SELECT COUNT(*) AS n FROM slack_links').get() as { n: number };
    await sendEvent(harness, mentionEnvelope({ type: 'tokens_revoked', tokens: { oauth: ['U1'] } }));
    await sendEvent(harness, mentionEnvelope({ type: 'tokens_revoked' }));
    expect(count().n).toBe(1);
    await sendEvent(harness, mentionEnvelope({ type: 'tokens_revoked', tokens: { bot: ['B0T'] } }));
    expect(count().n).toBe(0);
    const { harness: other } = await setUp();
    await sendEvent(other, mentionEnvelope({ type: 'app_uninstalled' }));
    expect(other.db.sqlite.query('SELECT COUNT(*) AS n FROM slack_workspaces').get()).toEqual({ n: 0 });
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
    const { harness, machine, forwards } = await setUp();
    await sendEvent(harness, mentionEnvelope({ text: '<@B0T> ask <@U2> about <#C2|ops>' }));
    expect(forwards).toHaveLength(1);
    const [forward] = forwards;
    const signature = {
      signature: forward?.headers.get(SLACK_FORWARD_HEADERS.signature) ?? null,
      timestamp: forward?.headers.get(SLACK_FORWARD_HEADERS.timestamp) ?? null,
    };
    expect(
      await verifySlackForwardSignature(machine.connectKey, signature, forward?.body ?? '', harness.clock.now)
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
    });
    expect(mention.thread).toEqual([
      { ts: '100.1', userId: 'U1', userName: 'Christo', text: 'ask @Mia about #ops', bot: false },
    ]);
    expect(harness.db.sqlite.query('SELECT thread_ts FROM slack_threads').all()).toEqual([
      { thread_ts: '100.1' },
    ]);
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
    await sendEvent(harness, mentionEnvelope({ ts: '90.9', thread_ts: '90.1' }));
    const mention = JSON.parse(forwards[0]?.body ?? '') as SlackMention;
    expect(slack.callsTo('conversations.replies')[0]?.body).toMatchObject({ channel: 'C1', ts: '90.1' });
    expect(mention.threadTs).toBe('90.1');
    expect(mention.permalink).toBeNull();
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

describe('a click on a question’s choice', () => {
  const QUESTION = {
    text: 'LOC-7 asks: Which format?',
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'Question for you' } },
      { type: 'actions', block_id: `${SLACK_QUESTION_BLOCK}.q1`, elements: [] },
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'LOC-7' }] },
    ],
  };

  async function questionSetup() {
    const setup = await setUp();
    await sendEvent(setup.harness, mentionEnvelope());
    const posted = await setup.harness.post(
      SLACK_RELAY_PATHS.post,
      { teamId: 'T1', channelId: 'C1', threadTs: '100.1', replaceTs: null, message: QUESTION },
      { bearer: setup.machine.machineToken, sameOrigin: false }
    );
    const { ts } = await readJson<{ ts: string }>(posted);
    const answers: { body: Fields; headers: Headers }[] = [];
    const reply = { answer: (): Response => Response.json({ answered: true, choice: 'JSON' }) };
    const replies: Fields[] = [];
    setup.harness.handlers.unshift((call) => {
      if (call.url.endsWith('.shinsa.dev/api/slack/interactions')) {
        answers.push({ body: JSON.parse(call.body) as Fields, headers: call.headers });
        return reply.answer();
      }
      if (call.url.startsWith('https://hooks.slack.com/')) {
        replies.push(JSON.parse(call.body) as Fields);
        return new Response('ok');
      }
      return new Response('', { status: 599 });
    });
    return { ...setup, ts, answers, reply, replies };
  }

  function clickPayload(ts: string, overrides: Fields = {}) {
    return {
      type: 'block_actions',
      trigger_id: '13345.73847.8088',
      team: { id: 'T1' },
      user: { id: 'U1' },
      channel: { id: 'C1' },
      message: { ts, thread_ts: '100.1', ...QUESTION },
      response_url: 'https://hooks.slack.com/actions/T1/1/abc',
      actions: [
        {
          action_id: `${SLACK_ANSWER_ACTION}.1`,
          value: serializeSlackAnswerValue('q1', 1),
          action_ts: '500.1',
        },
      ],
      ...overrides,
    };
  }

  async function sendClick(harness: Harness, payload: unknown, signature?: string) {
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

  test('reaches the asker’s machine signed, and swaps the buttons for who answered', async () => {
    const { harness, machine, ts, answers, replies } = await questionSetup();
    const response = await sendClick(harness, clickPayload(ts));
    expect(response.status).toBe(200);
    const [answer] = answers;
    expect(answer?.body).toEqual({
      interactionId: '13345.73847.8088',
      teamId: 'T1',
      channelId: 'C1',
      threadTs: '100.1',
      messageTs: ts,
      userId: 'U1',
      gateId: 'q1',
      choice: 1,
    });
    const signature = {
      signature: answer?.headers.get(SLACK_FORWARD_HEADERS.signature) ?? null,
      timestamp: answer?.headers.get(SLACK_FORWARD_HEADERS.timestamp) ?? null,
    };
    expect(
      await verifySlackForwardSignature(
        machine.connectKey,
        signature,
        JSON.stringify(answer?.body),
        harness.clock.now
      )
    ).toBe(true);
    expect(replies).toEqual([
      {
        replace_original: true,
        text: QUESTION.text,
        blocks: [
          QUESTION.blocks[0],
          { type: 'context', elements: [{ type: 'mrkdwn', text: '<@U1> answered *JSON*' }] },
          QUESTION.blocks[2],
        ],
      },
    ]);
  });

  test('that Shinsa refuses tells only the person who clicked why', async () => {
    const setup = await questionSetup();
    setup.reply.answer = () => Response.json({ answered: false, reason: 'This question is no longer open.' });
    await sendClick(setup.harness, clickPayload(setup.ts));
    expect(setup.replies).toEqual([
      { response_type: 'ephemeral', replace_original: false, text: 'This question is no longer open.' },
    ]);
  });

  test('from someone not linked, on a post another machine made, or while the machine is offline, is refused privately', async () => {
    const setup = await questionSetup();
    await sendClick(setup.harness, clickPayload(setup.ts, { user: { id: 'U2' } }));
    await sendClick(setup.harness, clickPayload('999.9'));
    setup.reply.answer = () => new Response('', { status: 530 });
    await sendClick(setup.harness, clickPayload(setup.ts));
    setup.reply.answer = () => new Response('not json');
    await sendClick(setup.harness, clickPayload(setup.ts, { trigger_id: undefined }));
    expect(setup.replies.map((reply) => reply.text)).toEqual([
      'Connect Slack to your own Shinsa first, then answer it in Shinsa.',
      'This question was asked on someone else’s machine, so only they can answer it.',
      'Studio is offline, so the answer was not sent. Try again once Shinsa runs there.',
      'Studio is offline, so the answer was not sent. Try again once Shinsa runs there.',
    ]);
    expect(setup.answers.at(-1)?.body.interactionId).toBe('500.1');
    expect(setup.replies.every((reply) => reply.response_type === 'ephemeral')).toBe(true);
  });

  test('on a machine that stopped heartbeating is refused without asking it', async () => {
    const setup = await questionSetup();
    setup.harness.clock.now += 10 * 60_000;
    await sendClick(setup.harness, clickPayload(setup.ts));
    expect(setup.answers).toHaveLength(0);
    expect(setup.replies[0]?.text).toBe(
      'Studio is offline, so the answer was not sent. Try again once Shinsa runs there.'
    );
  });

  test('a link button, another kind of interaction or a reply address off Slack does nothing', async () => {
    const setup = await questionSetup();
    const open = { action_id: 'shinsa.open', action_ts: '500.2' };
    expect((await sendClick(setup.harness, clickPayload(setup.ts, { actions: [open] }))).status).toBe(200);
    await sendClick(setup.harness, clickPayload(setup.ts, { type: 'view_submission' }));
    await sendClick(setup.harness, clickPayload(setup.ts, { response_url: 'https://evil.test/x' }));
    await sendClick(
      setup.harness,
      clickPayload(setup.ts, { channel: {}, team: 'T1', user: null, message: [] })
    );
    await sendClick(setup.harness, 'noise');
    expect(setup.answers).toHaveLength(0);
    expect(setup.replies).toHaveLength(0);
  });

  test('is refused unsigned, too large or not JSON, and a failed reply is logged', async () => {
    const setup = await questionSetup();
    expect((await sendClick(setup.harness, clickPayload(setup.ts), 'v0=forged')).status).toBe(401);
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
    await sendClick(setup.harness, clickPayload(setup.ts));
    expect(failures).toHaveBeenCalled();
  });
});
