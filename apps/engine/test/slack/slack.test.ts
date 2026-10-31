import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createSlackForwardSignature,
  DomainError,
  SLACK_EVALUATION_SCHEMA,
  SLACK_EVALUATION_SYSTEM,
  SLACK_FORWARD_HEADERS,
  type SlackMention,
  type SlackThreadLink,
  serializeBase64Url,
} from '@shinsa/core';
import { log } from '../../src/log/index.ts';
import { ControlClient, Remote } from '../../src/remote/index.ts';
import type { EffectContext } from '../../src/runtime/engine.ts';
import { Engine } from '../../src/runtime/index.ts';
import { SLACK_EVENT_BODY_LIMIT_BYTES, Slack, SlackRelay, SlackRelayError } from '../../src/slack/index.ts';
import { EventLog } from '../../src/store/index.ts';
import { createTempDir, until } from '../helpers/index.ts';
import { createGate, createStubEngine, createTask } from '../helpers/state.ts';

const ORIGIN = 'https://app.test';

const CONNECT_KEY = serializeBase64Url(new Uint8Array(32).fill(4));

const CREDENTIALS = {
  instanceId: 'k3x9',
  machineToken: 'machine-token',
  tunnelToken: 'tunnel',
  tunnelHost: 't-k3x9.shinsa.dev',
  connectKey: CONNECT_KEY,
};

const NOW = 1_800_000_000_000;

const THREAD = { teamId: 'T1', channelId: 'C1', threadTs: '100.1' };

const LINK: SlackThreadLink = { ...THREAD, userId: 'U1', permalink: null, statusTs: null };

const MENTION: SlackMention = {
  ...THREAD,
  eventId: 'Ev1',
  messageTs: '100.1',
  userId: 'U1',
  userName: 'Christo',
  text: 'the build hangs',
  permalink: null,
  thread: [{ ts: '100.1', userId: 'U1', userName: 'Christo', text: 'the build hangs', bot: false }],
};

interface RelayCall {
  path: string;
  method: string;
  token: string | null;
  body: Record<string, unknown> | null;
}

interface Setup {
  slack: Slack;
  stub: ReturnType<typeof createStubEngine>;
  relay: RelayCall[];
  answers: Record<string, (body: Record<string, unknown> | null) => Response | Promise<Response>>;
  asked: { system: string; prompt: string; schema: unknown }[];
  answer: { value: unknown };
  waits: number[];
  clock: { now: number };
}

function createRemote(options: { enabled?: boolean; paired?: boolean } = {}) {
  const path = join(createTempDir(), 'remote.json');
  if (options.paired ?? true)
    writeFileSync(
      path,
      JSON.stringify({ credentials: CREDENTIALS, enabled: options.enabled ?? true, owner: 'mona' })
    );
  return new Remote({
    path,
    control: new ControlClient({ origin: ORIGIN }),
    connect: () => Promise.reject(new Error('no tunnel in tests')),
    localUrl: () => 'http://127.0.0.1:7446',
    version: '1',
    maxBodyBytes: 1024,
    machineName: 'Studio',
    openUrl: () => Promise.resolve(),
  });
}

