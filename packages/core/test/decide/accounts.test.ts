import { describe, expect, test } from 'bun:test';
import { isTaskLive } from '../../src/decide/liveness.ts';
import {
  listActiveRuns,
  listOpenGates,
  type RunAccount,
  type RunFailure,
  resolveMessageEffect,
  resolveQueue,
} from '../../src/index.ts';
import {
  completePhase,
  createHarness,
  createTask,
  type Harness,
  linkSession,
  proposePlan,
  shipAndMerge,
} from '../harness.ts';

const WORK: RunAccount = { id: 'acc-work', email: 'work@example.com' };

const HOME: RunAccount = { id: 'acc-home', email: 'home@example.com' };

const HOUR = 60 * 60 * 1000;

function limit(resetAt: number | null, account: RunAccount | null = WORK): RunFailure {
  return {
    class: 'usage_limit',
    message: 'Claude’s usage limit is reached.',
    code: 'rate_limit',
    retryable: true,
    resetAt,
    account,
  };
}

function signedOut(account: RunAccount | null = WORK): RunFailure {
  return {
    class: 'auth',
    message: 'Claude is signed out. Run `claude` in a terminal and sign in again.',
    code: 'authentication_failed',
    retryable: null,
    resetAt: null,
    account,
  };
}

function fail(harness: Harness, taskId: string, failure: RunFailure) {
  const run = harness.activeRun(taskId);
  harness.send({ type: 'run.end', runId: run.id, outcome: 'failed', summary: failure.message, failure });
  return run;
}

function waitingTask(harness: Harness, resetIn = HOUR) {
  const taskId = createTask(harness);
  linkSession(harness, taskId, 'plan-session');
  const run = fail(harness, taskId, limit(harness.state.seq + 1_000 + resetIn));
  return { taskId, run, wait: harness.task(taskId).usageWait };
}

function resetAtOf(harness: Harness, taskId: string) {
  return harness.task(taskId).usageWait?.resetAt ?? 0;
}

function fire(harness: Harness, taskId: string) {
  const wait = harness.task(taskId).usageWait;
  harness.send({ type: 'usage_wait.resume', taskId, waitId: wait?.id ?? 'missing' });
}

describe('binding a task to an account', () => {
  test('a task can be bound to an account, moved to another and released to the pool', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.bind_account', taskId, account: WORK });
    expect(harness.task(taskId).account).toEqual(WORK);
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      actor: 'you',
      kind: 'account',
      text: 'Runs only on work@example.com',
    });
    harness.send({ type: 'task.bind_account', taskId, account: { id: 'acc-x', email: null } });
    expect(harness.task(taskId).activity.at(-1)?.text).toBe('Runs only on a Claude account');
    harness.send({ type: 'task.bind_account', taskId, account: null });
    expect(harness.task(taskId).account).toBeNull();
    expect(harness.task(taskId).activity.at(-1)?.text).toBe('Runs on any account');
  });

  test('binding to the account it already has changes nothing', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.bind_account', taskId, account: WORK });
    const decision = harness.send({ type: 'task.bind_account', taskId, account: { ...WORK } });
    expect(decision.events).toHaveLength(0);
  });

  test('a task can be created bound to an account', () => {
    const harness = createHarness();
    createTask(harness);
    harness.send({ type: 'task.create', request: 'Pinned work', repoId: null, account: HOME });
    const created = Object.values(harness.state.tasks).find((task) => task.request === 'Pinned work');
    expect(created?.account).toEqual(HOME);
  });

  test('a finished task cannot be bound', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.cancel', taskId });
    expect(() => harness.send({ type: 'task.bind_account', taskId, account: WORK })).toThrow(
      'This task is finished. Start a new one.'
    );
  });

  test('a resting task gives up a removed account and can be bound again for its next round', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.bind_account', taskId, account: WORK });
    shipAndMerge(harness, taskId);
    harness.send({ type: 'account.removed', accountId: WORK.id });
    expect(harness.task(taskId).account).toBeNull();
    harness.send({ type: 'task.bind_account', taskId, account: HOME });
    expect(harness.task(taskId).account).toEqual(HOME);
  });

  test('removing an account releases the tasks bound to it and retries the ones waiting to sign in', () => {
    const harness = createHarness();
    const bound = createTask(harness);
    harness.send({ type: 'task.bind_account', taskId: bound, account: WORK });
    const other = createTask(harness, { request: 'Other' });
    harness.send({ type: 'task.bind_account', taskId: other, account: HOME });
    const done = createTask(harness, { request: 'Done' });
    harness.send({ type: 'task.bind_account', taskId: done, account: WORK });
    harness.send({ type: 'task.complete', taskId: done });
    fail(harness, bound, signedOut());
    harness.send({ type: 'account.removed', accountId: WORK.id });
    expect(harness.task(bound).account).toBeNull();
    expect(harness.task(bound).activity.find((entry) => entry.text === 'Runs on any account')?.actor).toBe(
      'shinsa'
    );
    expect(harness.task(other).account).toEqual(HOME);
    expect(harness.task(done).account).toEqual(WORK);
    expect(listOpenGates(harness.state, bound)).toHaveLength(0);
    expect(harness.activeRun(bound)).toMatchObject({ role: 'agent', purpose: 'plan' });
  });
});

