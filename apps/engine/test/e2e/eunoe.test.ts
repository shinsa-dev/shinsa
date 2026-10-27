import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ChatNotice, Run } from '@shinsa/core';
import { createClaudeProvider } from '../../src/agents/providers/claude/index.ts';
import { ProviderRegistry } from '../../src/agents/providers/index.ts';
import { Transcripts } from '../../src/agents/transcripts/index.ts';
import { EunoeProxy } from '../../src/eunoe/index.ts';
import { createTempDir } from '../helpers/index.ts';
import { createFakeQuery, createFakeRuntime, type QueryParams, sdkMessage } from '../helpers/query.ts';
import { World } from './harness.ts';

setDefaultTimeout(30_000);

const FAKE_EUNOE = resolve(import.meta.dirname, '../helpers/bin/eunoe');

let world: World | null = null;

let proxy: EunoeProxy | null = null;

afterEach(async () => {
  await world?.dispose();
  await proxy?.stop();
  world = null;
  proxy = null;
});

async function* agentTurn(params: QueryParams, call: number, folds: string[]): AsyncGenerator<SDKMessage> {
  const sessionId = `sdk-${call}`;
  yield sdkMessage({ type: 'system', subtype: 'init', session_id: sessionId, fast_mode_state: 'on' });
  const baseUrl = params.options?.env?.ANTHROPIC_BASE_URL ?? '';
  for (const fold of baseUrl.startsWith('http://127.0.0.1') ? folds : []) {
    await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'x-claude-code-session-id': sessionId },
      body: JSON.stringify({ fold }),
    });
  }
  yield sdkMessage({ type: 'result', subtype: 'success', result: 'Done.', is_error: false });
}

interface WorldOptions {
  command?: string[];
  folds?: string[];
}

