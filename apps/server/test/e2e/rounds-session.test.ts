import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { type ChatNotice, resolveCurrentRound, resolveTaskRounds } from '@shinsa/core';
import { resolveClaudeProjectName } from '../../src/agents/providers/claude/artifacts.ts';
import { createClaudeProvider } from '../../src/agents/providers/claude/index.ts';
import { ProviderRegistry } from '../../src/agents/providers/index.ts';
import { Transcripts } from '../../src/agents/transcripts/index.ts';
import { EunoeProxy } from '../../src/eunoe/index.ts';
import { createTempDir } from '../helpers/index.ts';
import { createFakeQuery, createFakeRuntime, type QueryParams, sdkMessage } from '../helpers/query.ts';
import { World } from './harness.ts';

setDefaultTimeout(60_000);

const FAKE_EUNOE = resolve(import.meta.dirname, '../helpers/bin/eunoe');

const ROUNDS = 8;

const RESTART_AT = 4;

let world: World | null = null;

let proxy: EunoeProxy | null = null;

afterEach(async () => {
  await world?.dispose();
  await proxy?.stop();
  world = null;
  proxy = null;
});

interface Turn {
  sessionId: string;
  resume: string | null;
  role: string;
  round: number;
}

const PLAN = {
  goal: 'Ship the round.',
  plan: [
    { title: 'Write the round', detail: 'Write its file.' },
    { title: 'Check the round', detail: 'Check the file is there.' },
  ],
  behaviour: [],
  approach: 'Directly.',
  files: [],
  out_of_scope: [],
  verification: ['The checks pass.'],
  questions: [],
};

async function readBrief(params: QueryParams) {
  const prompt = params.prompt as AsyncIterable<SDKUserMessage>;
  const next = await prompt[Symbol.asyncIterator]().next();
  const content = (next.value as SDKUserMessage | undefined)?.message.content;
  return typeof content === 'string' ? content : '';
}

function resolveRole(brief: string) {
  if (brief.includes('Shinsa restarted while you were working')) return 'continued';
  return /Your role: (\w+)/.exec(brief)?.[1] ?? 'unknown';
}

async function callTool(params: QueryParams, name: string, input: Record<string, unknown>) {
  const servers = (params.options?.mcpServers ?? {}) as unknown as Record<string, { instance: Server }>;
  const server = Object.values(servers)[0]?.instance;
  if (!server) throw new Error('no Shinsa tools');
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'fake-sdk', version: '1.0.0' });
  await server.connect(serverSide);
  await client.connect(clientSide);
  const result = await client.callTool({ name, arguments: input });
  await client.close();
  if (result.isError) throw new Error(JSON.stringify(result.content));
}

function writeSessionFile(home: string, cwd: string, sessionId: string) {
  const dir = join(home, '.claude', 'projects', resolveClaudeProjectName(cwd));
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `${sessionId}.jsonl`), `${JSON.stringify({ type: 'user' })}\n`);
}

async function hand(params: QueryParams, brief: string, role: string, round: number) {
  const cwd = params.options?.cwd ?? '';
  if (role === 'planner') await callTool(params, 'propose_plan', PLAN);
  if (role === 'builder') {
    const phase = /builder for phase (\d+)/.exec(brief)?.[1] ?? '1';
    writeFileSync(join(cwd, `round-${round}-${phase}.txt`), `round ${round}, phase ${phase}\n`);
    await callTool(params, 'complete_phase', {
      summary: `Wrote round ${round}, phase ${phase}.`,
      spots: [{ file: `round-${round}-${phase}.txt`, start: 1, end: 1, attention: 'normal', why: 'New.' }],
      decisions: [],
    });
  }
  if (role === 'reviewer') await callTool(params, 'report_review', { findings: [] });
}

async function* agentTurn(
  params: QueryParams,
  call: number,
  home: string,
  turns: Turn[]
): AsyncGenerator<SDKMessage> {
  const brief = await readBrief(params);
  const resume = params.options?.resume ?? null;
  const sessionId = resume ?? `sdk-${call}`;
  const round = Number(/This is round (\d+) of the task/.exec(brief)?.[1] ?? 1);
  const role = resolveRole(brief);
  turns.push({ sessionId, resume, role, round });
  writeSessionFile(home, params.options?.cwd ?? '', sessionId);
  yield sdkMessage({ type: 'system', subtype: 'init', session_id: sessionId });
  const baseUrl = params.options?.env?.ANTHROPIC_BASE_URL ?? '';
  if (baseUrl.startsWith('http://127.0.0.1')) {
    await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'x-claude-code-session-id': sessionId },
      body: JSON.stringify({ fold: role === 'planner' ? 'roll' : 'cut' }),
    });
  }
  await hand(params, brief, role, round);
  yield sdkMessage({ type: 'result', subtype: 'success', result: 'Done.', is_error: false });
}