describe('running one step on a chosen account', () => {
  test('rerunning a step on an account binds that run, and the step keeps it through recovery, waits and checks', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.bind_account', taskId, account: WORK });
    const before = harness.activeRun(taskId);
    harness.send({ type: 'task.retry', taskId, account: HOME });
    const rerun = harness.activeRun(taskId);
    expect(rerun.id).not.toBe(before.id);
    expect(rerun).toMatchObject({ role: 'agent', purpose: 'plan', account: HOME });
    expect(harness.state.runs[before.id]?.outcome).toBe('cancelled');
    harness.send({ type: 'run.end', runId: rerun.id, outcome: 'failed', summary: 'crashed' });
    expect(harness.activeRun(taskId).account).toEqual(HOME);
    linkSession(harness, taskId, 'plan-session');
    fail(harness, taskId, limit(harness.now + HOUR, HOME));
    harness.advance(2 * HOUR);
    fire(harness, taskId);
    expect(harness.activeRun(taskId).account).toEqual(HOME);
  });

  test('the next step runs on the task’s binding again, not on the account one run was given', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    harness.send({ type: 'task.retry', taskId, account: HOME });
    expect(harness.activeRun(taskId)).toMatchObject({
      role: 'agent',
      purpose: 'build',
      phaseIndex: 0,
      account: HOME,
    });
    completePhase(harness, taskId);
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'build', phaseIndex: 1 });
    expect(harness.activeRun(taskId).account).toBeUndefined();
  });

  test('a monitor wakes the step on its run’s account', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    harness.send({ type: 'task.retry', taskId, account: HOME });
    harness.send({
      type: 'agent.wait_for',
      runId: harness.activeRun(taskId).id,
      checkInMinutes: 5,
      notes: 'The deploy.',
      timeoutMinutes: null,
      maxAttempts: null,
    });
    harness.send({ type: 'monitor.check_in_now', taskId });
    expect(harness.activeRun(taskId).account).toEqual(HOME);
  });

  test('a step with no agent cannot be rerun on an account; a plain retry still works', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    completePhase(harness, taskId);
    completePhase(harness, taskId);
    expect(harness.task(taskId).stage).toBe('checking');
    expect(() => harness.send({ type: 'task.retry', taskId, account: HOME })).toThrow(
      'No agent works on this step, so there is nothing to run on another account.'
    );
    expect(() => harness.send({ type: 'task.retry', taskId })).not.toThrow();
  });
});

describe('the account of each attempt', () => {
  test('an attempt records the account it ran on', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    harness.send({
      type: 'run.attempt',
      runId: run.id,
      attemptId: 'a1',
      provider: 'claude',
      model: 'opus',
      resumed: false,
      handoff: null,
      account: WORK,
    });
    harness.send({
      type: 'run.attempt',
      runId: run.id,
      attemptId: 'a2',
      provider: 'claude',
      model: 'opus',
      resumed: false,
      handoff: null,
    });
    const attempts = harness.state.runs[run.id]?.attempts ?? [];
    expect(attempts[0]?.account).toEqual(WORK);
    expect(attempts[1]).not.toHaveProperty('account');
  });
});

