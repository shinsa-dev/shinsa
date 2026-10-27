import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { isDelegatedRun, type Run } from '@shinsa/core';
import { Cswap } from '../../src/accounts/cswap.ts';
import { Accounts } from '../../src/accounts/index.ts';
import { Transcripts } from '../../src/agents/index.ts';
import { createCodexProvider } from '../../src/agents/providers/codex/index.ts';
import { type AgentProvider, ProviderRegistry } from '../../src/agents/providers/index.ts';
import type { Engine } from '../../src/runtime/index.ts';
import { FakeCodex, type FakeCodexStep } from '../helpers/codex.ts';
import { World } from './harness.ts';

setDefaultTimeout(30_000);

let world: World | null = null;

afterEach(async () => {
  await world?.dispose();
  world = null;
});

const READY: FakeCodexStep = { plan: [{ step: 'Work', status: 'inProgress' }] };

interface Opened {
  w: World;
  codex: FakeCodex;
}

function superviseAccounts(current: World, engine: Engine) {
  const shared = join(current.root, 'claude');
  mkdirSync(shared, { recursive: true });
  const unused = () => Promise.resolve({ ok: false, code: 1, stdout: '', stderr: '', timedOut: false });
  const accounts = new Accounts({
    engine,
    config: current.config,
    env: { CLAUDE_CONFIG_DIR: shared },
    run: unused,
    readSecret: () => Promise.resolve(null),
    cswap: new Cswap({ run: unused, which: () => null }),
    resolveClaude: () => Promise.resolve('claude'),
    spawnLogin: () => ({ write: () => undefined, kill: () => undefined, exited: Promise.resolve(0) }),
    providerUsage: [
      {
        id: 'codex',
        read: () => Promise.resolve({ read: { ok: true, windows: [] }, email: null, plan: null }),
      },
    ],
  });
  return { accounts, onRejection: accounts.onRejection, onNotice: accounts.onNotice };
}

async function open(
  options: { claude?: boolean; codex?: FakeCodex; accounts?: boolean } = {}
): Promise<Opened> {
  const codex = options.codex ?? new FakeCodex();
  world = await World.create({
    providers: (created) => {
      const providers: AgentProvider[] = [createCodexProvider(codex.runtime, { heartbeatMs: 50 })];
      if (options.claude) providers.unshift(created.agents.provider('claude', 'Claude'));
      return new ProviderRegistry(providers);
    },
    ...(options.accounts ? { supervise: superviseAccounts } : {}),
  });
  if (!options.claude)
    await world.engine.dispatch({ type: 'settings.change', patch: { defaultProvider: 'codex' } });
  return { w: world, codex };
}

function listRuns(w: World, taskId: string): Run[] {
  return Object.values(w.state.runs)
    .filter((run) => run.taskId === taskId)
    .sort((a, b) => a.startedAt - b.startedAt);
}

function untilScripted(w: World, codex: FakeCodex) {
  return w.until('the scripted turn to run', () => codex.log.some((entry) => entry.script === 'scripted'));
}

function threads(codex: FakeCodex) {
  return codex.requests('thread/start').map((params) => ({
    sandbox: params.sandbox,
    approvalPolicy: params.approvalPolicy,
    model: params.model,
  }));
}

