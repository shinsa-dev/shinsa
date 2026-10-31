import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createSlackForwardSignature,
  DomainError,
  SLACK_FORWARD_HEADERS,
  type SlackAnswer,
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

const LINK: SlackThreadLink = {
  ...THREAD,
  userId: 'U1',
  messageTs: '100.1',
  permalink: null,
  statusTs: null,
  reaction: 'hourglass_flowing_sand',
};

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
  asked: { system: string; prompt: string }[];
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
    '/__remote/slack/session': () => Response.json({ applied: true }),
    '/__remote/slack/react': () => Response.json({ applied: true }),
    '/__remote/slack/links': () =>
      Response.json({
        links: [{ teamId: 'T1', teamName: 'Acme', userId: 'U1', userName: 'Christo', linkedAt: 5 }],
      }),
    '/__remote/slack/unlink': () => Response.json({ ok: true }),
  };
  const waits: number[] = [];
  const clock = { now: NOW };
  const asked: Setup['asked'] = [];
  const answer: Setup['answer'] = { value: { decision: 'task' } };
  const slack = new Slack({
    engine: stub.engine,
    remote: createRemote({ enabled: options.enabled }),
    ask: <T>(system: string, prompt: string) => {
      asked.push({ system, prompt });
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

function callsTo(relay: RelayCall[], path: string) {
  return relay.filter((call) => call.path === `/__remote/slack/${path}`);
}

function context(key = 'effect-1'): EffectContext {
  return { key, attempt: 1, signal: new AbortController().signal };
}

async function forward(body: string, timestamp = NOW, signature?: string, path = '/api/slack/events') {
  const signed = signature ?? (await createSlackForwardSignature(CONNECT_KEY, timestamp, body));
  return new Request(`https://t-k3x9.shinsa.dev${path}`, {
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
    const request = await forward(JSON.stringify(MENTION));
    const response = await slack.handleTunnel(request, new URL(request.url));
    expect(response.status).toBe(202);
    expect(stub.dispatched).toEqual([{ type: 'slack.mention', mention: MENTION }]);
    expect(stub.commandIds).toEqual(['slack:Ev1']);
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

describe('an answer from a question’s button', () => {
  const ANSWER: SlackAnswer = {
    interactionId: 'I1',
    ...THREAD,
    messageTs: '200.4',
    userId: 'U1',
    gateId: 'q1',
    choice: 0,
  };

  async function click(slack: Slack, body: string, signature?: string) {
    const request = await forward(body, NOW, signature, '/api/slack/interactions');
    return slack.handleTunnel(request, new URL(request.url));
  }

  test('becomes slack.answer once per click, and says what was answered', async () => {
    const { slack, stub } = setUp();
    stub.update((state) => {
      state.gates.q1 = { ...createGate({ id: 'q1', taskId: 't1', type: 'question' }), response: 'CSV' };
    });
    const response = await click(slack, JSON.stringify(ANSWER));
    expect(await response.json()).toEqual({ answered: true, choice: 'CSV' });
    expect(stub.dispatched).toEqual([{ type: 'slack.answer', answer: ANSWER }]);
    expect(stub.commandIds).toEqual(['slack-answer:I1']);
    const gone = setUp();
    expect(await (await click(gone.slack, JSON.stringify({ ...ANSWER, gateId: 'q2' }))).json()).toEqual({
      answered: true,
      choice: '',
    });
  });

  test('says why when Shinsa refuses it, and fails on anything else', async () => {
    const { slack, stub } = setUp();
    stub.reject(() => true, new DomainError('slack_answer_closed', 'This question is no longer open.'));
    expect(await (await click(slack, JSON.stringify(ANSWER))).json()).toEqual({
      answered: false,
      reason: 'This question is no longer open.',
    });
    const broken = setUp();
    broken.stub.reject(() => true, new Error('disk full'));
    expect(click(broken.slack, JSON.stringify(ANSWER))).rejects.toThrow('disk full');
  });

  test('is refused unsigned or missing a part', async () => {
    const { slack, stub } = setUp();
    expect((await click(slack, JSON.stringify(ANSWER), 'v1=forged')).status).toBe(401);
    expect((await click(slack, JSON.stringify({ ...ANSWER, choice: 'one' }))).status).toBe(400);
    expect(stub.dispatched).toEqual([]);
  });
});

describe('a post the outbox asks for', () => {
  test('a relay that is down or overloaded throws, so the outbox tries again', async () => {
    const { slack, answers } = setUp();
    const effect = {
      kind: 'slack.post' as const,
      thread: THREAD,
      taskId: 't1',
      post: { kind: 'forwarded' as const },
    };
    answers['/__remote/slack/post'] = () => new Response('busy', { status: 503 });
    const failed = slack.post(effect);
    await expect(failed).rejects.toBeInstanceOf(SlackRelayError);
    await expect(failed).rejects.toMatchObject({ code: 'relay_failed', isRetryable: true });
    answers['/__remote/slack/post'] = () => Promise.reject(new Error('offline'));
    await expect(slack.post(effect)).rejects.toMatchObject({ code: 'unreachable' });
  });

  test('a task’s post links to it on app.shinsa.dev', async () => {
    const { slack, relay } = setUp();
    await slack.post({
      kind: 'slack.post',
      thread: THREAD,
      taskId: 't1',
      post: { kind: 'forwarded' },
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
    });
    await slack.post({
      kind: 'slack.post',
      thread: THREAD,
      taskId: 't1',
      post: { kind: 'gate', gateId: 'missing' },
    });
    expect(relay).toEqual([]);
    const off = setUp({ enabled: false });
    await off.slack.post({
      kind: 'slack.post',
      thread: THREAD,
      taskId: 't1',
      post: { kind: 'forwarded' },
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
    const posts = () => callsTo(relay, 'post');
    expect(posts()[0]?.body).toMatchObject({ replaceTs: null });
    expect(JSON.stringify(posts()[0]?.body?.message)).toContain('Fix the hanging build');
    expect(stub.dispatched).toEqual([
      { type: 'slack.record_status', taskId: 't1', ts: '200.1', reaction: 'hammer_and_wrench' },
    ]);
    expect(stub.commandIds).toEqual(['status-1:slack.record_status']);
    stub.update((state) => {
      const task = state.tasks.t1;
      if (task) {
        task.slack = { ...LINK, statusTs: '200.1', reaction: 'hammer_and_wrench' };
        task.stage = 'building';
      }
    });
    clock.now += 10_000;
    await slack.status(effect, context('status-2'));
    expect(posts()[1]?.body).toMatchObject({ replaceTs: '200.1' });
    expect(stub.dispatched).toHaveLength(1);
  });

  test('waits out the interval between edits, and skips an edit that would change nothing', async () => {
    const { slack, stub, relay, waits } = setUp({
      link: { ...LINK, statusTs: '200.0', reaction: 'hammer_and_wrench' },
    });
    stub.respond(() => true, []);
    await slack.status(effect, context());
    await slack.status(effect, context());
    expect(waits).toEqual([5000]);
    expect(callsTo(relay, 'post')).toHaveLength(1);
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
    expect(callsTo(relay, 'post')).toHaveLength(2);
    expect(JSON.stringify(callsTo(relay, 'post')[1]?.body?.message)).toContain('Which tab?');
  });

  test('posts a new message when Slack will not edit the old one, and records it', async () => {
    const { slack, stub, relay, answers } = setUp({ link: { ...LINK, statusTs: '300.1' } });
    answers['/__remote/slack/post'] = (body) =>
      body?.replaceTs
        ? Response.json({ error: { code: 'slack_failed' } }, { status: 409 })
        : Response.json({ ts: '200.9' });
    await slack.status(effect, context('status-1'));
    expect(callsTo(relay, 'post').map((call) => call.body?.replaceTs)).toEqual(['300.1', null]);
    expect(stub.dispatched).toEqual([
      { type: 'slack.record_status', taskId: 't1', ts: '200.9', reaction: 'hammer_and_wrench' },
    ]);
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

  test('sets the thread’s status in Slack as the task moves, once per change, and carries on when it cannot', async () => {
    const { slack, stub, relay, answers, clock } = setUp({ link: { ...LINK, statusTs: '200.0' } });
    await slack.status(effect, context());
    expect(callsTo(relay, 'session').map((call) => call.body)).toEqual([{ ...THREAD, status: 'processing' }]);
    stub.update((state) => {
      state.gates.q1 = createGate({
        id: 'q1',
        taskId: 't1',
        type: 'question',
        status: 'open',
        title: 'Which tab?',
      });
    });
    clock.now += 10_000;
    await slack.status(effect, context());
    expect(callsTo(relay, 'session').at(-1)?.body).toMatchObject({ status: 'suspended' });
    stub.update((state) => {
      const task = state.tasks.t1;
      if (task) task.title = 'Fix the hanging build now';
    });
    clock.now += 10_000;
    await slack.status(effect, context());
    expect(callsTo(relay, 'session')).toHaveLength(2);
    answers['/__remote/slack/session'] = () => Response.json({ applied: false });
    stub.update((state) => {
      const gate = state.gates.q1;
      if (gate) gate.status = 'answered';
    });
    clock.now += 10_000;
    await slack.status(effect, context());
    expect(callsTo(relay, 'session').at(-1)?.body).toMatchObject({ status: 'processing' });
    answers['/__remote/slack/session'] = () => new Response('busy', { status: 503 });
    stub.update((state) => {
      const task = state.tasks.t1;
      if (task) task.stage = 'awaiting_review';
    });
    clock.now += 10_000;
    await slack.status(effect, context());
    expect(warnings).toHaveBeenCalledWith('[Slack] The thread status could not be set', expect.anything());
  });

  test('moves the reaction on the mention as the task moves, keeping one at a time', async () => {
    const { slack, stub, relay } = setUp({ link: { ...LINK, statusTs: '200.5' } });
    await slack.status(effect, context('status-1'));
    expect(callsTo(relay, 'react')[0]?.body).toMatchObject({
      messageTs: '100.1',
      add: 'hammer_and_wrench',
      remove: 'hourglass_flowing_sand',
    });
    expect(stub.dispatched).toEqual([
      { type: 'slack.record_status', taskId: 't1', ts: '200.5', reaction: 'hammer_and_wrench' },
    ]);
  });

  test('an edit Slack answers with the same id records nothing new', async () => {
    const { slack, stub, answers } = setUp({
      link: { ...LINK, statusTs: '200.5', reaction: 'hammer_and_wrench' },
    });
    answers['/__remote/slack/post'] = () => Response.json({ ts: '200.5' });
    await slack.status(effect, context());
    expect(stub.dispatched).toEqual([]);
  });
});

describe('reading a mention', () => {
  const effect = { kind: 'slack.evaluate' as const, mention: MENTION };

  test('asks the model with the thread and starts a task for work, posting nothing itself', async () => {
    const { slack, stub, relay, asked } = setUp();
    await slack.evaluate(effect, context('read-1'));
    expect(asked[0]?.prompt).toContain('Christo (mentioning you): the build hangs');
    expect(stub.dispatched).toEqual([{ type: 'slack.start_task', mention: MENTION }]);
    expect(stub.commandIds).toEqual(['read-1:slack.start_task']);
    expect(relay.map((call) => [call.path, call.body])).toEqual([
      [
        '/__remote/slack/react',
        { ...THREAD, messageTs: '100.1', add: 'hourglass_flowing_sand', remove: null },
      ],
    ]);
  });

  test('says once per thread that it is not a task, then stays silent there', async () => {
    const { slack, stub, relay, answer } = setUp();
    answer.value = { decision: 'none' };
    await slack.evaluate(effect, context('read-1'));
    await slack.evaluate({ ...effect, mention: { ...MENTION, eventId: 'Ev2' } }, context('read-2'));
    const posts = callsTo(relay, 'post');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toMatchObject({ ...THREAD, replaceTs: null });
    expect(JSON.stringify(posts[0]?.body?.message)).toContain('Not a task, so nothing was started.');
    expect(stub.dispatched).toEqual([]);
  });

  test('takes its sizing-up reaction off a mention that is not a task', async () => {
    const { slack, relay, answer } = setUp();
    answer.value = { decision: 'none' };
    await slack.evaluate(effect, context());
    expect(callsTo(relay, 'react').map((call) => [call.body?.add, call.body?.remove])).toEqual([
      ['hourglass_flowing_sand', null],
      [null, 'hourglass_flowing_sand'],
    ]);
  });

  test('carries on when Slack will not take a reaction or the relay refuses it', async () => {
    const { slack, stub, answers } = setUp();
    answers['/__remote/slack/react'] = () => Response.json({ applied: false });
    await slack.evaluate(effect, context());
    answers['/__remote/slack/react'] = () =>
      Response.json({ error: { code: 'thread_not_forwarded' } }, { status: 403 });
    await slack.evaluate({ ...effect, mention: { ...MENTION, eventId: 'Ev2' } }, context('read-2'));
    expect(stub.dispatched).toHaveLength(2);
    expect(warnings).toHaveBeenCalledWith('[Slack] The reaction could not be set', expect.anything());
  });

  test('starts a task when the model does not answer', async () => {
    const { slack, stub, answer } = setUp();
    answer.value = null;
    await slack.evaluate(effect, context('read-1'));
    expect(stub.dispatched).toEqual([{ type: 'slack.start_task', mention: MENTION }]);
  });
});

describe('the result of a task', () => {
  const effect = {
    kind: 'slack.post' as const,
    thread: THREAD,
    taskId: 't1',
    post: { kind: 'result' as const },
  };

  test('is posted as one message with a link to the task', async () => {
    const { slack, stub, relay } = setUp();
    stub.update((state) => {
      const task = state.tasks.t1;
      if (task) task.result = { step: 'answer', body: 'It is the **buffer**.', at: NOW, runId: null };
    });
    await slack.post(effect);
    const message = JSON.stringify(callsTo(relay, 'post')[0]?.body?.message);
    expect(message).toContain('It is the *buffer*.');
    expect(message).toContain('"text":"Open in Shinsa","emoji":false},"url":"https://app.test/tasks/t1"');
    const none = setUp();
    await none.slack.post(effect);
    expect(none.relay).toEqual([]);
  });
});

describe('a mention through the real engine', () => {
  test('reads it, starts one task tied to its thread, and posts the task’s status there', async () => {
    const engine = new Engine(new EventLog(join(createTempDir(), 'db.sqlite')));
    const posts: Record<string, unknown>[] = [];
    const slack = new Slack({
      engine,
      remote: createRemote(),
      ask: <T>() => Promise.resolve({ decision: 'task' } as T),
      fetch: (input, init = {}) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (!input.endsWith('/post')) return Promise.resolve(Response.json({ applied: true }));
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
    await until('the status message is recorded', () =>
      Object.values(engine.state.tasks).some((task) => task.slack?.statusTs)
    );
    const tasks = Object.values(engine.state.tasks);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.request).toStartWith('the build hangs');
    expect(tasks[0]?.slack).toMatchObject({ ...THREAD, userId: 'U1', statusTs: '200.1' });
    expect(posts[0]).toMatchObject({ replaceTs: null });
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
      ask: <T>() => Promise.resolve(null as T),
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

describe('Settings → General → Slack', () => {
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