function setUp(options: { enabled?: boolean; link?: SlackThreadLink | null } = {}): Setup {
  const stub = createStubEngine((state) => {
    state.tasks.t1 = createTask({
      id: 't1',
      handle: 'LOC-7',
      title: 'Fix the hanging build',
      stage: 'planning',
      ...(options.link === null ? {} : { slack: options.link ?? LINK }),
    });
  });
  const relay: RelayCall[] = [];
  let posted = 0;
  const answers: Setup['answers'] = {
    '/__remote/slack/post': (body) => Response.json({ ts: body?.replaceTs ?? `200.${++posted}` }),
    '/__remote/slack/links': () =>
      Response.json({
        links: [{ teamId: 'T1', teamName: 'Acme', userId: 'U1', userName: 'Christo', linkedAt: 5 }],
      }),
    '/__remote/slack/unlink': () => Response.json({ ok: true }),
  };
  const asked: Setup['asked'] = [];
  const answer = { value: { decision: 'task', text: 'Fix the hanging build.' } as unknown };
  const waits: number[] = [];
  const clock = { now: NOW };
  const slack = new Slack({
    engine: stub.engine,
    remote: createRemote({ enabled: options.enabled }),
    ask: <T>(system: string, prompt: string, schema?: unknown) => {
      asked.push({ system, prompt, schema });
      return Promise.resolve(answer.value as T);
    },
    fetch: async (input, init = {}) => {
      const url = new URL(input);
      const headers = new Headers(init.headers);
      const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      relay.push({
        path: url.pathname,
        method: init.method ?? 'GET',
        token: headers.get('authorization')?.replace('Bearer ', '') ?? null,
        body,
      });
      const respond = answers[url.pathname];
      return respond ? respond(body) : new Response('', { status: 404 });
    },
    now: () => clock.now,
    sleep: (ms) => {
      waits.push(ms);
      clock.now += ms;
      return Promise.resolve();
    },
    statusIntervalMs: 5000,
  });
  return { slack, stub, relay, answers, asked, answer, waits, clock };
}

function context(key = 'effect-1'): EffectContext {
  return { key, attempt: 1, signal: new AbortController().signal };
}

async function forward(body: string, timestamp = NOW, signature?: string) {
  const signed = signature ?? (await createSlackForwardSignature(CONNECT_KEY, timestamp, body));
  return new Request('https://t-k3x9.shinsa.dev/api/slack/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [SLACK_FORWARD_HEADERS.signature]: signed,
      [SLACK_FORWARD_HEADERS.timestamp]: String(timestamp),
    },
    body,
  });
}

let warnings: ReturnType<typeof spyOn>;

