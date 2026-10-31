import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HookInput, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { type ChatNotice, resolveCurrentRound, resolveTaskRounds } from '@shinsa/core';
import { resolveClaudeProjectName } from '../../src/agents/providers/claude/artifacts.ts';
import { createClaudeProvider } from '../../src/agents/providers/claude/index.ts';
import { ProviderRegistry } from '../../src/agents/providers/index.ts';
import { Transcripts } from '../../src/agents/transcripts/index.ts';
import { EunoeServer } from '../../src/eunoe/index.ts';
import {
  createMessagesBody,
  type FakeAnthropic,
  sendMessages,
  startFakeAnthropic,
} from '../helpers/anthropic.ts';
import { createTempDir } from '../helpers/index.ts';
import { createFakeQuery, createFakeRuntime, type QueryParams, sdkMessage } from '../helpers/query.ts';
import { World } from './harness.ts';

setDefaultTimeout(60_000);

const ROUNDS = 8;

const RESTART_AT = 4;

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

interface Turn {
  sessionId: string;
  resume: string | null;
  purpose: string;
  round: number;
  disallowed: string[];
  matchers: (string | undefined)[];
  edit: unknown;
  briefed: boolean;
}

const PLAN = {
  goal: 'Ship the round.',
  phases: [
    { title: 'Write the round', detail: 'Write its file.' },
    { title: 'Check the round', detail: 'Check the file is there.' },
  ],
  behaviour: [],
  approach: 'Directly.',
  files: [],
  out_of_scope: [],
  verification: [{ label: 'Round file', command: 'true', phases: [1] }],
  questions: [],
};

async function readBrief(params: QueryParams) {
  const prompt = params.prompt as AsyncIterable<SDKUserMessage>;
  const next = await prompt[Symbol.asyncIterator]().next();
  const content = (next.value as SDKUserMessage | undefined)?.message.content;
  return typeof content === 'string' ? content : '';
}

function resolvePurpose(params: QueryParams, brief: string) {
  if ((params.options?.hooks?.PreToolUse?.length ?? 0) > 1) return 'plan';
  if (brief.includes('Shinsa restarted while you were working')) return 'continued';
  if (brief.includes('Your role: reviewer')) return 'review';
  return /Now build phase \d+ of/.test(brief) ? 'build' : 'unknown';
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

async function hand(params: QueryParams, brief: string, purpose: string, round: number) {
  const cwd = params.options?.cwd ?? '';
  if (purpose === 'plan') await callTool(params, 'propose_plan', PLAN);
  if (purpose === 'build') {
    const phase = /Now build phase (\d+) of/.exec(brief)?.[1] ?? '1';
    writeFileSync(join(cwd, `round-${round}-${phase}.txt`), `round ${round}, phase ${phase}\n`);
    await callTool(params, 'complete_phase', {
      summary: `Wrote round ${round}, phase ${phase}.`,
      spots: [{ file: `round-${round}-${phase}.txt`, start: 1, end: 1, attention: 'normal', why: 'New.' }],
      judgement_calls: [],
    });
  }
  if (purpose === 'review') await callTool(params, 'report_review', { findings: [] });
}

async function tryEdit(params: QueryParams) {
  const hook = params.options?.hooks?.PreToolUse?.find((matcher) => matcher.matcher === 'Write')?.hooks[0];
  const input = { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: {} } as unknown as HookInput;
  if (!hook) return null;
  return await hook(input, undefined, { signal: new AbortController().signal });
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
  const purpose = resolvePurpose(params, brief);
  const round =
    purpose === 'plan'
      ? Number(/This is round (\d+) of the task/.exec(brief)?.[1] ?? 1)
      : (turns.filter((turn) => turn.purpose === 'plan').at(-1)?.round ?? 1);
  turns.push({
    sessionId,
    resume,
    purpose,
    round,
    disallowed: params.options?.disallowedTools ?? [],
    matchers: params.options?.hooks?.PreToolUse?.map((matcher) => matcher.matcher) ?? [],
    edit: await tryEdit(params),
    briefed: brief.includes('Ship the round.'),
  });
  writeSessionFile(home, params.options?.cwd ?? '', sessionId);
  yield sdkMessage({ type: 'system', subtype: 'init', session_id: sessionId });
  const baseUrl = params.options?.env?.ANTHROPIC_BASE_URL ?? '';
  if (baseUrl.startsWith('http://127.0.0.1')) {
    const outputs = Array.from({ length: 3 + call }, () => 4_000);
    await (await sendMessages(baseUrl, sessionId, createMessagesBody(outputs, `Turn ${call}`))).text();
  }
  await hand(params, brief, purpose, round);
  yield sdkMessage({ type: 'result', subtype: 'success', result: 'Done.', is_error: false });
}

async function openWorld() {
  const home = createTempDir();
  const dir = join(createTempDir(), 'eunoe');
  const turns: Turn[] = [];
  let calls = 0;
  const fake = createFakeQuery((params) => agentTurn(params, calls++, home, turns));
  upstream = startFakeAnthropic();
  eunoe = new EunoeServer({
    dir,
    upstream: upstream.url,
    window: () => Promise.resolve(4_000),
    foldFloor: 0,
  });
  const provider = createClaudeProvider(createFakeRuntime(fake.query), { env: {}, home, eunoe });
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
      w.gates(taskId).some((gate) => gate.type === 'merge')
  );
}

