import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { resolveCurrentRound, resolveTaskRounds } from '@shinsa/core';
import { resolveClaudeProjectName } from '../../src/agents/providers/claude/artifacts.ts';
import { createClaudeProvider } from '../../src/agents/providers/claude/index.ts';
import { ProviderRegistry } from '../../src/agents/providers/index.ts';
import { createTempDir } from '../helpers/index.ts';
import { createFakeQuery, createFakeRuntime, type QueryParams, sdkMessage } from '../helpers/query.ts';
import { World } from './harness.ts';

setDefaultTimeout(60_000);

let world: World | null = null;

afterEach(async () => {
  await world?.dispose();
  world = null;
});

type Purpose = 'plan' | 'build' | 'fix' | 'review' | 'answer' | 'steer';

interface CachedTurn {
  sessionId: string;
  resume: string | null;
  purpose: Purpose;
  cwd: string;
  brief: string;
  prefix: string;
  written: number;
  read: number;
  wholePrefixWritten: boolean;
}

interface CachedSession {
  prefix: string;
  history: number;
  written: number;
  read: number;
}

const PLAN = {
  goal: 'Ship the round.',
  phases: [
    { title: 'Write the round', detail: 'Write its file.' },
    { title: 'Write another file', detail: 'Write a second file.' },
  ],
  behaviour: [],
  approach: 'Directly.',
  files: [{ path: 'turn.txt', change: 'A new file per turn.' }],
  out_of_scope: [],
  verification: [{ label: 'Round file', command: 'true', phases: [1] }],
  questions: [],
};

function countTokens(text: string | number) {
  return Math.ceil((typeof text === 'number' ? text : text.length) / 4);
}

interface SteerWait {
  cwd: string | null;
  blocked: ReturnType<typeof Promise.withResolvers<void>>;
}

async function readBrief(params: QueryParams) {
  const prompt = params.prompt as AsyncIterable<SDKUserMessage>;
  const next = await prompt[Symbol.asyncIterator]().next();
  const content = (next.value as SDKUserMessage | undefined)?.message.content;
  return typeof content === 'string' ? content : '';
}

function isSteeredTurn(wait: SteerWait | null, purpose: Purpose, cwd: string, call: number) {
  if (!wait) return false;
  if (call === 0) wait.cwd = cwd;
  return purpose === 'build' && cwd === wait.cwd && !wait.cwd.endsWith('#steered');
}

async function awaitSteer(params: QueryParams, wait: SteerWait, cwd: string, call: number) {
  writeFileSync(join(cwd, 'turn.txt'), `turn ${call}\n`);
  wait.cwd = `${cwd}#steered`;
  wait.blocked.resolve();
  return readBrief(params);
}

function resolvePurpose(params: QueryParams, brief: string): Purpose {
  if (brief.includes('Your role: reviewer')) return 'review';
  if (brief.includes('Your role: answerer')) return 'answer';
  if (brief.includes('The checks failed after the last change')) return 'fix';
  if ((params.options?.hooks?.PreToolUse?.length ?? 0) > 1) return 'plan';
  return 'build';
}

async function connect(params: QueryParams) {
  const servers = (params.options?.mcpServers ?? {}) as unknown as Record<string, { instance: Server }>;
  const server = Object.values(servers)[0]?.instance;
  if (!server) throw new Error('no Shinsa tools');
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'fake-sdk', version: '1.0.0' });
  await server.connect(serverSide);
  await client.connect(clientSide);
  return client;
}

async function readPrefix(params: QueryParams) {
  const client = await connect(params);
  const { tools } = await client.listTools();
  await client.close();
  const options = params.options ?? {};
  return JSON.stringify({
    tools,
    servers: Object.keys(options.mcpServers ?? {}),
    disallowedTools: options.disallowedTools,
    systemPrompt: options.systemPrompt,
    skills: options.skills,
    plugins: options.plugins,
    settings: options.settings,
    model: options.model,
    permissionMode: options.permissionMode,
  });
}

async function callTool(params: QueryParams, name: string, input: Record<string, unknown>) {
  const client = await connect(params);
  const result = await client.callTool({ name, arguments: input });
  await client.close();
  if (result.isError) throw new Error(JSON.stringify(result.content));
}