beforeEach(() => {
  warnings = spyOn(log, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warnings.mockRestore();
});

describe('a mention app.shinsa.dev forwards', () => {
  test('signed by the relay becomes slack.mention, once per Slack event', async () => {
    const { slack, stub } = setUp();
    const response = await slack.handleEvents(await forward(JSON.stringify(MENTION)));
    expect(response.status).toBe(202);
    expect(stub.dispatched).toEqual([{ type: 'slack.mention', mention: MENTION }]);
    expect(stub.commandIds).toEqual(['slack:Ev1']);
    expect(slack.isEventsPath('/api/slack/events')).toBe(true);
    expect(slack.isEventsPath('/api/slack')).toBe(false);
  });

  test('is refused unsigned, signed long ago, too large, broken, or while remote access is off', async () => {
    const { slack, stub } = setUp();
    const body = JSON.stringify(MENTION);
    expect((await slack.handleEvents(await forward(body, NOW, 'v1=forged'))).status).toBe(401);
    expect((await slack.handleEvents(await forward(body, NOW - 6 * 60_000))).status).toBe(401);
    expect(
      (await slack.handleEvents(await forward('x'.repeat(SLACK_EVENT_BODY_LIMIT_BYTES + 1)))).status
    ).toBe(413);
    expect((await slack.handleEvents(await forward('{nope'))).status).toBe(400);
    expect((await slack.handleEvents(await forward('{"eventId":"Ev1"}'))).status).toBe(400);
    const off = setUp({ enabled: false });
    expect((await off.slack.handleEvents(await forward(body))).status).toBe(404);
    expect(stub.dispatched).toEqual([]);
  });
});

describe('deciding whether a mention is work', () => {
  test('says it is reading, asks the classifier with the thread, and records what it decided', async () => {
    const { slack, stub, relay, asked } = setUp({ link: null });
    await slack.evaluate({ kind: 'slack.evaluate', mention: MENTION }, context('slack-eval'));
    expect(relay[0]).toMatchObject({
      path: '/__remote/slack/post',
      method: 'POST',
      token: 'machine-token',
      body: { teamId: 'T1', channelId: 'C1', threadTs: '100.1', replaceTs: null },
    });
    expect(JSON.stringify(relay[0]?.body?.message)).toContain('Reading the thread');
    expect(asked[0]?.system).toBe(SLACK_EVALUATION_SYSTEM);
    expect(asked[0]?.schema).toBe(SLACK_EVALUATION_SCHEMA);
    expect(asked[0]?.prompt).toContain('Christo (mentioning you): the build hangs');
    expect(stub.dispatched).toEqual([
      {
        type: 'slack.record_evaluation',
        mention: MENTION,
        statusTs: '200.1',
        evaluation: { kind: 'task', request: 'Fix the hanging build.' },
      },
    ]);
    expect(stub.commandIds).toEqual(['slack-eval:slack.record_evaluation']);
  });

  test('without an answer it declines and says why, and a refused reading post still decides', async () => {
    const { slack, stub, answer, answers } = setUp({ link: null });
    answer.value = null;
    answers['/__remote/slack/post'] = () =>
      Response.json({ error: { code: 'thread_not_forwarded', message: 'Never sent.' } }, { status: 403 });
    await slack.evaluate({ kind: 'slack.evaluate', mention: MENTION }, context());
    expect(stub.dispatched[0]).toMatchObject({
      statusTs: null,
      evaluation: { kind: 'none', reason: expect.stringContaining('could not read the thread') },
    });
    expect(warnings).toHaveBeenCalledWith('[Slack] app.shinsa.dev refused the post', expect.anything());
  });

  test('a relay that is down or overloaded throws, so the outbox tries again', async () => {
    const { slack, answers, stub } = setUp({ link: null });
    answers['/__remote/slack/post'] = () => new Response('busy', { status: 503 });
    const failed = slack.evaluate({ kind: 'slack.evaluate', mention: MENTION }, context());
    await expect(failed).rejects.toBeInstanceOf(SlackRelayError);
    await expect(failed).rejects.toMatchObject({ code: 'relay_failed', isRetryable: true });
    answers['/__remote/slack/post'] = () => Promise.reject(new Error('offline'));
    await expect(
      slack.evaluate({ kind: 'slack.evaluate', mention: MENTION }, context())
    ).rejects.toMatchObject({
      code: 'unreachable',
    });
    expect(stub.dispatched).toEqual([]);
  });
});

describe('a post the outbox asks for', () => {
  test('a decline replaces the reading post with the reason', async () => {
    const { slack, relay } = setUp();
    await slack.post({
      kind: 'slack.post',
      thread: THREAD,
      taskId: null,
      post: { kind: 'declined', reason: 'This is a thank-you.' },
      replaceTs: '200.9',
    });
    expect(relay[0]?.body).toMatchObject({ replaceTs: '200.9' });
    expect(JSON.stringify(relay[0]?.body?.message)).toContain('This is a thank-you.');
  });

  test('a task’s post links to it on app.shinsa.dev', async () => {
    const { slack, relay } = setUp();
    await slack.post({
      kind: 'slack.post',
      thread: THREAD,
      taskId: 't1',
      post: { kind: 'forwarded' },
      replaceTs: null,
    });
    expect(JSON.stringify(relay[0]?.body?.message)).toContain('https://app.test/tasks/t1');
  });

  test('posts nothing for a task or gate that is gone, or while remote access is off', async () => {
    const { slack, relay } = setUp();
    await slack.post({
      kind: 'slack.post',
      thread: THREAD,
      taskId: 'gone',
      post: { kind: 'result' },
      replaceTs: null,
    });
    await slack.post({
      kind: 'slack.post',
      thread: THREAD,
      taskId: 't1',
      post: { kind: 'gate', gateId: 'missing' },
      replaceTs: null,
    });
    expect(relay).toEqual([]);
    const off = setUp({ enabled: false });
    await off.slack.post({
      kind: 'slack.post',
      thread: THREAD,
      taskId: 't1',
      post: { kind: 'forwarded' },
      replaceTs: null,
    });
    expect(off.relay).toEqual([]);
    expect(warnings).toHaveBeenCalledWith(
      '[Slack] Remote access is off, so nothing was posted',
      expect.anything()
    );
  });
});

describe('the status message of a task', () => {
  const effect = { kind: 'slack.status' as const, taskId: 't1', thread: THREAD };

  test('is posted once and its message id recorded, then edited in place', async () => {
    const { slack, stub, relay, clock } = setUp();
    await slack.status(effect, context('status-1'));
    expect(relay[0]?.body).toMatchObject({ replaceTs: null });
    expect(JSON.stringify(relay[0]?.body?.message)).toContain('Fix the hanging build');
    expect(stub.dispatched).toEqual([{ type: 'slack.record_status', taskId: 't1', ts: '200.1' }]);
    expect(stub.commandIds).toEqual(['status-1:slack.record_status']);
    stub.update((state) => {
      const task = state.tasks.t1;
      if (task) {
        task.slack = { ...LINK, statusTs: '200.1' };
        task.stage = 'building';
      }
    });
    clock.now += 10_000;
    await slack.status(effect, context('status-2'));
    expect(relay[1]?.body).toMatchObject({ replaceTs: '200.1' });
    expect(stub.dispatched).toHaveLength(1);
  });

  test('waits out the interval between edits, and skips an edit that would change nothing', async () => {
    const { slack, stub, relay, waits } = setUp({ link: { ...LINK, statusTs: '200.0' } });
    stub.respond(() => true, []);
    await slack.status(effect, context());
    await slack.status(effect, context());
    expect(waits).toEqual([5000]);
    expect(relay).toHaveLength(1);
    stub.update((state) => {
      state.gates.q1 = createGate({
        id: 'q1',
        taskId: 't1',
        type: 'question',
        status: 'open',
        title: 'Which tab?',
      });
    });
    await slack.status(effect, context());
    expect(relay).toHaveLength(2);
    expect(JSON.stringify(relay[1]?.body?.message)).toContain('Which tab?');
  });

  test('keeps nothing when the relay refuses, and does nothing for a task without a thread', async () => {
    const { slack, stub, relay, answers } = setUp();
    answers['/__remote/slack/post'] = () =>
      Response.json({ error: { code: 'post_not_yours' } }, { status: 403 });
    await slack.status(effect, context());
    expect(stub.dispatched).toEqual([]);
    const plain = setUp({ link: null });
    await plain.slack.status(effect, context());
    await plain.slack.status({ ...effect, taskId: 'gone' }, context());
    expect(plain.relay).toEqual([]);
    expect(relay).toHaveLength(1);
  });

  test('an edit Slack answers with the same id records nothing new', async () => {
    const { slack, stub, answers } = setUp({ link: { ...LINK, statusTs: '200.5' } });
    answers['/__remote/slack/post'] = () => Response.json({ ts: '200.5' });
    await slack.status(effect, context());
    expect(stub.dispatched).toEqual([]);
  });
});

describe('a mention through the real engine', () => {
  test('is evaluated, starts a task tied to its thread, and posts the task’s status there', async () => {
    const engine = new Engine(new EventLog(join(createTempDir(), 'db.sqlite')));
    const posts: Record<string, unknown>[] = [];
    const slack = new Slack({
      engine,
      remote: createRemote(),
      ask: <T>() => Promise.resolve({ decision: 'task', text: 'Fix the hanging build.' } as T),
      fetch: (_input, init = {}) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        posts.push(body);
        return Promise.resolve(Response.json({ ts: body.replaceTs ?? `200.${posts.length}` }));
      },
      statusIntervalMs: 0,
    });
    engine.onEffect((effect, effectContext) => {
      if (effect.kind === 'slack.evaluate') return slack.evaluate(effect, effectContext);
      if (effect.kind === 'slack.status') return slack.status(effect, effectContext);
      if (effect.kind === 'slack.post') return slack.post(effect);
      return Promise.resolve();
    });
    engine.start();
    const body = JSON.stringify(MENTION);
    expect((await slack.handleEvents(await forward(body, Date.now()))).status).toBe(202);
    expect((await slack.handleEvents(await forward(body, Date.now()))).status).toBe(202);
    await until('the status replaces the reading post', () =>
      posts.some((post) => post.replaceTs === '200.1')
    );
    const tasks = Object.values(engine.state.tasks);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.request).toStartWith('Fix the hanging build.');
    expect(tasks[0]?.slack).toMatchObject({ ...THREAD, userId: 'U1', statusTs: '200.1' });
    expect(JSON.stringify(posts[0]?.message)).toContain('Reading the thread');
    engine.stop();
    await engine.settle();
  });
});