describe('a task on Codex', () => {
  test('plans, builds, reviews and merges with every agent on Codex, the round agent on one thread', async () => {
    const { w, codex } = await open();
    const taskId = await w.createTask();
    await w.untilStage(taskId, 'awaiting_review');
    expect(listRuns(w, taskId).map((run) => [run.role, run.purpose, run.provider, run.model])).toEqual([
      ['agent', 'plan', 'codex', 'gpt-6-astra'],
      ['agent', 'build', 'codex', 'gpt-6-astra'],
      ['agent', 'build', 'codex', 'gpt-6-astra'],
      ['reviewer', undefined, 'codex', 'gpt-6-astra'],
    ]);
    expect(threads(codex)).toEqual([
      { sandbox: 'read-only', approvalPolicy: 'never', model: 'gpt-6-astra' },
      { sandbox: 'read-only', approvalPolicy: 'never', model: 'gpt-6-astra' },
    ]);
    const thread = listRuns(w, taskId)[0]?.sessionId;
    expect(
      codex
        .requests('thread/resume')
        .map((params) => [params.threadId, params.sandbox, params.approvalPolicy])
    ).toEqual([
      [thread, 'danger-full-access', 'untrusted'],
      [thread, 'danger-full-access', 'untrusted'],
    ]);
    const task = w.task(taskId);
    expect(await w.branchLog(task.branch ?? '')).toEqual([
      'fix: write the second file',
      'fix: write the first file',
    ]);
    expect(
      listRuns(w, taskId).every((run) => (run.usage?.inputTokens ?? 0) > 0 && (run.usage?.costUsd ?? 0) > 0)
    ).toBe(true);
    await w.answer(await w.untilGate(taskId, 'review'), 'approve');
    await w.until('the pull request to open', () => w.task(taskId).pullRequest !== null);
    w.github.update(1, { checks: 'passing' });
    await w.sync(taskId);
    await w.answer(await w.untilGate(taskId, 'merge'), 'approve');
    await w.untilStage(taskId, 'merged');
  });

  test('a message while a Codex agent works steers its turn', async () => {
    const { w, codex } = await open();
    codex.script('plan', [READY, { waitSteer: true }, { default: true }]);
    const taskId = await w.createTask();
    await untilScripted(w, codex);
    await w.until('the planner’s to-do to show', () => {
      const run = listRuns(w, taskId)[0];
      const entries = run ? new Transcripts(w.config.transcriptsDir).listEntries(run.id) : [];
      return entries.some((entry) => entry.type === 'tool_call' && entry.tool.kind === 'todo');
    });
    await w.engine.dispatch({ type: 'task.message', taskId, text: 'Keep it tiny.' });
    await w.untilStage(taskId, 'awaiting_review');
    expect(String(codex.requests('turn/steer')[0]?.prompt)).toContain('Keep it tiny.');
  });

  test('cancelling the task interrupts the Codex turn and stops its app server', async () => {
    const { w, codex } = await open();
    codex.script('plan', [READY, { hang: true }]);
    const taskId = await w.createTask();
    await untilScripted(w, codex);
    await w.until('the session to link', () => listRuns(w, taskId).some((entry) => entry.sessionId !== null));
    await w.engine.dispatch({ type: 'task.cancel', taskId });
    await w.until('the run to end', () => listRuns(w, taskId).every((run) => run.endedAt !== null));
    await w.until('the turn to be interrupted', () => codex.requests('turn/interrupt').length === 1);
    expect(w.task(taskId).stage).toBe('cancelled');
  });
});

describe('Codex sessions across restarts', () => {
  test('a graceful restart resumes the same Codex thread', async () => {
    const { w, codex } = await open();
    codex.script('plan', [READY, { hang: true }]);
    const taskId = await w.createTask();
    await w.until('the session to link', () => listRuns(w, taskId).some((entry) => entry.sessionId !== null));
    await untilScripted(w, codex);
    const threadId = listRuns(w, taskId)[0]?.sessionId ?? '';
    await w.restartGracefully();
    await w.untilStage(taskId, 'awaiting_review');
    expect(codex.requests('thread/resume')[0]).toMatchObject({ threadId });
    expect(String(codex.requests('turn/start')[1]?.prompt)).toContain('re-check the state of any file');
  });

  test('a thread Codex lost is restored from the transcript on a fresh thread', async () => {
    const { w, codex } = await open();
    codex.script('plan', [READY, { say: 'I read the repository.' }, { hang: true }]);
    const taskId = await w.createTask();
    await w.until('the session to link', () => listRuns(w, taskId).some((entry) => entry.sessionId !== null));
    await untilScripted(w, codex);
    const lost = listRuns(w, taskId)[0]?.sessionId;
    codex.update((state) => {
      state.threads = state.threads.filter((known) => known !== lost);
    });
    await w.restart();
    await w.untilStage(taskId, 'awaiting_review');
    const thread = listRuns(w, taskId)[0]?.sessionId;
    expect(thread).not.toBe(lost);
    expect(codex.requests('thread/resume').map((params) => params.threadId)).toEqual([lost, thread, thread]);
    const restored = String(codex.requests('turn/start')[1]?.prompt);
    expect(restored).toContain('<handoff_transcript>');
    expect(restored).toContain('could not be resumed');
    const run = listRuns(w, taskId)[0];
    expect(run?.attempts?.at(-1)?.handoff).toMatchObject({
      reason: 'session_restore',
      fromProvider: 'codex',
    });
  });
});

describe('Codex failures reach core as their class', () => {
  test('a usage limit waits for the reset of the window Codex reported spent', async () => {
    const { w, codex } = await open({ accounts: true });
    const resetsAt = Math.floor(Date.now() / 1000) + 3_600;
    codex.script('plan', [
      { limits: { primary: { usedPercent: 100, windowDurationMins: 300, resetsAt } } },
      { fail: { info: 'usageLimitExceeded', message: 'You hit your usage limit.' } },
    ]);
    const taskId = await w.createTask();
    await w.until('the usage wait', () => w.task(taskId).usageWait?.status === 'armed');
    expect(w.task(taskId).usageWait).toMatchObject({
      resetAt: resetsAt * 1000,
      provider: 'codex',
      account: null,
    });
    expect(w.task(taskId).stageReason).toBe('waiting for the usage limit to reset');
  });

  test('a signed-out Codex pauses the task and says to run codex login', async () => {
    const { w, codex } = await open();
    codex.script('plan', [{ fail: { info: 'unauthorized', message: 'Unauthorized' } }]);
    const taskId = await w.createTask();
    const gate = await w.untilGate(taskId, 'failure');
    expect(gate.title).toBe('The agent needs you to sign in');
    expect(gate.body).toContain('`codex login`');
  });

  test('a crashed app server resumes the step once on the same thread', async () => {
    const { w, codex } = await open();
    codex.script('plan', [{ say: 'Reading.' }, { crash: 'codex panicked' }]);
    const taskId = await w.createTask();
    await w.untilStage(taskId, 'awaiting_review');
    const [crashed, resumed] = listRuns(w, taskId);
    expect(crashed?.failure).toMatchObject({ class: 'transport_error' });
    expect(crashed?.summary).toContain('codex panicked');
    expect(resumed?.sessionId).toBe(crashed?.sessionId ?? '');
    expect(codex.requests('thread/resume')[0]).toMatchObject({ threadId: crashed?.sessionId });
  });
});

