import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import type { Run, RunFailureClass } from '@shinsa/core';
import type { ClaudeExecutable } from '../../src/agents/providers/claude/executable.ts';
import { createClaudeProvider } from '../../src/agents/providers/claude/index.ts';
import { ProviderRegistry } from '../../src/agents/providers/index.ts';
import { createTempDir } from '../helpers/index.ts';
import { createFakeQuery, createFakeRuntime, emit, type QueryParams } from '../helpers/query.ts';
import { World } from './harness.ts';

setDefaultTimeout(30_000);

let world: World | null = null;

afterEach(async () => {
  await world?.dispose();
  world = null;
});

type Script = (call: number) => unknown[];

let resumedSession: string | undefined;

function init(call: number) {
  return { type: 'system', subtype: 'init', session_id: resumedSession ?? `sdk-${call}` };
}

function result(extra: Record<string, unknown>) {
  return { type: 'result', subtype: 'success', result: '', is_error: false, ...extra };
}

const IDLE: Script = (call) => [init(call), result({ result: 'Done without handing over.' })];

function fakeSdk(scripts: Script[], executable?: ClaudeExecutable) {
  const params: QueryParams[] = [];
  const fake = createFakeQuery((call) => {
    params.push(call);
    resumedSession = call.options?.resume;
    const index = params.length - 1;
    return emit(...(scripts[index] ?? IDLE)(index));
  });
  const runtime = createFakeRuntime(fake.query, executable);
  const provider = createClaudeProvider(runtime, { env: {}, home: createTempDir() });
  return { params, registry: () => new ProviderRegistry([provider]) };
}

async function openWithSdk(scripts: Script[], executable?: ClaudeExecutable) {
  const sdk = fakeSdk(scripts, executable);
  world = await World.create({ providers: sdk.registry });
  return { w: world, sdk };
}

function listRuns(w: World, taskId: string): Run[] {
  return Object.values(w.state.runs)
    .filter((run) => run.taskId === taskId)
    .sort((a, b) => a.startedAt - b.startedAt);
}

describe('every way a turn can end reaches core as its class', () => {
  test('a usage limit pauses the task at once, keeping the reset time for automatic resume', async () => {
    const { w, sdk } = await openWithSdk([
      (call) => [
        init(call),
        {
          type: 'rate_limit_event',
          rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: 7_200 },
        },
        result({ is_error: true, terminal_reason: 'api_error', result: 'Claude AI usage limit reached' }),
      ],
    ]);
    const taskId = await w.createTask();
    const gate = await w.untilGate(taskId, 'question', 'failure');
    expect(gate.title).toBe('The agent hit its usage limit');
    expect(listRuns(w, taskId)[0]?.failure).toMatchObject({ class: 'usage_limit', resetAt: 7_200_000 });
    expect(sdk.params).toHaveLength(1);
    expect(listRuns(w, taskId)).toHaveLength(1);
  });

  test('a signed-out account and a claude that cannot run pause the task with what to do', async () => {
    const signedOut = await openWithSdk([
      (call) => [
        init(call),
        {
          type: 'assistant',
          parent_tool_use_id: null,
          uuid: 'a',
          error: 'authentication_failed',
          message: { content: [] },
        },
        result({ is_error: true, result: 'Invalid API key' }),
      ],
    ]);
    const first = await signedOut.w.createTask();
    expect((await signedOut.w.untilGate(first, 'question', 'failure')).title).toBe(
      'The agent needs you to sign in'
    );
    await signedOut.w.dispose();

    const outdated = await openWithSdk([], { ok: false, reason: 'outdated', message: 'Update Claude Code.' });
    const second = await outdated.w.createTask();
    const gate = await outdated.w.untilGate(second, 'question', 'failure');
    expect(gate.title).toBe('The agent could not start');
    expect(gate.body).toBe('Update Claude Code. Retry starts the step again.');
    expect(outdated.sdk.params).toHaveLength(0);
  });

  test('a full context window recovers on a fresh session told to read the worktree', async () => {
    const { w, sdk } = await openWithSdk([
      (call) => [
        init(call),
        result({ is_error: true, terminal_reason: 'prompt_too_long', result: 'Prompt is too long' }),
      ],
    ]);
    const taskId = await w.createTask();
    await w.until('a second run', () => listRuns(w, taskId).length >= 2);
    const [first, second] = listRuns(w, taskId);
    expect(first?.failure?.class).toBe('context_window_full');
    expect(second?.resume).toBe(false);
    expect(second?.prompt).toContain('so this is a fresh session in the same worktree');
    await w.untilGate(taskId, 'question', 'failure');
    expect(sdk.params[1]?.options).not.toHaveProperty('resume');
  });

  test('an overloaded API, an abort reported as success and a stream with no result resume the session once', async () => {
    const cases: [Script, RunFailureClass, string][] = [
      [
        (call) => [init(call), result({ is_error: true, api_error_status: 529, result: 'Overloaded' })],
        'overloaded',
        'overloaded',
      ],
      [(call) => [init(call), result({ terminal_reason: 'aborted_tools' })], 'aborted', 'interrupted'],
      [(call) => [init(call)], 'transport_error', 'ended before it finished'],
    ];
    for (const [script, failureClass, reason] of cases) {
      const { w, sdk } = await openWithSdk([script]);
      const taskId = await w.createTask();
      await w.until('a second run', () => listRuns(w, taskId).length >= 2);
      const [first, second] = listRuns(w, taskId);
      expect(first?.failure?.class).toBe(failureClass);
      expect(second?.sessionId).toBe('sdk-0');
      expect(second?.prompt).toContain(reason);
      await w.until('the resumed session', () => sdk.params.length >= 2);
      expect(sdk.params[1]?.options?.resume).toBe('sdk-0');
      await w.dispose();
    }
    world = null;
  });
});