describe('without injected clocks and networks', () => {
  test('a status edit really waits, and stops waiting when the effect is cancelled', async () => {
    const stub = createStubEngine((state) => {
      state.tasks.t1 = createTask({ id: 't1', title: 'Fix it', stage: 'planning', slack: LINK });
    });
    const slack = new Slack({
      engine: stub.engine,
      remote: createRemote(),
      ask: () => Promise.resolve(null),
      fetch: () => Promise.resolve(Response.json({ ts: '200.1' })),
      statusIntervalMs: 20,
    });
    const effect = { kind: 'slack.status' as const, taskId: 't1', thread: THREAD };
    await slack.status(effect, context());
    stub.update((state) => {
      const task = state.tasks.t1;
      if (task) task.stage = 'building';
    });
    await slack.status(effect, context());
    const controller = new AbortController();
    const waiting = slack.status(effect, { key: 'k', attempt: 1, signal: controller.signal });
    controller.abort(new Error('cancelled'));
    await expect(waiting).rejects.toThrow('cancelled');
  });

  test('the relay client says app.shinsa.dev is unreachable when nothing answers', async () => {
    const relay = new SlackRelay(() => 'http://127.0.0.1:1');
    await expect(relay.requestLinks('token')).rejects.toMatchObject({
      code: 'unreachable',
      isRetryable: true,
    });
  });
});