async function hand(params: QueryParams, purpose: Purpose, turn: number) {
  const cwd = params.options?.cwd ?? '';
  if (purpose === 'plan') await callTool(params, 'propose_plan', PLAN);
  if (purpose === 'build') {
    writeFileSync(join(cwd, `turn-${turn}.txt`), `turn ${turn}\n`);
    await callTool(params, 'complete_phase', {
      summary: `Wrote turn ${turn}.`,
      spots: [{ file: `turn-${turn}.txt`, start: 1, end: 1, attention: 'normal', why: 'New.' }],
      judgement_calls: [],
    });
  }
  if (purpose === 'fix') {
    writeFileSync(join(cwd, 'fixed.txt'), 'fixed\n');
    await callTool(params, 'complete_fix', { summary: 'Added the file the checks look for.' });
  }
  if (purpose === 'review') await callTool(params, 'report_review', { findings: [] });
  if (purpose === 'answer') await callTool(params, 'answer', { answer: 'Two files.' });
}

const REPLY_CHARACTERS = 200;

function resolveUsage(session: CachedSession) {
  return {
    opus: {
      inputTokens: 3,
      outputTokens: 50,
      cacheReadInputTokens: session.read,
      cacheCreationInputTokens: session.written,
    },
  };
}

function meter(sessions: Map<string, CachedSession>, sessionId: string, prefix: string, brief: string) {
  const cached = sessions.get(sessionId) ?? { prefix: '', history: 0, written: 0, read: 0 };
  const whole = cached.prefix !== prefix;
  const written = whole ? countTokens(prefix.length + cached.history + brief.length) : countTokens(brief);
  const read = whole ? 0 : countTokens(prefix.length + cached.history);
  sessions.set(sessionId, {
    prefix,
    history: cached.history + brief.length + REPLY_CHARACTERS,
    written: cached.written + written,
    read: cached.read + read,
  });
  return { written, read, whole, session: sessions.get(sessionId) as CachedSession };
}

async function* cachedTurn(
  params: QueryParams,
  call: number,
  home: string,
  turns: CachedTurn[],
  sessions: Map<string, CachedSession>,
  wait: SteerWait | null
): AsyncGenerator<SDKMessage> {
  const brief = await readBrief(params);
  const resume = params.options?.resume ?? null;
  const sessionId = resume ?? `sdk-${call}`;
  const purpose = resolvePurpose(params, brief);
  const cwd = params.options?.cwd ?? '';
  const prefix = await readPrefix(params);
  const usage = meter(sessions, sessionId, prefix, brief);
  const record = (text: string, as: Purpose, metered: ReturnType<typeof meter>) =>
    turns.push({
      sessionId,
      resume,
      purpose: as,
      cwd,
      brief: text,
      prefix,
      written: metered.written,
      read: metered.read,
      wholePrefixWritten: metered.whole,
    });
  record(brief, purpose, usage);
  const results = [resolveUsage({ ...usage.session })];
  const dir = join(home, '.claude', 'projects', resolveClaudeProjectName(cwd));
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `${sessionId}.jsonl`), `${JSON.stringify({ type: 'user' })}\n`);
  yield sdkMessage({ type: 'system', subtype: 'init', session_id: sessionId });
  if (wait && isSteeredTurn(wait, purpose, cwd, call)) {
    const steer = await awaitSteer(params, wait, cwd, call);
    const steered = meter(sessions, sessionId, prefix, steer);
    record(steer, 'steer', steered);
    results.push(resolveUsage({ ...steered.session }));
  }
  await hand(params, purpose, call);
  for (const modelUsage of results) {
    yield sdkMessage({
      type: 'result',
      subtype: 'success',
      result: 'Done.',
      is_error: false,
      total_cost_usd: 0,
      modelUsage,
    });
  }
}

async function openWorld(wait: SteerWait | null = null) {
  const home = createTempDir();
  const turns: CachedTurn[] = [];
  const sessions = new Map<string, CachedSession>();
  let calls = 0;
  const fake = createFakeQuery((params) => cachedTurn(params, calls++, home, turns, sessions, wait));
  const provider = createClaudeProvider(createFakeRuntime(fake.query), { env: {}, home });
  world = await World.create({
    checks: ['test -f fixed.txt || ! ls turn-*.txt'],
    providers: () => new ProviderRegistry([provider]),
  });
  return { w: world, turns };
}

async function mergeRound(w: World, taskId: string) {
  const review = await w.untilGate(taskId, 'review');
  await w.answer(review, 'approve');
  await w.until('the push', () => w.task(taskId).pushPending !== true && w.task(taskId).pullRequest !== null);
  w.github.update(w.task(taskId).pullRequest?.number ?? 0, { checks: 'passing' });
  await w.sync(taskId);
  const merge = await w.untilGate(taskId, 'merge');
  await w.answer(merge, 'approve');
  await w.until('the merge', () => w.task(taskId).pullRequest?.state === 'merged');
}