describe('restarts', () => {
  test('a graceful shutdown marks the agent, and the next boot continues it once with the carry-on prompt', async () => {
    world = await World.create();
    const w = world;
    w.agents.queue('planner', (agent) => agent.hang());
    const taskId = await w.createTask();
    await w.until('the planner to start', () => w.agents.of('planner').length === 1);
    const hung = w.agents.of('planner')[0];
    const runId = listRuns(w, taskId)[0]?.id ?? '';
    await w.restartGracefully();
    await w.untilStage(taskId, 'awaiting_review');
    const resumed = w.agents.of('planner')[1];
    expect(resumed?.resume).toBe(hung?.sessionId);
    expect(resumed?.prompt).toContain('re-check the state of any file you were editing');
    expect(w.agents.of('planner')[0]?.cancelled).toBe(true);
    const run = w.state.runs[runId];
    expect(run).toMatchObject({ resumePending: false, outcome: 'completed' });
    expect(run?.continuations).toHaveLength(1);
    expect(run?.attempts?.map((attempt) => attempt.resumed)).toEqual([false, true]);
    expect(Object.values(w.state.runs).filter((candidate) => candidate.outcome === 'failed')).toEqual([]);
  });

  test('a run that keeps dying with the server is resumed once, and the next crash opens the failure gate', async () => {
    world = await World.create();
    const w = world;
    for (let index = 0; index < 2; index += 1) w.agents.queue('planner', (agent) => agent.hang());
    const taskId = await w.createTask();
    await w.until('the planner to start', () => w.agents.of('planner').length === 1);
    const runId = listRuns(w, taskId)[0]?.id ?? '';
    await w.restart();
    await w.until('the continuation', () => w.agents.of('planner').length === 2);
    await w.restart();
    const gate = await w.untilGate(taskId, 'question', 'failure');
    expect(gate.title).toBe('The planner paused');
    expect(w.agents.of('planner')).toHaveLength(2);
    expect(w.state.runs[runId]?.failure).toMatchObject({ class: 'aborted', code: 'crash_loop' });
  });

  test('a run whose server keeps shutting down is resumed three times, then handed to bounded recovery', async () => {
    world = await World.create();
    const w = world;
    for (let index = 0; index < 4; index += 1) w.agents.queue('planner', (agent) => agent.hang());
    const taskId = await w.createTask();
    await w.until('the planner to start', () => w.agents.of('planner').length === 1);
    const runId = listRuns(w, taskId)[0]?.id ?? '';
    for (let restart = 1; restart <= 3; restart += 1) {
      await w.restartGracefully();
      await w.until(`continuation ${restart}`, () => w.agents.of('planner').length === restart + 1);
    }
    await w.restartGracefully();
    await w.untilStage(taskId, 'awaiting_review');
    const run = w.state.runs[runId];
    expect(run?.continuations).toHaveLength(3);
    expect(run?.failure).toMatchObject({ class: 'aborted', code: 'restart_loop' });
    const recovery = listRuns(w, taskId).find(
      (candidate) => candidate.id !== runId && candidate.role === 'planner'
    );
    expect(recovery?.sessionId).toBe(w.agents.of('planner')[0]?.sessionId);
    expect(recovery?.prompt).toContain('Shinsa restarted 4 times within 5 minutes');
  });

  test('a session the agent no longer has is restored from the transcript instead of resumed', async () => {
    world = await World.create({
      providers: (created) => new ProviderRegistry([created.agents.provider('claude', 'Claude')]),
    });
    const w = world;
    w.agents.queue('planner', (agent) => agent.hang());
    const taskId = await w.createTask();
    await w.until('the planner to start', () => w.agents.of('planner').length === 1);
    const hung = w.agents.of('planner')[0];
    w.agents.lost.add(hung?.sessionId ?? '');
    await w.restart();
    await w.untilStage(taskId, 'awaiting_review');
    const restored = w.agents.of('planner')[1];
    expect(restored?.resume).toBeNull();
    expect(restored?.prompt).toContain('<handoff_transcript>');
    expect(restored?.prompt).toContain('could not be resumed');
    const run = listRuns(w, taskId)[0];
    expect(run?.sessionId).toBe(restored?.sessionId);
    expect(run?.sessionLost).toBe(false);
    expect(run?.attempts?.at(-1)?.handoff).toMatchObject({
      reason: 'session_restore',
      fromProvider: 'claude',
    });
  });

  test('switching provider while a run is paused hands the conversation over at its next turn', async () => {
    world = await World.create({
      providers: (created) =>
        new ProviderRegistry([
          created.agents.provider('claude', 'Claude'),
          created.agents.provider('codex', 'Codex'),
        ]),
    });
    const w = world;
    w.agents.queue('planner', (agent) => agent.hang());
    const taskId = await w.createTask();
    await w.until('the planner to start', () => w.agents.of('planner').length === 1);
    await w.engine.dispatch({ type: 'settings.change', patch: { defaultProvider: 'codex' } });
    await w.restart();
    await w.untilStage(taskId, 'awaiting_review');
    const switched = w.agents.of('planner')[1];
    expect(switched?.resume).toBeNull();
    expect(switched?.prompt).toContain('from another coding agent (Claude)');
    const run = listRuns(w, taskId)[0];
    expect(run?.attempts?.map((attempt) => attempt.provider)).toEqual(['claude', 'codex']);
    expect(run?.sessionProvider).toBe('codex');
  });
});