describe('Settings → Integrations → Slack', () => {
  test('shows the connect link and who is connected through app.shinsa.dev', async () => {
    const { slack, relay } = setUp();
    expect(await slack.snapshot()).toEqual({
      remote: true,
      connectUrl: 'https://app.test/slack/connect?instance=k3x9',
      links: [{ teamId: 'T1', teamName: 'Acme', userId: 'U1', userName: 'Christo', linkedAt: 5 }],
      problem: null,
    });
    expect(relay[0]).toMatchObject({ path: '/__remote/slack/links', method: 'GET', token: 'machine-token' });
  });

  test('says remote access comes first, and when app.shinsa.dev cannot be reached', async () => {
    expect(await setUp({ enabled: false }).slack.snapshot()).toEqual({
      remote: false,
      connectUrl: null,
      links: [],
      problem: null,
    });
    const { slack, answers } = setUp();
    answers['/__remote/slack/links'] = () => new Response('{', { status: 500 });
    const snapshot = await slack.snapshot();
    expect(snapshot.links).toEqual([]);
    expect(snapshot.problem).toContain('app.shinsa.dev could not be reached');
  });

  test('disconnecting removes the machine’s links, and needs remote access', async () => {
    const { slack, relay } = setUp();
    const [read, disconnect] = slack.routes();
    if (!read || !disconnect) throw new Error('Slack has two routes.');
    const match = /x/.exec('x') as RegExpExecArray;
    const after = await disconnect.respond(match, new Request('http://x', { method: 'POST' }));
    expect(relay.map((call) => call.path)).toEqual(['/__remote/slack/unlink', '/__remote/slack/links']);
    expect(((await after.json()) as { remote: boolean }).remote).toBe(true);
    expect((await read.respond(match, new Request('http://x'))).status).toBe(200);
    expect(read.pattern.test('/api/slack')).toBe(true);
    expect(disconnect.pattern.test('/api/slack/disconnect')).toBe(true);
    await expect(setUp({ enabled: false }).slack.disconnect()).rejects.toBeInstanceOf(DomainError);
  });
});
