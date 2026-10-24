import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { join } from 'node:path';
import type { UsageWait } from '@shinsa/core';
import { resolveResumeCommandId, UsageResumeClock } from '../../src/accounts/resume.ts';
import { log as logger } from '../../src/log/index.ts';
import { Engine } from '../../src/runtime/engine.ts';
import { EventLog } from '../../src/store/index.ts';
import { createTempDir, until } from '../helpers/index.ts';

const MINUTE = 60_000;

const spies: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

function shiftEngineClock() {
  const realNow = Date.now;
  const shift = { ms: 0 };
  spies.push(spyOn(Date, 'now').mockImplementation(() => realNow.call(Date) + shift.ms));
  return shift;
}

async function startPlanning() {
  const log = new EventLog(join(createTempDir(), 'shinsa.sqlite'));
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
  const dispatch = spyOn(engine, 'dispatch');
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
    await new UsageResumeClock(engine, { now: () => wait.resetAt, graceMs: 0 }).fireDue();
    const id = `usage-resume:${taskId}:${wait.runId}:${wait.resetAt}:${wait.id}`;
    expect(dispatch.mock.calls).toEqual([[{ type: 'usage_wait.resume', taskId, waitId: wait.id }, { id }]]);
    expect(log.selectReceipt(id)).not.toBeNull();
    expect(selectWait(engine, taskId).status).toBe('resumed');
    expect(findRunningRun(engine, taskId)).toMatchObject({ role: 'planner', usageWaitId: wait.id });
    expect(findRunningRun(engine, taskId).id).not.toBe(wait.runId);
  });

  test('nothing is resumed before the reset plus the grace period', async () => {
    const shift = shiftEngineClock();
    const { engine, taskId, wait } = await armWait();
    const dispatch = spyOnDispatch(engine);
    const clock = { now: wait.resetAt + 4_999 };
    const resume = new UsageResumeClock(engine, { now: () => clock.now, graceMs: 5_000 });
    await resume.fireDue();
    expect(dispatch).not.toHaveBeenCalled();
    expect(selectWait(engine, taskId).status).toBe('armed');
    shift.ms = MINUTE + 5_000;
    clock.now += 1;
    await resume.fireDue();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(selectWait(engine, taskId).status).toBe('resumed');
  });

  test('a round already running is shared instead of resuming twice', async () => {
    const shift = shiftEngineClock();
    const { engine, wait } = await armWait();
    const dispatch = spyOnDispatch(engine);
    shift.ms = MINUTE + 1;
    const resume = new UsageResumeClock(engine, { now: () => wait.resetAt, graceMs: 0 });
    const first = resume.fireDue();
    expect(resume.fireDue()).toBe(first);
    await first;
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  test('started after a wait was armed, the clock resumes the task by itself once the reset passes', async () => {
    const shift = shiftEngineClock();
    const { engine, taskId, wait } = await armWait();
    shift.ms = MINUTE + 1;
    const resume = new UsageResumeClock(engine, { now: () => wait.resetAt, graceMs: 0 });
    resume.start();
    resume.start();
    await until('the resume', () => selectWait(engine, taskId).status === 'resumed');
    resume.stop();
  });

  test('a resume that fails is logged and tried again a retry later, under a new id', async () => {
    const shift = shiftEngineClock();
    const { engine, taskId, wait } = await armWait();
    shift.ms = MINUTE + 1;
    const warn = spyOn(logger, 'warn').mockImplementation(() => undefined);
    spies.push(warn);
    spyOnDispatch(engine).mockImplementationOnce(() => Promise.reject(new Error('database is locked')));
    const dispatched = spyOnDispatch(engine);
    const clock = { now: wait.resetAt };
    const resume = new UsageResumeClock(engine, { now: () => clock.now, graceMs: 0, retryMs: MINUTE });
    await resume.fireDue();
    expect(warn).toHaveBeenCalledWith('[Accounts] Could not resume a task after the usage limit reset', {
      taskId,
      error: 'database is locked',
    });
    expect(selectWait(engine, taskId).status).toBe('armed');
    clock.now += MINUTE;
    await resume.fireDue();
    expect(selectWait(engine, taskId).status).toBe('resumed');
    const id = resolveResumeCommandId(taskId, wait);
    expect(dispatched.mock.calls.map(([, options]) => options?.id)).toEqual([id, `${id}:2`]);
  });

  test('a resume the engine ignores is tried again a retry later under a new id, never in a loop', async () => {
    const { engine, taskId, wait } = await armWait();
    const dispatched = spyOnDispatch(engine);
    const clock = { now: wait.resetAt };
    const resume = new UsageResumeClock(engine, { now: () => clock.now, graceMs: 0, retryMs: MINUTE });
    await resume.fireDue();
    expect(selectWait(engine, taskId).status).toBe('armed');
    clock.now += MINUTE - 1;
    await resume.fireDue();
    expect(dispatched).toHaveBeenCalledTimes(1);
    const shift = shiftEngineClock();
    shift.ms = 2 * MINUTE;
    clock.now += 1;
    await resume.fireDue();
    expect(selectWait(engine, taskId).status).toBe('resumed');
    expect(dispatched.mock.calls.map(([, options]) => options?.id)).toEqual([
      resolveResumeCommandId(taskId, wait),
      `${resolveResumeCommandId(taskId, wait)}:2`,
    ]);
  });

  test('after a restart, a retry is a new command at once instead of replaying the ones already tried', async () => {
    const { engine, taskId, wait } = await armWait();
    const clock = { now: wait.resetAt };
    const options = { now: () => clock.now, graceMs: 0, retryMs: MINUTE };
    await new UsageResumeClock(engine, options).fireDue();
    clock.now += MINUTE;
    await new UsageResumeClock(engine, options).fireDue();
    expect(selectWait(engine, taskId).status).toBe('armed');
    const shift = shiftEngineClock();
    shift.ms = 2 * MINUTE;
    clock.now += MINUTE;
    await new UsageResumeClock(engine, options).fireDue();
    expect(selectWait(engine, taskId).status).toBe('resumed');
  });

  test('a wait resumed by hand is not resumed again when its reset passes', async () => {
    const { engine, taskId, wait } = await armWait();
    await engine.dispatch({ type: 'usage_wait.resume_now', taskId });
    const dispatched = spyOnDispatch(engine);
    await new UsageResumeClock(engine, { now: () => wait.resetAt, graceMs: 0 }).fireDue();
    expect(dispatched).not.toHaveBeenCalled();
  });

  test('a reset months away waits for the longest timer instead of firing at once', async () => {
    const { engine, taskId } = await startPlanning();
    const timers = spyOn(globalThis, 'setTimeout');
    spies.push(timers);
    const resume = new UsageResumeClock(engine, { now: () => 0 });
    resume.start();
    await hitUsageLimit(engine, taskId, Date.now() + MINUTE);
    expect(timers.mock.calls.map(([, delay]) => delay)).toEqual([2 ** 31 - 1]);
    resume.stop();
  });

  test('stopping clears the timer and stops listening to state changes', async () => {
    const { engine, taskId, wait } = await armWait();
    const timers = spyOn(globalThis, 'setTimeout');
    const clears = spyOn(globalThis, 'clearTimeout');
    spies.push(timers, clears);
    const resume = new UsageResumeClock(engine, { now: () => wait.resetAt - MINUTE });
    resume.start();
    const timer = timers.mock.results[0]?.value;
    resume.stop();
    expect(clears).toHaveBeenCalledWith(timer);
    await engine.dispatch({ type: 'usage_wait.resume_now', taskId });
    await hitUsageLimit(engine, taskId, Date.now() + 2 * MINUTE);
    expect(selectWait(engine, taskId).status).toBe('armed');
    expect(timers).toHaveBeenCalledTimes(1);
    resume.stop();
  });
});