async function openWorld(dir: string, { command = [FAKE_EUNOE], folds = ['cut'] }: WorldOptions = {}) {
  const params: QueryParams[] = [];
  const clock = { now: Date.now() };
  const fake = createFakeQuery((call) => {
    params.push(call);
    return agentTurn(call, params.length - 1, folds);
  });
  proxy = new EunoeProxy({ dir, command, pollMs: 5, now: () => clock.now });
  const link = proxy;
  const provider = createClaudeProvider(createFakeRuntime(fake.query), {
    env: {},
    home: createTempDir(),
    eunoe: link,
  });
  world = await World.create({ providers: () => new ProviderRegistry([provider]) });
  return { w: world, params, clock };
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

describe('compacting through eunoe, end to end', () => {
  test('a run goes through Shinsa’s eunoe in compact mode and fast mode, and eunoe’s compaction shows in its chat', async () => {
    const dir = join(createTempDir(), 'eunoe');
    const { w, params } = await openWorld(dir);
    await w.engine.dispatch({ type: 'settings.change', patch: { fastMode: true } });
    const taskId = await w.createTask();
    await w.until('the first turn', () => params.length > 0);
    const options = params[0]?.options;
    expect(options?.settings).toMatchObject({ fastMode: true, autoCompactEnabled: false });
    expect(options?.env?.ANTHROPIC_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))).toMatchObject({ mode: 'compact' });
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
  });

  test('picking eunoe always fold runs eunoe in its default mode, and each fold is a quiet line in the chat', async () => {
    const dir = join(createTempDir(), 'eunoe');
    const { w, params } = await openWorld(dir, { folds: ['roll', 'roll'] });
    await w.engine.dispatch({ type: 'settings.change', patch: { compaction: 'eunoe_default' } });
    const taskId = await w.createTask();
    await w.until('the first turn', () => params.length > 0);
    expect(params[0]?.options?.settings).toMatchObject({ autoCompactEnabled: false });
    expect(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))).toMatchObject({ mode: 'default' });
    const runId = firstRun(w, taskId)?.id ?? '';
    await w.until(
      'both folds',
      () => listNotices(w, runId).filter((notice) => notice.kind === 'compaction').length === 2
    );
    expect(listNotices(w, runId).filter((notice) => notice.kind === 'compaction')).toEqual([
      { kind: 'compaction', trigger: 'fold', preTokens: null, summary: null, by: 'eunoe' },
      { kind: 'compaction', trigger: 'fold', preTokens: null, summary: null, by: 'eunoe' },
    ]);
    const requests = readFileSync(join(dir, 'requests.jsonl'), 'utf8').trim().split('\n');
    expect(new Set(requests.map((line) => JSON.parse(line).mode))).toEqual(new Set(['default']));
  });

  test('when eunoe cannot start the run talks to Claude directly, Claude Code compacts, and the chat says why', async () => {
    const dir = join(createTempDir(), 'eunoe');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'fake.json'), JSON.stringify({ fail: 'eunoe: port in use' }));
    const { w, params } = await openWorld(dir);
    const taskId = await w.createTask();
    await w.until('the first turn', () => params.length > 0);
    expect(params[0]?.options?.settings).toMatchObject({ autoCompactEnabled: true });
    expect(params[0]?.options?.env?.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com');
    const runId = firstRun(w, taskId)?.id ?? '';
    expect(listNotices(w, runId)).toContainEqual({
      kind: 'proxy',
      proxy: 'eunoe',
      status: 'unavailable',
      detail: 'Eunoe stopped before it answered: eunoe: port in use.',
    });
  });

  test('when eunoe is missing the run goes direct and says so, and a run a minute later goes through eunoe', async () => {
    const bin = join(createTempDir(), 'eunoe');
    const dir = join(createTempDir(), 'eunoe');
    const { w, params, clock } = await openWorld(dir, { command: [bin] });
    const first = await w.createTask();
    await w.until('the first turn', () => params.length > 0);
    expect(params[0]?.options?.env?.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com');
    expect(params[0]?.options?.settings).toMatchObject({ autoCompactEnabled: true, fastMode: false });
    expect(listNotices(w, firstRun(w, first)?.id ?? '')).toContainEqual({
      kind: 'proxy',
      proxy: 'eunoe',
      status: 'unavailable',
      detail: `Eunoe was not found at ${bin}.`,
    });
    symlinkSync(FAKE_EUNOE, bin);
    clock.now += 60_000;
    const second = await w.createTask('Add the farewell files');
    const secondNotices = () =>
      Object.values(w.state.runs)
        .filter((run) => run.taskId === second)
        .flatMap((run) => listNotices(w, run.id));
    await w.until('the compaction notice', () =>
      secondNotices().some((notice) => notice.kind === 'compaction')
    );
    expect(secondNotices().some((notice) => notice.kind === 'proxy')).toBe(false);
    expect(
      params.some((call) => call.options?.env?.ANTHROPIC_BASE_URL?.startsWith('http://127.0.0.1:'))
    ).toBe(true);
  });

  test('picking Claude Code’s compaction and standard speed takes the next run straight to Claude', async () => {
    const { w, params } = await openWorld(join(createTempDir(), 'eunoe'));
    await w.engine.dispatch({ type: 'settings.change', patch: { compaction: 'claude', fastMode: false } });
    await w.createTask();
    await w.until('the first turn', () => params.length > 0);
    expect(params[0]?.options?.settings).toEqual({
      fastMode: false,
      autoCompactEnabled: true,
      env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com', CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE: '' },
    });
  });

  test('picking off keeps the run direct with no compaction at all', async () => {
    const { w, params } = await openWorld(join(createTempDir(), 'eunoe'));
    await w.engine.dispatch({ type: 'settings.change', patch: { compaction: 'off' } });
    await w.createTask();
    await w.until('the first turn', () => params.length > 0);
    expect(params[0]?.options?.settings).toMatchObject({ fastMode: false, autoCompactEnabled: false });
    expect(params[0]?.options?.env?.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com');
  });
});
