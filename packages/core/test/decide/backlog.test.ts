import { describe, expect, test } from 'bun:test';
import { DAY_MS, HOUR_MS, isHeldInBacklog, listOpenGates, resolveQueue } from '../../src/index.ts';
import { resolveBacklogStart } from '../../src/prompts/index.ts';
import {
  approve,
  completePhase,
  createHarness,
  createTask,
  type Harness,
  proposePlan,
  readInstruction,
  readyWorktree,
} from '../harness.ts';

function park(harness: Harness) {
  const taskId = createTask(harness, { backlog: true });
  proposePlan(harness, taskId);
  return taskId;
}

function refreshWorktree(harness: Harness, taskId: string) {
  harness.send({ type: 'worktree.ready', taskId, path: `/wt/${taskId}`, branch: `fix/${taskId}` });
}

describe('the backlog', () => {
  test('a backlog task triages and plans, then its plan waits out of Needs you', () => {
    const harness = createHarness();
    const taskId = park(harness);
    const task = harness.task(taskId);
    expect(task.backlog).toEqual({ at: expect.any(Number) });
    expect(task.stage).toBe('awaiting_plan');
    expect(task.stageReason).toBe('in the backlog');
    const gate = harness.openGate(taskId);
    expect(gate.type).toBe('plan');
    expect(isHeldInBacklog(harness.state, gate)).toBe(true);
    const queue = resolveQueue(harness.state, harness.now);
    expect(queue.ready).toEqual([]);
    expect(queue.backlog.map((entry) => entry.id)).toEqual([taskId]);
    expect(task.activity.map((entry) => entry.text)).toContain('Moved to the backlog');
  });

  test('a backlog plan waits even when Approve plans would let it build at once', () => {
    const harness = createHarness();
    const taskId = park(harness);
    expect(listOpenGates(harness.state, taskId)).toHaveLength(1);
    expect(harness.effectsOf('run.execute')).toHaveLength(1);
  });

  test('Start building moves the worktree onto the latest default branch, then builds with the wait named', () => {
    const harness = createHarness();
    const taskId = park(harness);
    const before = harness.effectsOf('worktree.create').length;
    harness.advance(3 * DAY_MS);
    approve(harness, taskId);
    expect(harness.task(taskId).stage).toBe('triage');
    expect(harness.effectsOf('worktree.create')).toHaveLength(before + 1);
    expect(harness.task(taskId).backlog).toEqual({ at: expect.any(Number) });
    refreshWorktree(harness, taskId);
    const task = harness.task(taskId);
    expect(task.backlog).toBeNull();
    expect(task.stage).toBe('building');
    const instruction = readInstruction(harness.activeRun(taskId));
    expect(instruction).toContain('This plan waited in the backlog for 3 days');
    expect(instruction).toContain('the worktree now holds the latest default branch');
    expect(task.activity.map((entry) => entry.text)).toContain('Started building from the backlog');
    completePhase(harness, taskId);
    expect(harness.task(taskId).stage).not.toBe('awaiting_plan');
  });

  test('Start building waits for an unfinished task it waits on, then builds once released', () => {
    const harness = createHarness();
    const parent = createTask(harness);
    const taskId = park(harness);
    harness.send({ type: 'task.wait_on', taskId, waitsOn: [parent] });
    approve(harness, taskId);
    refreshWorktree(harness, taskId);
    expect(harness.task(taskId).stage).toBe('waiting_on_tasks');
    harness.send({ type: 'task.cancel', taskId: parent });
    harness.send({ type: 'task.wait_on', taskId, waitsOn: [] });
    readyWorktree(harness, taskId);
    expect(harness.task(taskId).stage).toBe('building');
    expect(harness.task(taskId).backlog).toBeNull();
  });

  test('a backlog task without a worktree builds as soon as you start it', () => {
    const harness = createHarness();
    const taskId = park(harness);
    harness.send({ type: 'worktree.gone', taskId });
    approve(harness, taskId);
    expect(harness.task(taskId).stage).toBe('building');
    expect(readInstruction(harness.activeRun(taskId))).toContain(
      'waited in the backlog for less than an hour'
    );
  });

  test('Remove from the backlog turns it into a normal plan to approve', () => {
    const harness = createHarness();
    const taskId = park(harness);
    harness.send({ type: 'task.remove_from_backlog', taskId });
    const task = harness.task(taskId);
    expect(task.backlog).toBeNull();
    expect(task.stageReason).toBe('plan ready for you');
    expect(resolveQueue(harness.state, harness.now).ready.map((entry) => entry.task.id)).toEqual([taskId]);
    expect(task.activity.at(-1)).toMatchObject({ actor: 'you', text: 'Removed from the backlog' });
    const events = harness.events.length;
    harness.send({ type: 'task.remove_from_backlog', taskId });
    expect(harness.events).toHaveLength(events);
    approve(harness, taskId);
    expect(harness.task(taskId).stage).toBe('building');
  });

  test('Move to the backlog parks a plan that waits for you, and a repeat changes nothing', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { planFirst: true });
    proposePlan(harness, taskId);
    harness.send({ type: 'task.move_to_backlog', taskId });
    expect(harness.task(taskId).stageReason).toBe('in the backlog');
    expect(resolveQueue(harness.state, harness.now).ready).toEqual([]);
    const events = harness.events.length;
    harness.send({ type: 'task.move_to_backlog', taskId });
    expect(harness.events).toHaveLength(events);
  });

  test('a task moved to the backlog while it plans stops at its plan', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.move_to_backlog', taskId });
    expect(harness.task(taskId).stage).toBe('planning');
    proposePlan(harness, taskId);
    expect(harness.task(taskId).stage).toBe('awaiting_plan');
    expect(harness.task(taskId).stageReason).toBe('in the backlog');
  });

  test('Move to the backlog is refused once building started, for an inquiry and for a finished task', () => {
    const harness = createHarness();
    const building = createTask(harness);
    proposePlan(harness, building);
    expect(() => harness.send({ type: 'task.move_to_backlog', taskId: building })).toThrow(
      'This task has started building'
    );
    const question = createTask(harness);
    harness.send({
      type: 'agent.reshape',
      runId: harness.activeRun(question).id,
      shape: 'answer',
      reason: 'Ask.',
    });
    expect(() => harness.send({ type: 'task.move_to_backlog', taskId: question })).toThrow(
      'Only work that builds or runs an operation waits in the backlog'
    );
    const cancelled = createTask(harness);
    harness.send({ type: 'task.cancel', taskId: cancelled });
    expect(() => harness.send({ type: 'task.move_to_backlog', taskId: cancelled })).toThrow(
      'This task is finished.'
    );
  });

  test('a question filed for the backlog starts at once and says why', () => {
    const harness = createHarness();
    harness.send({
      type: 'task.create',
      request: 'How does it work?',
      repoId: null,
      mode: 'ask',
      backlog: true,
    });
    const [taskId] = Object.keys(harness.state.tasks);
    harness.send({
      type: 'task.triage',
      taskId: taskId ?? '',
      title: 'How does it work',
      repoId: null,
      size: 'small',
      branch: 'chore/question',
      waitsOn: [],
    });
    const task = harness.task(taskId ?? '');
    expect(task.backlog).toBeNull();
    expect(task.stage).toBe('answering');
    expect(task.activity.some((entry) => entry.text.startsWith('Started at once'))).toBe(true);
  });

  test('accepting a suggested task into the backlog parks it after its plan', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({
      type: 'agent.suggest_tasks',
      runId: harness.activeRun(taskId).id,
      suggestions: [{ title: 'Cache it', request: 'Cache the session.', why: 'Faster.', waitsOnThis: false }],
    });
    const suggestionId = harness.task(taskId).suggestions?.[0]?.id ?? '';
    harness.send({ type: 'suggestion.accept', taskId, suggestionId, waitsOnThis: false, backlog: true });
    const created = harness.task(taskId).suggestions?.[0]?.createdTaskId ?? '';
    expect(harness.task(created).backlog).toEqual({ at: expect.any(Number) });
  });

  test('a cancelled backlog task leaves the backlog list', () => {
    const harness = createHarness();
    const taskId = park(harness);
    harness.send({ type: 'task.cancel', taskId });
    expect(resolveQueue(harness.state, harness.now).backlog).toEqual([]);
  });
});

describe('resolveBacklogStart', () => {
  test('names the wait in days, hours or less than an hour', () => {
    expect(resolveBacklogStart(2 * DAY_MS + HOUR_MS)).toContain('for 2 days');
    expect(resolveBacklogStart(DAY_MS)).toContain('for 1 day');
    expect(resolveBacklogStart(5 * HOUR_MS)).toContain('for 5 hours');
    expect(resolveBacklogStart(10_000)).toContain('for less than an hour');
  });
});
