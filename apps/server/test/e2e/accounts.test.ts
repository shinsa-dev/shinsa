import { afterEach, describe, expect, setDefaultTimeout, setSystemTime, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { listOpenGates, type RunFailure } from '@shinsa/core';
import { Cswap } from '../../src/accounts/cswap.ts';
import { Accounts, UsageResumeClock } from '../../src/accounts/index.ts';
import { resolveResumeCommandId } from '../../src/accounts/resume.ts';
import type { StoredAccount } from '../../src/accounts/store.ts';
import { Transcripts } from '../../src/agents/index.ts';
import type { CommandResult } from '../../src/shell/index.ts';
import { AgentFailure, PLAN, toolPlan, World } from './harness.ts';

setDefaultTimeout(30_000);

const worlds: World[] = [];

const clocks: UsageResumeClock[] = [];

const RESET_IN_MS = 60_000;

afterEach(async () => {
  setSystemTime();
  for (const clock of clocks.splice(0)) clock.stop();
  for (const world of worlds.splice(0)) await world.dispose();
});

function failure(overrides: Partial<RunFailure>): RunFailure {
  return {
    class: 'usage_limit',
    message: 'Claude’s usage limit is reached.',
    code: 'rate_limit',
    retryable: true,
    resetAt: null,
    ...overrides,
  };
}

function ok(stdout: string): CommandResult {
  return { ok: true, code: 0, stdout, stderr: '', timedOut: false };
}

interface Bench {
  world: World;
  accounts: Accounts;
  added: StoredAccount[];
  clock: UsageResumeClock;
}

async function createBench(emails: string[]): Promise<Bench> {
  let accounts: Accounts | null = null;
  const world = await World.create({
    supervise: (current, engine) => {
      const shared = join(current.root, 'claude');
      mkdirSync(join(shared, 'projects'), { recursive: true });
      accounts = new Accounts({
        engine,
        config: current.config,
        env: { CLAUDE_CONFIG_DIR: shared },
        run: (command, _cwd, options) => {
          const dir = options.env?.CLAUDE_CONFIG_DIR ?? '';
          const email = accounts?.store.list().find((account) => account.configDir === dir)?.email;
          if (command[1] === 'auth' && command[2] === 'status') {
            return Promise.resolve(ok(JSON.stringify({ loggedIn: true, email, subscriptionType: 'max' })));
          }
          return Promise.resolve(ok(''));
        },
        readSecret: () => Promise.resolve(null),
        cswap: new Cswap({ run: () => Promise.resolve(ok('')), which: () => null }),
        resolveClaude: () => Promise.resolve('claude'),
        spawnLogin: () => ({ write: () => undefined, kill: () => undefined, exited: Promise.resolve(0) }),
      });
      return { accounts, onRejection: accounts.onRejection, onNotice: accounts.onNotice };
    },
  });
  worlds.push(world);
  const ready = accounts as unknown as Accounts;
  const added = emails.map((email) => ready.store.create('login', { email, plan: 'max' }));
  const clock = new UsageResumeClock(world.engine, { graceMs: 0 });
  clocks.push(clock);
  clock.start();
  return { world, accounts: ready, added, clock };
}

function limitAt(resetAt: number) {
  return () => {
    throw new AgentFailure(failure({ resetAt }));
  };
}

async function passReset(clock: UsageResumeClock, resetAt: number) {
  setSystemTime(new Date(resetAt + 1));
  await clock.fireDue();
}

function plan() {
  return async (agent: { call: (name: string, input: Record<string, unknown>) => Promise<string> }) => {
    await agent.call('propose_plan', toolPlan(PLAN));
  };
}

function listAttemptEmails(world: World, runId: string) {
  return world.state.runs[runId]?.attempts?.map((attempt) => attempt.account?.email ?? null) ?? [];
}

function readNotices(world: World, runId: string) {
  return new Transcripts(world.config.transcriptsDir)
    .listEntries(runId)
    .flatMap((entry) =>
      entry.type === 'notice' && entry.notice.kind === 'account_switched' ? [entry.notice] : []
    );
}

describe('accounts end to end', () => {
  test('a rejected turn moves across three accounts, one try each, and goes on where one has room', async () => {
    const { world, added } = await createBench(['a@example.com', 'b@example.com', 'c@example.com']);
    const later = Date.now() + 60 * 60_000;
    world.agents.queue('planner', limitAt(later), limitAt(later + 1), plan());
    const taskId = await world.createTask();
    await world.untilStage(taskId, 'building');
    const planners = world.agents.of('planner');
    expect(planners.map((session) => session.account)).toEqual(added.map((account) => account.id));
    const plannerRun = Object.values(world.state.runs).find((run) => run.role === 'planner');
    expect(listAttemptEmails(world, plannerRun?.id ?? '')).toEqual([
      'a@example.com',
      'b@example.com',
      'c@example.com',
    ]);
    expect(readNotices(world, plannerRun?.id ?? '')).toEqual([
      { kind: 'account_switched', email: 'b@example.com', previous: 'a@example.com', reason: 'usage_limit' },
      { kind: 'account_switched', email: 'c@example.com', previous: 'b@example.com', reason: 'usage_limit' },
    ]);
    await world.until('the builder', () => world.agents.of('builder').length > 0);
    expect(world.agents.of('builder')[0]?.account).toBe(added[2]?.id);
  });

  test('when every account is spent the run waits for the first reset of the pool, then resumes there', async () => {
    const { world, added, clock } = await createBench(['a@example.com', 'b@example.com', 'c@example.com']);
    const now = Date.now();
    world.agents.queue(
      'planner',
      limitAt(now + 60 * 60_000),
      limitAt(now + RESET_IN_MS),
      limitAt(now + 30 * 60_000),
      plan()
    );
    const taskId = await world.createTask();
    await world.until('the wait', () => world.task(taskId).usageWait?.status === 'armed');
    expect(world.agents.of('planner')).toHaveLength(3);
    expect(world.task(taskId).usageWait).toMatchObject({ resetAt: now + RESET_IN_MS, autoResume: true });
    expect(world.task(taskId).stageReason).toBe('waiting for the usage limit to reset');
    expect(listOpenGates(world.state, taskId)).toHaveLength(0);
    await passReset(clock, now + RESET_IN_MS);
    await world.untilStage(taskId, 'building');
    const resumed = world.agents.of('planner')[3];
    expect(resumed?.account).toBe(added[1]?.id);
    expect(resumed?.resume).toBe(world.agents.of('planner')[2]?.sessionId);
    expect(resumed?.prompt).toContain('The limit has reset.');
  });

  test('a task bound to an account never moves: it waits for that account to reset and resumes on it', async () => {
    const { world, added, clock } = await createBench(['a@example.com', 'b@example.com']);
    const bound = added[1] as StoredAccount;
    const resetAt = Date.now() + RESET_IN_MS;
    world.agents.queue('planner', limitAt(resetAt), plan());
    const taskId = await world.createTask();
    await world.engine.dispatch({
      type: 'task.bind_account',
      taskId,
      account: { id: bound.id, email: bound.email },
    });
    await world.until('the wait', () => world.task(taskId).usageWait?.status === 'armed');
    expect(world.agents.of('planner').map((session) => session.account)).toEqual([bound.id]);
    expect(world.task(taskId).usageWait?.account).toEqual({ id: bound.id, email: 'b@example.com' });
    await passReset(clock, resetAt);
    await world.untilStage(taskId, 'building');
    expect(world.agents.of('planner').map((session) => session.account)).toEqual([bound.id, bound.id]);
    await world.until('the builder', () => world.agents.of('builder').length > 0);
    expect(world.agents.of('builder')[0]?.account).toBe(bound.id);
  });

  test('the resume after a reset is sent once, however often the clock fires', async () => {
    const { world, clock } = await createBench(['a@example.com']);
    const resetAt = Date.now() + RESET_IN_MS;
    world.agents.queue('planner', limitAt(resetAt), async (agent) => {
      await agent.hang();
    });
    const taskId = await world.createTask();
    await world.until('the wait', () => world.task(taskId).usageWait?.status === 'armed');
    const wait = world.task(taskId).usageWait;
    if (!wait) throw new Error('no wait');
    await passReset(clock, resetAt);
    await world.until('the resume', () => world.agents.of('planner').length === 2);
    await world.engine.dispatch(
      { type: 'usage_wait.resume', taskId, waitId: wait.id },
      { id: resolveResumeCommandId(taskId, wait) }
    );
    await clock.fireDue();
    expect(world.agents.of('planner')).toHaveLength(2);
  });

  test('a window that is still spent after its reset pauses the task instead of looping', async () => {
    const { world, clock } = await createBench(['a@example.com']);
    const resetAt = Date.now() + RESET_IN_MS;
    world.agents.queue('planner', limitAt(resetAt), limitAt(resetAt));
    const taskId = await world.createTask();
    await world.until('the wait', () => world.task(taskId).usageWait?.status === 'armed');
    await passReset(clock, resetAt);
    const gate = await world.untilGate(taskId, 'failure');
    expect(gate.title).toBe('The agent hit its usage limit');
    expect(world.agents.of('planner')).toHaveLength(2);
    expect(world.task(taskId).usageWait).toBeNull();
  });

  test('an account that is signed out opens a sign-in gate, and signing in again carries on', async () => {
    const { world, accounts, added } = await createBench(['a@example.com']);
    const only = added[0] as StoredAccount;
    world.agents.queue(
      'planner',
      () => {
        throw new AgentFailure(
          failure({
            class: 'auth',
            message: 'Claude is signed out.',
            code: 'authentication_failed',
            retryable: null,
          })
        );
      },
      plan()
    );
    const taskId = await world.createTask();
    const gate = await world.untilGate(taskId, 'sign_in');
    expect(gate).toMatchObject({ title: 'Sign in to Claude as a@example.com', account: { id: only.id } });
    expect(world.agents.of('planner')).toHaveLength(1);
    expect(accounts.snapshot().accounts[0]?.signIn).toBe('signed_out');
    await accounts.startLogin(only.id);
    await world.untilStage(taskId, 'building');
    expect(world.agents.of('planner').map((session) => session.account)).toEqual([only.id, only.id]);
  });

  test('a signed-out account hands the turn to another signed-in account straight away', async () => {
    const { world, added } = await createBench(['a@example.com', 'b@example.com']);
    world.agents.queue(
      'planner',
      () => {
        throw new AgentFailure(failure({ class: 'auth', message: 'Claude is signed out.', retryable: null }));
      },
      plan()
    );
    const taskId = await world.createTask();
    await world.untilStage(taskId, 'building');
    expect(world.agents.of('planner').map((session) => session.account)).toEqual(
      added.map((account) => account.id)
    );
  });
});