describe('Claude and Codex together', () => {
  test('moving the agent from Claude to Codex mid-step hands the conversation over, and the round stays on Codex', async () => {
    const { w, codex } = await open({ claude: true });
    w.agents.queue('plan', (agent) => agent.hang());
    const taskId = await w.createTask();
    await w.until('the Claude planner to start', () => w.agents.of('plan').length === 1);
    await w.engine.dispatch({ type: 'settings.change', patch: { agentProviders: { agent: 'codex' } } });
    await w.restart();
    await w.until('the Codex planner', () => codex.requests('turn/start').length === 1);
    expect(String(codex.requests('turn/start')[0]?.prompt)).toContain('from another coding agent (Claude)');
    await w.untilStage(taskId, 'awaiting_review');
    const run = listRuns(w, taskId)[0];
    expect(run?.attempts?.map((attempt) => [attempt.provider, attempt.model])).toEqual([
      ['claude', 'opus'],
      ['codex', 'gpt-6-astra'],
    ]);
    expect(run?.sessionProvider).toBe('codex');
    const builds = listRuns(w, taskId).filter((other) => other.purpose === 'build');
    expect(builds.map((other) => [other.provider, other.sessionId])).toEqual([
      ['codex', run?.sessionId ?? null],
      ['codex', run?.sessionId ?? null],
    ]);
  });

  test('a Claude agent delegates a review to Codex, which stays read-only, and a reviewer cannot delegate writing', async () => {
    const { w, codex } = await open({ claude: true });
    let reply = '';
    let refused = '';
    w.agents.queue('build', async (agent) => {
      reply = await agent.call('delegate_task', {
        brief: 'Check that a.txt says phase 1.',
        title: 'Check the file',
        role: 'reviewer',
        mode: 'wait',
        provider: 'codex',
      });
      agent.write('a.txt', 'phase 1\n');
      await agent.call('complete_phase', {
        summary: 'Wrote it.',
        spots: [{ file: 'a.txt', start: 1, end: 1, attention: 'normal', why: 'The new file.' }],
        judgement_calls: [],
      });
    });
    w.agents.queue('reviewer', async (agent) => {
      refused = await agent
        .call('delegate_task', { brief: 'Rewrite b.txt.', role: 'builder', provider: 'codex' })
        .catch((error: Error) => error.message);
      await agent.call('report_review', { findings: [] });
    });
    const taskId = await w.createTask();
    await w.untilStage(taskId, 'awaiting_review');
    const child = listRuns(w, taskId).find((run) => isDelegatedRun(run));
    expect(child).toMatchObject({ provider: 'codex', role: 'reviewer', outcome: 'completed' });
    expect(threads(codex)).toEqual([{ sandbox: 'read-only', approvalPolicy: 'never', model: 'gpt-6-astra' }]);
    expect(JSON.parse(reply)).toMatchObject({
      status: 'completed',
      provider: 'codex',
      result: 'Handed over.',
    });
    expect(refused).toContain('reviewer');
    expect(listRuns(w, taskId).filter((run) => isDelegatedRun(run))).toHaveLength(1);
  });

  test('a Codex agent delegates to a Claude agent through Shinsa’s tools', async () => {
    const { w, codex } = await open({ claude: true });
    await w.engine.dispatch({ type: 'settings.change', patch: { agentProviders: { agent: 'codex' } } });
    codex.script('build', [
      {
        tool: 'delegate_task',
        args: {
          brief: 'Survey the tests.',
          title: 'Survey',
          role: 'planner',
          mode: 'wait',
          provider: 'claude',
        },
      },
      { default: true },
    ]);
    w.agents.queue('planner', async (agent) => {
      agent.say('The tests live in test/.');
    });
    const taskId = await w.createTask();
    await w.untilStage(taskId, 'awaiting_review');
    const child = listRuns(w, taskId).find((run) => isDelegatedRun(run));
    expect(child).toMatchObject({ provider: 'claude', role: 'planner', outcome: 'completed' });
    expect(codex.log.find((entry) => entry.tool === 'delegate_task')).toMatchObject({ isError: false });
  });
});
