import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Effect } from 'effect';
import { isStuck, makeFileStore, resolveCompactionNotice } from '../../src/eunoe/index.ts';
import {
  createMessagesBody,
  type FakeAnthropic,
  sendMessages,
  startFakeAnthropic,
} from '../helpers/anthropic.ts';
import { captureLogs } from '../helpers/logs.ts';
import { createTempDir } from '../helpers/temp.ts';
import { type EunoeOptions, type OpenEunoe, openEunoe } from './harness.ts';

const SMALL_WINDOW = () => Promise.resolve(4_000);

let liveUpstream: FakeAnthropic | null = null;

let liveServer: OpenEunoe | null = null;

afterEach(async () => {
  await liveServer?.close();
  await liveUpstream?.stop();
  liveServer = null;
  liveUpstream = null;
});

function openServer(options: EunoeOptions = {}) {
  const upstream = startFakeAnthropic();
  const server = openEunoe({ upstream: upstream.url, window: SMALL_WINDOW, foldFloor: 0, ...options });
  liveUpstream = upstream;
  liveServer = server;
  return { server, upstream, dir: server.dir };
}

function watchSession(eunoe: OpenEunoe, sessionId: string) {
  return eunoe.watch(sessionId);
}

async function ensureUrl(eunoe: OpenEunoe) {
  const status = await eunoe.ensure();
  if (!status.ok) throw new Error(status.reason);
  return status.url;
}

