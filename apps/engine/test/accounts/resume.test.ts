import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { join } from 'node:path';
import { DomainError, type UsageWait } from '@shinsa/core';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { resolveResumeCommandId } from '../../src/accounts/resume/command.ts';
import { UsageResume } from '../../src/accounts/resume/service.ts';
import { Engine } from '../helpers/engine.ts';
import { openEventLog } from '../helpers/event-log.ts';
import { captureLogs, createTempDir, createTestConfig, until } from '../helpers/index.ts';
import { type AccountsHarness, buildAccounts } from './harness.ts';

const MINUTE = 60_000;

const spies: { mockRestore: () => void }[] = [];

const open: AccountsHarness[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) await harness.close();
  for (const spy of spies.splice(0)) spy.mockRestore();
});

async function createResume(
  engine: Engine,
  now: number,
  timings: { graceMs?: number; retryMs?: number } = {}
) {
  const harness = await buildAccounts({
    config: createTestConfig(createTempDir()),
    engine: {
      ...engine.core,
      dispatch: (command, options) => TestClock.withLive(engine.core.dispatch(command, options)),
    },
    now,
    resume: { graceMs: timings.graceMs ?? 0, retryMs: timings.retryMs ?? MINUTE },
  });
  open.push(harness);
  const resume = harness.service(UsageResume);
  return {
    fireDue: () => harness.run(resume.fireDue),
    start: () => harness.run(resume.start),
    stop: () => harness.run(resume.stop),
    setTime: harness.setTime,
    adjust: harness.adjust,
  };
}

function shiftEngineClock() {
  const realNow = Date.now;
  const shift = { ms: 0 };
  spies.push(spyOn(Date, 'now').mockImplementation(() => realNow.call(Date) + shift.ms));
  return shift;
}

async function startPlanning() {
  const log = openEventLog(join(createTempDir(), 'shinsa.sqlite'));
  const engine = new Engine(log);
  await engine.dispatch({
    type: 'repo.register',
    repo: {
      name: 'app',
      path: '/code/app',
      defaultBranch: 'main',
      remote: null,
      checkCommands: [],
    },
    projectName: null,
  });
  await engine.dispatch({ type: 'task.create', request: 'Fix the tab scroll', repoId: null });
  const taskId = Object.keys(engine.state.tasks)[0] as string;
  const repoId = Object.keys(engine.state.repos)[0] as string;
  await engine.dispatch({
    type: 'task.triage',
    taskId,
    title: 'Fix',
    repoId,
    size: 'small',
    branch: 'fix/a',
    waitsOn: [],
  });
  await engine.dispatch({ type: 'worktree.ready', taskId, path: '/wt/a', branch: 'fix/a' });
  return { engine, log, taskId };
}

function findRunningRun(engine: Engine, taskId: string) {
  const run = Object.values(engine.state.runs).find(
    (candidate) => candidate.taskId === taskId && candidate.endedAt === null
  );
  if (!run) throw new Error('no running run');
  return run;
}

async function hitUsageLimit(engine: Engine, taskId: string, resetAt: number) {
  await engine.dispatch({
    type: 'run.end',
    runId: findRunningRun(engine, taskId).id,
    outcome: 'failed',
    summary: 'Claude’s usage limit is reached.',
    failure: {
      class: 'usage_limit',
      message: 'Claude’s usage limit is reached.',
      code: 'rate_limit',
      retryable: true,
      resetAt,
      account: { id: 'acc-1', email: 'me@x.dev' },
    },
  });
  return selectWait(engine, taskId);
}

function selectWait(engine: Engine, taskId: string) {
  return engine.state.tasks[taskId]?.usageWait as UsageWait;
}

async function armWait(resetIn = MINUTE) {
  const planning = await startPlanning();
  const wait = await hitUsageLimit(planning.engine, planning.taskId, Date.now() + resetIn);
  return { ...planning, wait };
}

function spyOnDispatch(engine: Engine) {
  const dispatch = spyOn(engine.core, 'dispatch');
  spies.push(dispatch);
  return dispatch;
}