describe('usage-limit waits', () => {
  test('a usage limit with a known reset waits for it instead of opening a gate', () => {
    const harness = createHarness();
    const { taskId, run, wait } = waitingTask(harness);
    expect(wait).toMatchObject({
      runId: run.id,
      role: 'agent',
      account: WORK,
      autoResume: true,
      status: 'armed',
    });
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);
    expect(harness.task(taskId).stageReason).toBe('waiting for the usage limit to reset');
    expect(isTaskLive(harness.state, harness.task(taskId))).toBe(true);
    const queue = resolveQueue(harness.state, harness.state.seq);
    expect(queue.working.map((task) => task.id)).toContain(taskId);
    expect(harness.task(taskId).activity.at(-1)?.text).toBe('Hit the usage limit; resumes when it resets');
    expect(harness.task(taskId).recoveries).toBe(0);
  });

  test('the wait resumes the same session once the limit has reset, and never early or twice', () => {
    const harness = createHarness();
    const { taskId, run } = waitingTask(harness);
    const waitId = harness.task(taskId).usageWait?.id ?? '';
    fire(harness, taskId);
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);
    harness.advance(resetAtOf(harness, taskId));
    fire(harness, taskId);
    const resumed = harness.activeRun(taskId);
    expect(resumed).toMatchObject({
      role: 'agent',
      purpose: 'plan',
      sessionId: 'plan-session',
      usageWaitId: waitId,
    });
    expect(resumed.prompt).toContain('The limit has reset.');
    expect(resumed.prompt?.startsWith(run.rolePrompt ?? '')).toBe(true);
    expect(harness.task(taskId).usageWait?.status).toBe('resumed');
    expect(harness.task(taskId).activity.at(-1)?.text).toBe('Resumed after the usage limit reset');
    const again = harness.send({ type: 'usage_wait.resume', taskId, waitId });
    expect(again.events).toHaveLength(0);
  });

  test('a resume for a wait that was replaced, or for a task that has none, does nothing', () => {
    const harness = createHarness();
    const { taskId } = waitingTask(harness);
    harness.advance(resetAtOf(harness, taskId));
    expect(harness.send({ type: 'usage_wait.resume', taskId, waitId: 'old' }).events).toHaveLength(0);
    expect(harness.send({ type: 'usage_wait.resume', taskId: 'missing', waitId: 'x' }).events).toHaveLength(
      0
    );
  });

  test('the agent that waited resumes its own phase, and asking for auto-resume twice changes nothing', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    const builder = harness.activeRun(taskId);
    harness.send({
      type: 'run.attempt',
      runId: builder.id,
      attemptId: 'a1',
      provider: 'claude',
      model: null,
      resumed: false,
      handoff: null,
    });
    fail(harness, taskId, limit(harness.state.seq + HOUR));
    const wait = harness.task(taskId).usageWait;
    if (!wait) throw new Error('no wait');
    harness.send({
      type: 'usage_wait.change',
      taskId,
      autoResume: true,
    });
    expect(harness.task(taskId).usageWait?.id).toBe(wait.id);
    harness.advance(HOUR * 2);
    fire(harness, taskId);
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'build', phaseIndex: 0 });
  });

  test('a limit that resets without auto-resume pauses the task at the reset', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { autoResume: false } });
    const { taskId, wait } = waitingTask(harness);
    expect(wait?.autoResume).toBe(false);
    expect(harness.task(taskId).stageReason).toBe('paused until the usage limit resets');
    expect(harness.task(taskId).activity.at(-1)?.text).toBe('Hit the usage limit; waits for it to reset');
    harness.advance(resetAtOf(harness, taskId));
    fire(harness, taskId);
    const gate = harness.openGate(taskId);
    expect(gate).toMatchObject({ type: 'failure', title: 'The usage limit has reset' });
    expect(gate.body).toBe(
      'The agent stopped at the Claude usage limit on work@example.com. The limit has reset. Retry to carry on, or cancel the task.'
    );
    expect(harness.task(taskId).usageWait).toBeNull();
    expect(harness.task(taskId).activity.some((entry) => entry.text === 'The usage limit reset')).toBe(true);
  });

  test('a reset without an account says so plainly', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { autoResume: false } });
    const taskId = createTask(harness);
    fail(harness, taskId, limit(harness.state.seq + HOUR, null));
    harness.advance(HOUR * 2);
    fire(harness, taskId);
    expect(harness.openGate(taskId).body.startsWith('The agent stopped at the Claude usage limit. ')).toBe(
      true
    );
  });

  test('the reset names the provider whose limit stopped the agent', () => {
    const harness = createHarness();
    harness.send({
      type: 'settings.change',
      patch: { autoResume: false, agentProviders: { agent: 'codex' } },
    });
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    harness.send({
      type: 'run.attempt',
      runId: run.id,
      attemptId: `${run.id}:1`,
      provider: 'codex',
      model: 'gpt-6-astra',
      resumed: false,
      handoff: null,
    });
    fail(harness, taskId, limit(harness.state.seq + HOUR, null));
    expect(harness.task(taskId).usageWait?.provider).toBe('codex');
    harness.advance(HOUR * 2);
    fire(harness, taskId);
    expect(harness.openGate(taskId).body.startsWith('The agent stopped at the Codex usage limit. ')).toBe(
      true
    );
  });

  test('with auto-resume and snooze off a usage limit pauses at once', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { autoResume: false, snoozeLimited: false } });
    const taskId = createTask(harness);
    fail(harness, taskId, limit(harness.state.seq + HOUR));
    expect(harness.openGate(taskId).title).toBe('The agent hit its usage limit');
    expect(harness.task(taskId).usageWait).toBeUndefined();
  });

  test('a limit whose reset is unknown or already past waits 15 minutes and carries on, never failing', () => {
    for (const resetAt of [null, 1]) {
      const harness = createHarness();
      const taskId = createTask(harness);
      fail(harness, taskId, limit(resetAt));
      const wait = harness.task(taskId).usageWait;
      expect(wait).toMatchObject({ status: 'armed', autoResume: true, account: WORK });
      expect(wait?.resetAt).toBe((wait?.armedAt ?? 0) + 15 * 60_000);
      expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
      harness.advance(15 * 60_000);
      fire(harness, taskId);
      expect(harness.task(taskId).usageWait?.status).toBe('resumed');
      expect(listActiveRuns(harness.state, taskId)).toHaveLength(1);
    }
  });

  test('a resumed step that hits the same window again waits at least 15 minutes more instead of failing', () => {
    const harness = createHarness();
    const { taskId } = waitingTask(harness);
    const resetAt = resetAtOf(harness, taskId);
    harness.advance(resetAt);
    fire(harness, taskId);
    fail(harness, taskId, limit(resetAt));
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
    const wait = harness.task(taskId).usageWait;
    expect(wait).toMatchObject({ status: 'armed' });
    expect(wait?.resetAt).toBe((wait?.armedAt ?? 0) + 15 * 60_000);
  });

  test('a step resumed early that hits the same soon window again waits 15 minutes rather than looping', () => {
    const harness = createHarness();
    const { taskId } = waitingTask(harness, 5 * 60_000);
    const resetAt = resetAtOf(harness, taskId);
    harness.send({ type: 'usage_wait.resume_now', taskId });
    fail(harness, taskId, limit(resetAt));
    const wait = harness.task(taskId).usageWait;
    expect(wait).toMatchObject({ status: 'armed' });
    expect(wait?.resetAt).toBe((wait?.armedAt ?? 0) + 15 * 60_000);
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
  });

  test('a resumed step that hits a later window waits for that one', () => {
    const harness = createHarness();
    const { taskId } = waitingTask(harness);
    const resetAt = resetAtOf(harness, taskId);
    harness.advance(resetAt);
    fire(harness, taskId);
    fail(harness, taskId, limit(harness.state.seq + resetAt + HOUR * 5));
    expect(harness.task(taskId).usageWait?.status).toBe('armed');
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
  });

  test('you can resume a waiting task before the reset', () => {
    const harness = createHarness();
    const { taskId } = waitingTask(harness);
    harness.send({ type: 'usage_wait.resume_now', taskId });
    expect(harness.activeRun(taskId).sessionId).toBe('plan-session');
    expect(harness.task(taskId).activity.at(-1)?.text).toBe('Resumed before the usage limit reset');
    expect(() => harness.send({ type: 'usage_wait.resume_now', taskId })).toThrow(
      'Nothing on this task is waiting for a usage limit to reset.'
    );
  });

  test('turning auto-resume off replaces the wait, so a resume already on its way does nothing', () => {
    const harness = createHarness();
    const { taskId } = waitingTask(harness);
    const first = harness.task(taskId).usageWait?.id ?? '';
    harness.send({ type: 'usage_wait.change', taskId, autoResume: false });
    const second = harness.task(taskId).usageWait;
    expect(second?.id).not.toBe(first);
    expect(second?.autoResume).toBe(false);
    expect(harness.task(taskId).stageReason).toBe('paused until the usage limit resets');
    expect(harness.task(taskId).activity.filter((entry) => entry.kind === 'account')).toHaveLength(1);
    harness.advance(resetAtOf(harness, taskId));
    expect(harness.send({ type: 'usage_wait.resume', taskId, waitId: first }).events).toHaveLength(0);
    harness.send({ type: 'usage_wait.change', taskId, autoResume: true });
    expect(harness.task(taskId).stageReason).toBe('waiting for the usage limit to reset');
    fire(harness, taskId);
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'plan' });
  });

  test('changing a task that waits for nothing is refused', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    expect(() => harness.send({ type: 'usage_wait.change', taskId, autoResume: false })).toThrow(
      'Nothing on this task is waiting for a usage limit to reset.'
    );
  });

  test('retrying, cancelling or starting another step ends the wait', () => {
    const retried = createHarness();
    const first = waitingTask(retried).taskId;
    retried.send({ type: 'task.retry', taskId: first });
    expect(retried.task(first).usageWait).toBeNull();
    expect(retried.activeRun(first).usageWaitId).toBeUndefined();

    const cancelled = createHarness();
    const second = waitingTask(cancelled).taskId;
    cancelled.send({ type: 'task.cancel', taskId: second });
    expect(cancelled.task(second).usageWait).toBeNull();
    expect(cancelled.send({ type: 'usage_wait.resume', taskId: second, waitId: 'x' }).events).toHaveLength(0);

    const resumed = createHarness();
    const third = waitingTask(resumed).taskId;
    resumed.advance(resetAtOf(resumed, third));
    fire(resumed, third);
    proposePlan(resumed, third);
    expect(resumed.task(third).usageWait).toBeNull();
  });

  test('an agent that plans, made to wait on another task drops its wait, and the resume starts nothing', () => {
    const harness = createHarness();
    const other = createTask(harness, { request: 'Other work' });
    const { taskId, wait } = waitingTask(harness);
    harness.send({ type: 'task.wait_on', taskId, waitsOn: [other] });
    expect(harness.task(taskId).stage).toBe('waiting_on_tasks');
    expect(harness.task(taskId).usageWait).toBeNull();
    harness.advance(resetAtOf(harness, taskId) + 2 * HOUR);
    const resume = harness.send({ type: 'usage_wait.resume', taskId, waitId: wait?.id ?? '' });
    expect(resume.events).toHaveLength(0);
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);
  });
});