async function openWorld() {
  const home = createTempDir();
  const dir = join(createTempDir(), 'eunoe');
  const turns: Turn[] = [];
  let calls = 0;
  const fake = createFakeQuery((params) => agentTurn(params, calls++, home, turns));
  proxy = new EunoeProxy({ dir, command: [FAKE_EUNOE], pollMs: 5 });
  const provider = createClaudeProvider(createFakeRuntime(fake.query), { env: {}, home, eunoe: proxy });
  world = await World.create({ checks: ['true'], providers: () => new ProviderRegistry([provider]) });
  return { w: world, turns, dir };
}

function listNotices(w: World, runId: string): ChatNotice[] {
  return new Transcripts(w.config.transcriptsDir)
    .listEntries(runId)
    .flatMap((entry) => (entry.type === 'notice' ? [entry.notice] : []));
}

async function shipRound(w: World, taskId: string) {
  const round = resolveCurrentRound(w.task(taskId)).number;
  const review = await w.untilGate(taskId, 'review');
  await w.answer(review, 'approve');
  await w.until('the push', () => w.task(taskId).pushPending !== true && w.task(taskId).pullRequest !== null);
  w.github.update(w.task(taskId).pullRequest?.number ?? 0, { checks: 'passing' });
  await w.sync(taskId);
  await w.until(
    'the merge gate or the next round',
    () =>
      resolveCurrentRound(w.task(taskId)).number > round ||
      w.gates(taskId).some((gate) => gate.kind === 'merge')
  );
}

describe('a long task that keeps its sessions across rounds', () => {
  test(`${ROUNDS} rounds reuse the planner’s and the builders’ sessions through eunoe’s compaction, across a restart`, async () => {
    const { w, turns, dir } = await openWorld();
    const taskId = await w.createTask('Grow the MCP v2 integration');
    for (let round = 1; round <= ROUNDS; round += 1) {
      await w.until(`round ${round}`, () => resolveCurrentRound(w.task(taskId)).number === round);
      if (round < ROUNDS) {
        await w.engine.dispatch({
          type: 'task.message',
          taskId,
          text: `Round ${round + 1}: extend it again`,
          kind: 'new_round',
        });
      }
      if (round === RESTART_AT) {
        await w.until(
          'the round to be working',
          () => w.activeRuns(taskId).length > 0 || w.gates(taskId).length > 0
        );
        await w.restartGracefully();
      }
      await shipRound(w, taskId);
    }
    const merge = await w.untilGate(taskId, 'merge');
    await w.answer(merge, 'approve');
    await w.untilStage(taskId, 'merged');

    const task = w.task(taskId);
    expect(resolveTaskRounds(task).map((round) => round.status)).toEqual(Array(ROUNDS).fill('merged'));
    expect(new Set(resolveTaskRounds(task).map((round) => round.pullRequest?.number))).toEqual(new Set([1]));
    expect(w.github.pulls).toHaveLength(1);

    const planners = turns.filter((turn) => turn.role === 'planner');
    const builders = turns.filter((turn) => turn.role === 'builder');
    expect(planners).toHaveLength(ROUNDS);
    expect(new Set(planners.map((turn) => turn.sessionId)).size).toBe(1);
    expect(planners.slice(1).every((turn) => turn.resume === planners[0]?.sessionId)).toBe(true);
    for (let round = 2; round <= ROUNDS; round += 1) {
      const opening = builders.find((turn) => turn.round === round);
      const previous = builders.filter((turn) => turn.round === round - 1).at(-1);
      expect(opening?.resume, `round ${round}'s first builder`).toBe(previous?.sessionId ?? null);
    }
    expect(planners.map((turn) => turn.round)).toEqual(
      Array.from({ length: ROUNDS }, (_, index) => index + 1)
    );
    expect(turns.filter((turn) => turn.role === 'reviewer').every((turn) => turn.resume === null)).toBe(true);

    const runs = Object.values(w.state.runs).filter((run) => run.taskId === taskId);
    expect(runs.flatMap((run) => run.attempts ?? []).every((attempt) => attempt.handoff === null)).toBe(true);
    const plannerRuns = runs
      .filter((run) => run.role === 'planner')
      .sort((a, b) => a.startedAt - b.startedAt);
    expect(plannerRuns.map((run) => run.round ?? 1)).toEqual(
      Array.from({ length: ROUNDS }, (_, index) => index + 1)
    );
    for (const run of plannerRuns) {
      await w.until(`the folds of ${run.id}`, () =>
        listNotices(w, run.id).some((notice) => notice.kind === 'compaction' && notice.by === 'eunoe')
      );
    }
    const threads = readFileSync(join(dir, 'requests.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).thread as string);
    expect(threads.filter((thread) => thread === `${planners[0]?.sessionId}-fingerprint`)).toHaveLength(
      ROUNDS
    );
  });
});