describe('EunoeServer', () => {
  test('serves the forwarder on a loopback port of its own and passes a request it cannot thread through untouched', async () => {
    const { server, upstream, dir } = openServer();
    const status = await server.ensure();
    expect(status).toEqual({ ok: true, url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/), dir });
    const again = await server.ensure();
    expect(again).toEqual(status);
    const body = createMessagesBody([10]);
    const response = await sendMessages(status.ok ? status.url : '', null, body);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: 'msg_fake' });
    expect(upstream.received).toHaveLength(1);
    expect(upstream.received[0]?.headers.get('authorization')).toBe('Bearer token');
    expect(upstream.received[0]?.body).toEqual(body);
  });

  test('compact mode cuts a session over the window, tells the session, and keeps its state and log in its folder', async () => {
    const { server, upstream, dir } = openServer();
    const url = await ensureUrl(server);
    const watched = watchSession(server, 'session-1');
    const other = watchSession(server, 'session-2');
    const body = createMessagesBody([4_000, 4_000, 4_000]);
    await (await sendMessages(url, 'session-1', body)).text();
    const sent = upstream.received[0]?.body as { messages: unknown[] };
    expect(sent.messages.length).toBeLessThan(body.messages.length);
    expect(watched.notices).toEqual([
      { kind: 'compaction', trigger: 'auto', preTokens: null, summary: null, by: 'eunoe' },
    ]);
    expect(watched.stuck).toEqual([]);
    expect(other.notices).toEqual([]);
    expect(readdirSync(join(dir, 'threads'))).toHaveLength(1);
    const logged = readFileSync(join(dir, 'requests.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(logged.at(-1)).toMatchObject({ mode: 'compact', compacted: true, actions: ['cut'] });
  });

  test('a budget fold in the library’s rolling mode is a quiet fold, not a cut', async () => {
    const { server } = openServer({
      window: () => Promise.resolve(1_000_000),
      tuning: { mode: 'default', budget: 1_000, keep: 1 },
    });
    const url = await ensureUrl(server);
    const watched = watchSession(server, 'session-1');
    await (await sendMessages(url, 'session-1', createMessagesBody([4_000, 4_000, 4_000]))).text();
    expect(watched.notices).toEqual([
      { kind: 'compaction', trigger: 'fold', preTokens: null, summary: null, by: 'eunoe' },
    ]);
  });

  test('a thread whose live turn alone is over the window is reported stuck, until the session stops watching', async () => {
    const { server } = openServer();
    const url = await ensureUrl(server);
    const watched = watchSession(server, 'session-1');
    const body = createMessagesBody([100], 'y'.repeat(40_000));
    await (await sendMessages(url, 'session-1', body)).text();
    expect(watched.stuck).toEqual(['session-1']);
    watched.stop();
    await (await sendMessages(url, 'session-1', body)).text();
    expect(watched.stuck).toEqual(['session-1']);
  });

  test('a fold queued for a session folds every earlier turn on its next request, once', async () => {
    const { server, upstream } = openServer({ window: () => Promise.resolve(1_000_000) });
    const url = await ensureUrl(server);
    const watched = watchSession(server, 'session-1');
    server.fold('session-1', true);
    const body = createMessagesBody([4_000, 4_000, 4_000], 'Now build phase 1.');
    await (await sendMessages(url, 'session-1', body)).text();
    const folded = upstream.received[0]?.body as { messages: unknown[] };
    expect(folded.messages.length).toBeLessThan(body.messages.length);
    expect(JSON.stringify(folded)).not.toContain('x'.repeat(4_000));
    expect(watched.notices).toEqual([
      { kind: 'compaction', trigger: 'fold', preTokens: null, summary: null, by: 'eunoe' },
    ]);
    await (await sendMessages(url, 'session-1', createMessagesBody([4_000, 4_000, 4_000, 10]))).text();
    expect(watched.notices).toHaveLength(1);
  });

  test('a token count never takes the fold, and a released fold or one with nothing before it folds nothing', async () => {
    const { server, upstream } = openServer({ window: () => Promise.resolve(1_000_000) });
    const url = await ensureUrl(server);
    const watched = watchSession(server, 'session-1');
    const release = server.fold('session-1', true);
    const body = createMessagesBody([4_000, 4_000]);
    await (
      await fetch(`${url}/v1/messages/count_tokens`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-claude-code-session-id': 'session-1' },
        body: JSON.stringify(body),
      })
    ).text();
    expect(upstream.received[0]?.body.messages).toEqual(body.messages);
    const stale = server.fold('session-1', true);
    release();
    stale();
    await (await sendMessages(url, 'session-1', body)).text();
    expect(upstream.received[1]?.body.messages).toEqual(body.messages);
    expect(watched.notices).toEqual([]);
  });

  test('a side request with no tools, or a thread with nothing before its turn yet, leaves the fold for the real request', async () => {
    const { server, upstream } = openServer({ window: () => Promise.resolve(1_000_000) });
    const url = await ensureUrl(server);
    const watched = watchSession(server, 'session-1');
    server.fold('session-1', true);
    const side = { ...createMessagesBody([4_000, 4_000]), tools: [] };
    await (await sendMessages(url, 'session-1', side)).text();
    expect(upstream.received[0]?.body.messages).toEqual(side.messages);
    const logs = captureLogs();
    await (await sendMessages(url, 'session-1', createMessagesBody([], 'Prompt 0'))).text();
    logs.restore();
    expect(logs.fieldsOf('[Eunoe] Nothing to fold before this turn yet')).toHaveLength(1);
    const real = createMessagesBody([4_000, 4_000, 4_000], 'Now build phase 1.');
    await (await sendMessages(url, 'session-1', real)).text();
    expect(upstream.received[2]?.body.messages).toHaveLength(real.messages.length - 5);
    expect(watched.notices).toEqual([
      { kind: 'compaction', trigger: 'fold', preTokens: null, summary: null, by: 'eunoe' },
    ]);
  });

  test('a subagent sharing the session id never ends the session as stuck or folds its notices into the chat', async () => {
    const { server } = openServer();
    const url = await ensureUrl(server);
    const watched = watchSession(server, 'session-1');
    await (await sendMessages(url, 'session-1', createMessagesBody([10]))).text();
    const subagent = createMessagesBody([100], 'y'.repeat(40_000));
    subagent.messages[0] = { role: 'user', content: 'You are a subagent. Search the repository.' };
    await (await sendMessages(url, 'session-1', subagent)).text();
    expect(watched.stuck).toEqual([]);
    expect(watched.notices).toEqual([]);
    await (await sendMessages(url, 'session-1', createMessagesBody([100], 'y'.repeat(40_000)))).text();
    expect(watched.stuck).toEqual(['session-1']);
  });

  test('a small history folds anyway once its cache has expired, since the next request rewrites it all', async () => {
    const { server, upstream } = openServer({ foldFloor: 5_000 });
    const url = await ensureUrl(server);
    const small = createMessagesBody([1_000, 1_000]);
    server.fold('session-1', false);
    await (await sendMessages(url, 'session-1', small)).text();
    expect(upstream.received[0]?.body.messages).not.toEqual(small.messages);
  });

  test('a step whose history is too small to be worth a fold keeps its cache and drops the fold', async () => {
    const { server, upstream } = openServer({ foldFloor: 5_000 });
    const url = await ensureUrl(server);
    const logs = captureLogs();
    const body = createMessagesBody([1_000, 1_000]);
    server.fold('session-1', true);
    await (await sendMessages(url, 'session-1', body)).text();
    logs.restore();
    expect(logs.fieldsOf('[Eunoe] Too little before this turn to be worth a fold')).toHaveLength(1);
    expect(upstream.received[0]?.body.messages).toEqual(body.messages);
    server.fold('session-1', true);
    await (await sendMessages(url, 'session-1', createMessagesBody([1_000, 20_000]))).text();
    expect(upstream.received[1]?.body.messages).not.toEqual(createMessagesBody([1_000, 20_000]).messages);
  });

  test('a request log it cannot write is logged and the request still goes through', async () => {
    const { server, upstream, dir } = openServer();
    const url = await ensureUrl(server);
    mkdirSync(join(dir, 'requests.jsonl'));
    const logs = captureLogs();
    const response = await sendMessages(url, 'session-1', createMessagesBody([4_000, 4_000, 4_000]));
    logs.restore();
    expect(response.status).toBe(200);
    expect(upstream.received).toHaveLength(1);
    expect(logs.fieldsOf('[Eunoe] Could not write the request log')).toHaveLength(1);
  });

  test('a window it cannot look up passes the request on untouched', async () => {
    const { server, upstream } = openServer({ window: () => Promise.reject(new Error('no window')) });
    const url = await ensureUrl(server);
    const body = createMessagesBody([4_000, 4_000, 4_000]);
    await (await sendMessages(url, 'session-1', body)).text();
    expect(upstream.received.map((request) => request.body.messages)).toEqual([body.messages]);
  });

  test('a session watched twice keeps telling the watcher that stays', async () => {
    const { server } = openServer();
    const url = await ensureUrl(server);
    const kept = watchSession(server, 'session-1');
    const dropped = watchSession(server, 'session-1');
    dropped.stop();
    await (await sendMessages(url, 'session-1', createMessagesBody([10]))).text();
    await (await sendMessages(url, 'session-1', createMessagesBody([100], 'y'.repeat(40_000)))).text();
    expect(kept.stuck).toEqual(['session-1']);
    expect(dropped.stuck).toEqual([]);
  });

  test('a folder it cannot make leaves runs to talk to Claude directly', async () => {
    const { server, dir } = openServer();
    mkdirSync(dirname(dir), { recursive: true });
    writeFileSync(dir, '');
    expect(await server.ensure()).toEqual({
      ok: false,
      reason: expect.stringMatching(/^Eunoe could not start: /),
    });
  });

  test('a port it cannot take leaves runs to talk to Claude directly, and a stopped server never starts again', async () => {
    const taken = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') });
    const { server } = openServer({ port: taken.port });
    const status = await server.ensure();
    expect(status).toEqual({ ok: false, reason: expect.stringMatching(/^Eunoe could not start: /) });
    await taken.stop(true);
    await server.stop();
    expect(await server.ensure()).toEqual({ ok: false, reason: 'Shinsa is stopping.' });
  });
});