describe('the sign-in gate', () => {
  test('a signed-out account opens a sign-in gate for that account instead of failing', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const run = fail(harness, taskId, signedOut());
    const gate = harness.openGate(taskId);
    expect(gate).toMatchObject({
      type: 'sign_in',
      title: 'Paused: work@example.com needs signing in',
      provider: 'claude',
      account: WORK,
      runId: run.id,
    });
    expect(gate.body).toBe(
      'Claude signed this account out, so the agent stopped. Signing in starts the step again.'
    );
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      actor: 'shinsa',
      kind: 'failure',
      text: 'Paused: work@example.com needs signing in',
      runId: run.id,
      gateType: 'sign_in',
    });
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);
    const queue = resolveQueue(harness.state, harness.state.seq);
    expect(queue.ready.find((entry) => entry.task.id === taskId)?.reason).toBe(
      'An agent needs you to sign in again'
    );
  });

  test('a sign-in gate keeps the specific reason when the account is not just signed out', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    fail(harness, taskId, {
      ...signedOut(),
      message: 'The Claude account is on hold. Check the account, then sign in again.',
      code: 'account_on_hold',
    });
    expect(harness.openGate(taskId).body).toBe(
      'The Claude account is on hold. Check the account, then sign in again. Signing in starts the step again.'
    );
  });

  test('an account with no email asks to sign in to Claude', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    fail(harness, taskId, signedOut({ id: 'acc-x', email: null }));
    expect(harness.openGate(taskId).title).toBe('Paused: Claude needs signing in');
  });

  test('signing the account in again retries every task waiting on it, and only those', () => {
    const harness = createHarness();
    const first = createTask(harness);
    const second = createTask(harness, { request: 'Second' });
    const elsewhere = createTask(harness, { request: 'Elsewhere' });
    fail(harness, first, signedOut());
    fail(harness, second, signedOut());
    fail(harness, elsewhere, signedOut(HOME));
    harness.send({ type: 'account.signed_in', account: WORK });
    expect(harness.activeRun(first)).toMatchObject({ role: 'agent', purpose: 'plan' });
    expect(harness.activeRun(second)).toMatchObject({ role: 'agent', purpose: 'plan' });
    expect(harness.openGate(elsewhere).account).toEqual(HOME);
    const answered = Object.values(harness.state.gates).filter(
      (gate) => gate.type === 'sign_in' && gate.status === 'answered'
    );
    expect(answered.map((gate) => gate.decision)).toEqual(['approve', 'approve']);
  });

  test('you can retry without signing in, or cancel the task', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    fail(harness, taskId, signedOut());
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'approve',
      response: null,
    });
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'plan' });
    fail(harness, taskId, signedOut());
    expect(() =>
      harness.send({
        type: 'gate.answer',
        gateId: harness.openGate(taskId).id,
        decision: 'revise',
        response: null,
      })
    ).toThrow('Sign in, retry or cancel the task.');
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'reject',
      response: null,
    });
    expect(harness.task(taskId).stage).toBe('cancelled');
  });

  test('a message to a task waiting to sign in retries the step with it as guidance', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    fail(harness, taskId, signedOut());
    const gate = harness.openGate(taskId);
    expect(resolveMessageEffect(harness.state, harness.task(taskId))).toBe('retry');
    harness.send({ type: 'task.message', taskId, text: 'I signed in on the other account.' });
    expect(harness.state.gates[gate.id]).toMatchObject({
      status: 'answered',
      decision: 'reply',
      response: 'I signed in on the other account.',
    });
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
    expect(harness.activeRun(taskId).prompt).toContain('I signed in on the other account.');
  });

  test('a retry withdraws the sign-in gate', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    fail(harness, taskId, signedOut());
    harness.send({ type: 'task.retry', taskId });
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
  });

  test('a signed-out run with no known account keeps the plain failure gate', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    fail(harness, taskId, signedOut(null));
    expect(harness.openGate(taskId)).toMatchObject({
      type: 'failure',
      title: 'The agent needs you to sign in',
    });
  });

  test('a provider with a login of its own opens a Sign in gate that names the provider and no account', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const run = fail(harness, taskId, {
      ...signedOut(null),
      message: 'Codex is signed out.',
      login: { provider: 'codex', email: 'me@example.com' },
    });
    expect(harness.openGate(taskId)).toMatchObject({
      type: 'sign_in',
      title: 'Paused: me@example.com needs signing in',
      body: 'Codex signed this account out, so the agent stopped. Signing in starts the step again.',
      provider: 'codex',
      account: null,
      runId: run.id,
    });
    const other = createTask(harness, { request: 'Other' });
    fail(harness, other, { ...signedOut(null), login: { provider: 'codex', email: null } });
    expect(harness.openGate(other).title).toBe('Paused: Codex needs signing in');
  });

  test('a provider’s sign-in answers only that provider’s gates, and an account’s only its own', () => {
    const harness = createHarness();
    const codex = createTask(harness, { request: 'Codex' });
    const cursor = createTask(harness, { request: 'Cursor' });
    const claude = createTask(harness, { request: 'Claude' });
    fail(harness, codex, { ...signedOut(null), login: { provider: 'codex', email: null } });
    fail(harness, cursor, { ...signedOut(null), login: { provider: 'cursor', email: null } });
    fail(harness, claude, signedOut());
    harness.send({ type: 'account.signed_in', account: { id: 'codex', email: null } });
    expect(
      listOpenGates(harness.state)
        .map((gate) => gate.taskId)
        .sort()
    ).toEqual([codex, cursor, claude].sort());
    harness.send({ type: 'provider.record_sign_in', provider: 'claude' });
    expect(harness.openGate(claude).account).toEqual(WORK);
    harness.send({ type: 'provider.record_sign_in', provider: 'codex' });
    expect(harness.activeRun(codex)).toMatchObject({ role: 'agent', purpose: 'plan' });
    expect(harness.openGate(cursor).provider).toBe('cursor');
    expect(harness.openGate(claude).provider).toBe('claude');
    expect(harness.send({ type: 'provider.record_sign_in', provider: 'codex' }).events).toEqual([]);
  });
});