describe('the prompt cache across a task', () => {
  test('one session holds a change, an answer and a change after a merge; only its first turn writes the prefix', async () => {
    const { w, turns } = await openWorld();
    const taskId = await w.createTask('Grow the export');
    await mergeRound(w, taskId);
    await w.engine.dispatch({
      type: 'task.message',
      taskId,
      text: 'How many files did that add?',
      kind: 'new_round',
      shape: 'answer',
    });
    await w.until('the answer', () => w.task(taskId).result?.body === 'Two files.');
    await w.engine.dispatch({
      type: 'task.message',
      taskId,
      text: 'Add one more file',
      kind: 'new_round',
      shape: 'change',
    });
    await w.until('round 3', () => resolveCurrentRound(w.task(taskId)).number === 3);
    await mergeRound(w, taskId);

    expect(resolveTaskRounds(w.task(taskId)).map((round) => round.status)).toEqual([
      'merged',
      'finished',
      'merged',
    ]);
    const working = turns.filter((turn) => turn.purpose !== 'review');
    const reviews = turns.filter((turn) => turn.purpose === 'review');
    expect(new Set(working.map((turn) => turn.purpose))).toEqual(new Set(['plan', 'build', 'fix', 'answer']));
    expect(new Set(working.map((turn) => turn.sessionId)).size).toBe(1);
    expect(working.slice(1).every((turn) => turn.resume === working[0]?.sessionId)).toBe(true);
    expect(new Set(working.map((turn) => turn.prefix)).size).toBe(1);
    expect(new Set(reviews.map((turn) => turn.sessionId)).size).toBe(1);
    expect(reviews.slice(1).every((turn) => turn.resume === reviews[0]?.sessionId)).toBe(true);
    expect(new Set(reviews.map((turn) => turn.prefix)).size).toBe(1);
    expect(turns.filter((turn) => turn.wholePrefixWritten)).toEqual([working[0], reviews[0]] as CachedTurn[]);
    for (const turn of turns.filter((candidate) => !candidate.wholePrefixWritten)) {
      expect(turn.written).toBe(countTokens(turn.brief));
    }

    const moved = working.filter((turn, index) => index > 0 && turn.cwd !== working[index - 1]?.cwd);
    expect(moved.length).toBeGreaterThan(0);
    for (const turn of moved) expect(turn.brief).toContain(`You now work in \`${turn.cwd}\``);

    const runs = Object.values(w.state.runs).filter((run) => run.taskId === taskId);
    const metered = runs.reduce((sum, run) => sum + (run.usage?.cacheWriteTokens ?? 0), 0);
    expect(metered).toBe(turns.reduce((sum, turn) => sum + turn.written, 0));
  });

  test('an Agent told mid-turn that another task changes its files gets the note as a user message, not a new prefix', async () => {
    const wait: SteerWait = { cwd: null, blocked: Promise.withResolvers<void>() };
    const { w, turns } = await openWorld(wait);
    const first = await w.createTask('Grow the export');
    await wait.blocked.promise;
    const second = await w.createTask('Trim the export');
    await w.until('the first phase of both', () =>
      [first, second].every((taskId) => w.task(taskId).phaseReports.length > 0)
    );

    const steer = turns.find((turn) => turn.purpose === 'steer');
    const steered = turns.filter((turn) => turn.sessionId === steer?.sessionId && turn.purpose !== 'review');
    expect(steer?.brief).toStartWith('Another open task changed files this task also changes:');
    expect(steer?.brief).toContain('“Trim the export” (`turn.txt`)');
    expect(steer?.wholePrefixWritten).toBe(false);
    expect(steer?.written).toBe(countTokens(steer?.brief ?? ''));
    expect(new Set(steered.map((turn) => turn.prefix)).size).toBe(1);
    expect(steered.filter((turn) => turn.wholePrefixWritten)).toHaveLength(1);
    const later = steered.slice(steered.indexOf(steer as CachedTurn) + 1);
    expect(later.some((turn) => turn.brief.includes('Another open task'))).toBe(false);
    expect(w.task(first).overlaps?.[0]?.untold).toEqual([]);

    const other = turns.filter((turn) => turn.sessionId !== steer?.sessionId && turn.purpose === 'build');
    expect(other[0]?.brief).toEndWith(
      '“Grow the export” (`turn.txt`). Keep your changes to those files to what this task needs, and call `list_repository_work` to see its branch, its stage and whether an agent works on it now.'
    );
    expect(
      new Set(turns.filter((turn) => turn.sessionId === other[0]?.sessionId).map((turn) => turn.prefix)).size
    ).toBe(1);
  });
});