describe('the thread store', () => {
  test('keeps each thread in a file named after its key and reads an unknown or damaged one as empty', () => {
    const dir = join(createTempDir(), 'threads');
    const store = Effect.runSync(makeFileStore(dir));
    expect(store.read('missing')).toEqual({});
    store.save('session/1-abc', { keep: 2 });
    expect(existsSync(join(dir, 'session_1-abc.json'))).toBe(true);
    expect(store.read('session/1-abc')).toEqual({ keep: 2 });
    writeFileSync(join(dir, 'damaged.json'), '{"keep":');
    expect(store.read('damaged')).toEqual({});
    writeFileSync(join(dir, 'odd.json'), JSON.stringify({ keep: 'two' }));
    expect(store.read('odd')).toEqual({});
    writeFileSync(join(dir, 'locked.json'), JSON.stringify({ keep: 3 }));
    chmodSync(join(dir, 'locked.json'), 0o000);
    expect(store.read('locked')).toEqual({});
  });

  test('a thread it cannot write fails instead of saving nothing', () => {
    const root = createTempDir();
    writeFileSync(join(root, 'threads'), '');
    const store = Effect.runSync(makeFileStore(join(root, 'threads')));
    expect(() => store.save('session-1', { keep: 1 })).toThrow();
  });
});

describe('isStuck', () => {
  test('only a request that still does not fit is stuck; a stuck note under the limit is not', () => {
    const sizes = { fixed: 500, head: 300, folded: 20, live: 11_000 };
    expect(isStuck({ stuck: sizes, fit: 'over' })).toBe(true);
    expect(isStuck({ stuck: sizes })).toBe(false);
    expect(isStuck({ stuck: sizes, fit: 'bare' })).toBe(false);
    expect(isStuck({ fit: 'over' })).toBe(false);
  });
});

describe('resolveCompactionNotice', () => {
  test('only a request that moved the cut is a notice: a cut at the limit is automatic, anything else a fold', () => {
    expect(resolveCompactionNotice({ compacted: false })).toBeNull();
    expect(resolveCompactionNotice({ compacted: true, actions: ['cut'] })).toMatchObject({ trigger: 'auto' });
    expect(resolveCompactionNotice({ compacted: true })).toMatchObject({ trigger: 'fold' });
  });
});