describe('usage resume clock', () => {
  test('the command id is fixed by the task, the run, the reset and the wait', () => {
    const wait = { id: 'wait-1', runId: 'run-1', resetAt: 1_700_000_000_000 } as UsageWait;
    expect(resolveResumeCommandId('task-1', wait)).toBe('usage-resume:task-1:run-1:1700000000000:wait-1');
  });

  test('once the reset has passed the task resumes under that command id', async () => {
    const shift = shiftEngineClock();
    const { engine, log, taskId, wait } = await armWait();
    expect(wait).toMatchObject({
      status: 'armed',
      autoResume: true,
      account: { id: 'acc-1', email: 'me@x.dev' },
    });
    const dispatch = spyOnDispatch(engine);
    shift.ms = MINUTE + 1;
    await (await createResume(engine, wait.resetAt)).fireDue();
    const id = `usage-resume:${taskId}:${wait.runId}:${wait.resetAt}:${wait.id}`;
    expect(dispatch.mock.calls).toEqual([[{ type: 'usage_wait.resume', taskId, waitId: wait.id }, { id }]]);
    expect(log.selectReceipt(id)).not.toBeNull();
    expect(selectWait(engine, taskId).status).toBe('resumed');
    expect(findRunningRun(engine, taskId)).toMatchObject({
      role: 'agent',
      purpose: 'plan',
      usageWaitId: wait.id,
    });
    expect(findRunningRun(engine, taskId).id).not.toBe(wait.runId);
  });

  test('nothing is resumed before the reset plus the grace period', async () => {
    const shift = shiftEngineClock();
    const { engine, taskId, wait } = await armWait();
    const dispatch = spyOnDispatch(engine);
    const resume = await createResume(engine, wait.resetAt + 4_999, { graceMs: 5_000 });
    await resume.fireDue();
    expect(dispatch).not.toHaveBeenCalled();
    expect(selectWait(engine, taskId).status).toBe('armed');
    shift.ms = MINUTE + 5_000;
    await resume.setTime(wait.resetAt + 5_000);
    await resume.fireDue();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(selectWait(engine, taskId).status).toBe('resumed');
  });

  test('two checks at once resume the task only once', async () => {
    const shift = shiftEngineClock();
    const { engine, wait } = await armWait();
    const dispatch = spyOnDispatch(engine);
    shift.ms = MINUTE + 1;
    const resume = await createResume(engine, wait.resetAt);
    await Promise.all([resume.fireDue(), resume.fireDue()]);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  test('started after a wait was armed, the clock resumes the task by itself once the reset passes', async () => {
    const shift = shiftEngineClock();
    const { engine, taskId, wait } = await armWait();
    shift.ms = MINUTE + 1;
    const resume = await createResume(engine, wait.resetAt);
    await resume.start();
    await resume.start();
    await resume.adjust(1);
    await until('the resume', () => selectWait(engine, taskId).status === 'resumed');
    await resume.stop();
  });

  test('a resume that fails is logged and tried again a retry later, under a new id', async () => {
    const shift = shiftEngineClock();
    const { engine, taskId, wait } = await armWait();
    shift.ms = MINUTE + 1;
    const logs = captureLogs();
    spies.push({ mockRestore: logs.restore });
    spyOnDispatch(engine).mockImplementationOnce(() =>
      Effect.fail(new DomainError({ code: 'busy', message: 'database is locked' }))
    );
    const dispatched = spyOnDispatch(engine);
    const resume = await createResume(engine, wait.resetAt);
    await resume.fireDue();
    expect(logs.fieldsOf('[Accounts] Could not resume a task after the usage limit reset')).toEqual([
      { taskId, error: 'database is locked' },
    ]);
    expect(selectWait(engine, taskId).status).toBe('armed');
    await resume.setTime(wait.resetAt + MINUTE);
    await resume.fireDue();
    expect(selectWait(engine, taskId).status).toBe('resumed');
    const id = resolveResumeCommandId(taskId, wait);
    expect(dispatched.mock.calls.map(([, options]) => options?.id)).toEqual([id, `${id}:2`]);
  });

  test('a resume the engine ignores is tried again a retry later under a new id, never in a loop', async () => {
    const { engine, taskId, wait } = await armWait();
    const dispatched = spyOnDispatch(engine);
    const resume = await createResume(engine, wait.resetAt);
    await resume.fireDue();
    expect(selectWait(engine, taskId).status).toBe('armed');
    await resume.setTime(wait.resetAt + MINUTE - 1);
    await resume.fireDue();
    expect(dispatched).toHaveBeenCalledTimes(1);
    const shift = shiftEngineClock();
    shift.ms = 2 * MINUTE;
    await resume.setTime(wait.resetAt + MINUTE);
    await resume.fireDue();
    expect(selectWait(engine, taskId).status).toBe('resumed');
    expect(dispatched.mock.calls.map(([, options]) => options?.id)).toEqual([
      resolveResumeCommandId(taskId, wait),
      `${resolveResumeCommandId(taskId, wait)}:2`,
    ]);
  });

  test('after a restart, a retry is a new command at once instead of replaying the ones already tried', async () => {
    const { engine, taskId, wait } = await armWait();
    await (await createResume(engine, wait.resetAt)).fireDue();
    await (await createResume(engine, wait.resetAt + MINUTE)).fireDue();
    expect(selectWait(engine, taskId).status).toBe('armed');
    const shift = shiftEngineClock();
    shift.ms = 2 * MINUTE;
    await (await createResume(engine, wait.resetAt + 2 * MINUTE)).fireDue();
    expect(selectWait(engine, taskId).status).toBe('resumed');
  });

  test('a wait resumed by hand is not resumed again when its reset passes', async () => {
    const { engine, taskId, wait } = await armWait();
    await engine.dispatch({ type: 'usage_wait.resume_now', taskId });
    const dispatched = spyOnDispatch(engine);
    await (await createResume(engine, wait.resetAt)).fireDue();
    expect(dispatched).not.toHaveBeenCalled();
  });

  test('a reset months away is not resumed when the longest timer fires', async () => {
    const { engine, taskId } = await startPlanning();
    const resume = await createResume(engine, 0);
    await resume.start();
    await hitUsageLimit(engine, taskId, Date.now() + MINUTE);
    const dispatched = spyOnDispatch(engine);
    await resume.adjust(2 ** 31 - 1);
    expect(dispatched).not.toHaveBeenCalled();
    expect(selectWait(engine, taskId).status).toBe('armed');
    await resume.stop();
  });

  test('a stopped clock resumes nothing, even once a reset passes', async () => {
    const { engine, taskId, wait } = await armWait();
    const resume = await createResume(engine, wait.resetAt - MINUTE);
    await resume.start();
    await resume.stop();
    const shift = shiftEngineClock();
    shift.ms = 2 * MINUTE;
    await resume.adjust(2 * MINUTE);
    expect(selectWait(engine, taskId).status).toBe('armed');
  });
});