describe('a long task that keeps its sessions across rounds', () => {
  test(`${ROUNDS} rounds keep one agent session through eunoe’s compaction and a restart, switching only what it may edit`, async () => {
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

    const planners = turns.filter((turn) => turn.purpose === 'plan');
    const builders = turns.filter((turn) => turn.purpose === 'build');
    const agentTurns = turns.filter((turn) => turn.purpose !== 'review');
    const session = planners[0]?.sessionId ?? '';
    expect(planners).toHaveLength(ROUNDS);
    expect(builders.length).toBeGreaterThanOrEqual(ROUNDS * 2);
    expect(new Set(agentTurns.map((turn) => turn.sessionId))).toEqual(new Set([session]));
    expect(agentTurns.slice(1).every((turn) => turn.resume === session)).toBe(true);
    expect(planners.map((turn) => turn.round)).toEqual(
      Array.from({ length: ROUNDS }, (_, index) => index + 1)
    );
    expect(agentTurns.every((turn) => turn.disallowed.length === 0)).toBe(true);
    expect(planners.every((turn) => turn.matchers.join() === 'Bash,Edit,Write,NotebookEdit,MultiEdit')).toBe(
      true
    );
    expect(builders.every((turn) => turn.matchers.join() === 'Bash' && turn.edit === null)).toBe(true);
    for (const turn of planners) {
      expect(turn.edit).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
    }
    const reviewers = turns.filter((turn) => turn.purpose === 'review');
    expect(reviewers.length).toBeGreaterThanOrEqual(ROUNDS);
    expect(reviewers[0]?.resume).toBeNull();
    expect(reviewers.slice(1).every((turn) => turn.resume === reviewers[0]?.sessionId)).toBe(true);
    expect(reviewers.every((turn) => turn.disallowed.join() === 'Edit,Write,NotebookEdit')).toBe(true);

    const runs = Object.values(w.state.runs).filter((run) => run.taskId === taskId);
    expect(runs.flatMap((run) => run.attempts ?? []).every((attempt) => attempt.handoff === null)).toBe(true);
    expect(runs.every((run) => run.role === 'agent' || run.role === 'reviewer')).toBe(true);
    const plannerRuns = runs
      .filter((run) => run.purpose === 'plan')
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
    expect(threads.filter((thread) => thread?.startsWith(`${session}-`))).toHaveLength(agentTurns.length);
    const folds = readFileSync(join(dir, 'requests.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter((line) => (JSON.parse(line).actions ?? []).includes('fold'));
    expect(folds).toHaveLength(builders.length);
    expect(builders.every((turn) => turn.briefed)).toBe(true);
  });
});
