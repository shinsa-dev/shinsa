import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ChatNotice, Run } from '@shinsa/core';
import { createClaudeProvider } from '../../src/agents/providers/claude/index.ts';
import { ProviderRegistry } from '../../src/agents/providers/index.ts';
import { Transcripts } from '../../src/agents/transcripts/index.ts';
import { EunoeServer, type EunoeServerOptions } from '../../src/eunoe/index.ts';
import {
  createMessagesBody,
  type FakeAnthropic,
  sendMessages,
  startFakeAnthropic,
} from '../helpers/anthropic.ts';
import { createTempDir } from '../helpers/index.ts';
import { createFakeQuery, createFakeRuntime, type QueryParams, sdkMessage } from '../helpers/query.ts';
import { World } from './harness.ts';

setDefaultTimeout(30_000);

let world: World | null = null;

let eunoe: EunoeServer | null = null;

let upstream: FakeAnthropic | null = null;

afterEach(async () => {
  await world?.dispose();
  await eunoe?.stop();
  await upstream?.stop();
  world = null;
  eunoe = null;
  upstream = null;
});

async function* agentTurn(params: QueryParams, call: number, requests: number): AsyncGenerator<SDKMessage> {
  const sessionId = `sdk-${call}`;
  yield sdkMessage({ type: 'system', subtype: 'init', session_id: sessionId, fast_mode_state: 'on' });
  const baseUrl = params.options?.env?.ANTHROPIC_BASE_URL ?? '';
  for (let request = 0; request < (baseUrl.startsWith('http://127.0.0.1') ? requests : 0); request += 1) {
    const outputs = Array.from({ length: 3 + request }, () => 4_000);
    await (await sendMessages(baseUrl, sessionId, createMessagesBody(outputs))).text();
  }
  yield sdkMessage({ type: 'result', subtype: 'success', result: 'Done.', is_error: false });
}

interface WorldOptions {
  server?: Partial<EunoeServerOptions>;
  requests?: number;
}

async function openWorld({ server = {}, requests = 1 }: WorldOptions = {}) {
  const params: QueryParams[] = [];
  const dir = join(createTempDir(), 'eunoe');
  const fake = createFakeQuery((call) => {
    params.push(call);
    return agentTurn(call, params.length - 1, requests);
  });
  upstream = startFakeAnthropic();
  eunoe = new EunoeServer({ dir, upstream: upstream.url, window: () => Promise.resolve(4_000), foldFloor: 0, ...server });
  const provider = createClaudeProvider(createFakeRuntime(fake.query), {
    env: {},
    home: createTempDir(),
    eunoe,
  });
  world = await World.create({ providers: () => new ProviderRegistry([provider]) });
  return { w: world, params, dir };
}

function firstRun(w: World, taskId: string): Run | undefined {
  return Object.values(w.state.runs)
    .filter((run) => run.taskId === taskId)
    .sort((a, b) => a.startedAt - b.startedAt)[0];
}

function listNotices(w: World, runId: string): ChatNotice[] {
  return new Transcripts(w.config.transcriptsDir)
    .listEntries(runId)
    .flatMap((entry) => (entry.type === 'notice' ? [entry.notice] : []));
}

function readModes(dir: string) {
  const lines = readFileSync(join(dir, 'requests.jsonl'), 'utf8').trim().split('\n');
  return new Set(lines.map((line) => JSON.parse(line).mode));
}

describe('compacting through eunoe, end to end', () => {
  test('a run goes through Shinsa’s eunoe in compact mode and fast mode, and eunoe’s compaction shows in its chat', async () => {
    const { w, params, dir } = await openWorld();
    await w.engine.dispatch({ type: 'settings.change', patch: { fastMode: true } });
    const taskId = await w.createTask();
    await w.until('the first turn', () => params.length > 0);
    const options = params[0]?.options;
    expect(options?.settings).toMatchObject({ fastMode: true, autoCompactEnabled: false });
    expect(options?.env?.ANTHROPIC_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const runId = firstRun(w, taskId)?.id ?? '';
    await w.until('the compaction notice', () =>
      listNotices(w, runId).some((notice) => notice.kind === 'compaction')
    );
    expect(listNotices(w, runId)).toContainEqual({
      kind: 'compaction',
      trigger: 'auto',
      preTokens: null,
      summary: null,
      by: 'eunoe',
    });
    expect(readModes(dir)).toEqual(new Set(['compact']));
    expect(upstream?.received.length).toBeGreaterThan(0);
  });

  test('picking compaction only still goes through the forwarder and cuts near the limit', async () => {
    const { w, params, dir } = await openWorld();
    await w.engine.dispatch({ type: 'settings.change', patch: { compaction: 'compact' } });
    const taskId = await w.createTask();
    await w.until('the first turn', () => params.length > 0);
    expect(params[0]?.options?.settings).toMatchObject({ autoCompactEnabled: false });
    expect(params[0]?.options?.env?.ANTHROPIC_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const runId = firstRun(w, taskId)?.id ?? '';
    await w.until('the cut', () => listNotices(w, runId).some((notice) => notice.kind === 'compaction'));
    expect(readModes(dir)).toEqual(new Set(['compact']));
  });

  test('when eunoe cannot start the run talks to Claude directly, Claude Code compacts, and the chat says why', async () => {
    const taken = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') });
    const { w, params } = await openWorld({ server: { port: taken.port } });
    const taskId = await w.createTask();
    await w.until('the first turn', () => params.length > 0);
    await taken.stop(true);
    expect(params[0]?.options?.settings).toMatchObject({ autoCompactEnabled: true });
    expect(params[0]?.options?.env?.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com');
    const runId = firstRun(w, taskId)?.id ?? '';
    expect(listNotices(w, runId)).toContainEqual({
      kind: 'proxy',
      proxy: 'eunoe',
      status: 'unavailable',
      detail: expect.stringMatching(/^Eunoe could not start: /),
    });
  });

  test('picking provider compaction and standard speed takes the next run straight to Claude with its own compaction', async () => {
    const { w, params } = await openWorld();
    await w.engine.dispatch({ type: 'settings.change', patch: { compaction: 'provider', fastMode: false } });
    await w.createTask();
    await w.until('the first turn', () => params.length > 0);
    expect(params[0]?.options?.settings).toEqual({
      fastMode: false,
      autoCompactEnabled: true,
      env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com', CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE: '' },
    });
  });

  test('picking off keeps the run direct with no compaction at all', async () => {
    const { w, params } = await openWorld();
    await w.engine.dispatch({ type: 'settings.change', patch: { compaction: 'off' } });
    await w.createTask();
    await w.until('the first turn', () => params.length > 0);
    expect(params[0]?.options?.settings).toMatchObject({ fastMode: false, autoCompactEnabled: false });
    expect(params[0]?.options?.env?.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com');
  });
});
