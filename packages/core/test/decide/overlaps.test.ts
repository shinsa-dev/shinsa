import { describe, expect, test } from 'bun:test';
import { describeOverlaps } from '../../src/index.ts';
import { buildAll, createHarness, createTask, PASSING, proposePlan } from '../harness.ts';

function overlap(
  harness: ReturnType<typeof createHarness>,
  taskId: string,
  otherTaskId: string,
  paths: string[],
  from = taskId
) {
  return harness.send({
    type: 'task.record_overlaps',
    taskId,
    overlaps: [{ taskId: otherTaskId, paths }],
    from,
  });
}

function createPair() {
  const harness = createHarness();
  const taskId = createTask(harness, { request: 'Fix the login' });
  const otherId = createTask(harness, { request: 'Refactor the session' });
  return { harness, taskId, otherId };
}

describe('files another open task changes too', () => {
  test('each file is recorded once per other task, and only new ones count', () => {
    const { harness, taskId, otherId } = createPair();
    expect(overlap(harness, taskId, otherId, ['src/b.ts', 'src/a.ts', 'src/a.ts']).events).toMatchObject([
      { type: 'task.overlapped', taskId, otherTaskId: otherId, paths: ['src/a.ts', 'src/b.ts'] },
    ]);
    expect(overlap(harness, taskId, otherId, ['src/a.ts']).events).toEqual([]);
    expect(overlap(harness, taskId, otherId, ['src/a.ts', 'src/c.ts']).events).toMatchObject([
      { paths: ['src/c.ts'] },
    ]);
    expect(harness.task(taskId).overlaps).toEqual([
      {
        taskId: otherId,
        paths: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        untold: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      },
    ]);
  });

  test('the task itself, an unknown task and a settled one are not overlaps, and a settled task records none', () => {
    const { harness, taskId, otherId } = createPair();
    expect(overlap(harness, taskId, taskId, ['src/a.ts']).events).toEqual([]);
    expect(overlap(harness, taskId, 'nope', ['src/a.ts']).events).toEqual([]);
    harness.send({ type: 'task.cancel', taskId: otherId });
    expect(overlap(harness, taskId, otherId, ['src/a.ts']).events).toEqual([]);
    harness.send({ type: 'task.cancel', taskId });
    const third = createTask(harness, { request: 'Something else' });
    expect(overlap(harness, taskId, third, ['src/a.ts']).events).toEqual([]);
  });

  test('the agent’s next turn is told once, with the other task’s handle and title', () => {
    const { harness, taskId, otherId } = createPair();
    overlap(harness, taskId, otherId, ['src/a.ts']);
    proposePlan(harness, taskId);
    const other = harness.task(otherId);
    const note = describeOverlaps([
      { handle: other.handle ?? null, title: other.title, paths: ['src/a.ts'] },
    ]);
    const build = harness.activeRun(taskId);
    expect(build.prompt).toEndWith(`\n\n${note}`);
    expect(harness.task(taskId).overlaps?.[0]?.untold).toEqual([]);
    harness.send({
      type: 'agent.complete_phase',
      runId: build.id,
      summary: 'Phase 1.',
      spots: [{ file: 'src/a.ts', start: 1, end: 3, attention: 'normal', why: 'The change.' }],
      judgementCalls: [],
    });
    expect(harness.activeRun(taskId).prompt).not.toContain(note);
    expect(overlap(harness, taskId, otherId, ['src/a.ts']).events).toEqual([]);
  });

  test('the reviewer is never told; the agent’s fix turn is', () => {
    const { harness, taskId, otherId } = createPair();
    buildAll(harness, taskId);
    overlap(harness, taskId, otherId, ['src/a.ts']);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    const review = harness.activeRun(taskId);
    expect(review.role).toBe('reviewer');
    expect(review.prompt).not.toContain('Another open task');
    expect(harness.task(taskId).overlaps?.[0]?.untold).toEqual(['src/a.ts']);
    harness.send({
      type: 'agent.report_review',
      runId: review.id,
      findings: [{ severity: 'blocking', file: 'src/a.ts', line: 1, message: 'It breaks the login.' }],
    });
    const fix = harness.activeRun(taskId);
    expect(fix.role).toBe('agent');
    expect(fix.prompt).toContain('Another open task changed files this task also changes');
  });

  test('an Agent at work on the other task is told at once, by a steer, and its next turn is not told again', () => {
    const { harness, taskId, otherId } = createPair();
    proposePlan(harness, taskId);
    const build = harness.activeRun(taskId);
    const steers = harness.effectsOf('run.steer').length;
    overlap(harness, taskId, otherId, ['src/a.ts'], otherId);
    const other = harness.task(otherId);
    expect(harness.lastEffect('run.steer')).toEqual({
      kind: 'run.steer',
      runId: build.id,
      text: describeOverlaps([{ handle: other.handle ?? null, title: other.title, paths: ['src/a.ts'] }]),
      from: 'shinsa',
    });
    expect(harness.task(taskId).overlaps?.[0]?.untold).toEqual([]);
    expect(overlap(harness, taskId, otherId, ['src/a.ts'], otherId).effects).toEqual([]);
    harness.send({
      type: 'agent.complete_phase',
      runId: build.id,
      summary: 'Phase 1.',
      spots: [{ file: 'src/a.ts', start: 1, end: 3, attention: 'normal', why: 'The change.' }],
      judgementCalls: [],
    });
    expect(harness.activeRun(taskId).prompt).not.toContain('Another open task');
    expect(harness.effectsOf('run.steer')).toHaveLength(steers + 1);
  });

  test('the task whose hand-over compared the files, a reviewer, and a note about a settled task are not steered', () => {
    const { harness, taskId, otherId } = createPair();
    proposePlan(harness, taskId);
    const steers = harness.effectsOf('run.steer').length;
    overlap(harness, taskId, otherId, ['src/a.ts']);
    expect(harness.effectsOf('run.steer')).toHaveLength(steers);
    expect(harness.task(taskId).overlaps?.[0]?.untold).toEqual(['src/a.ts']);

    const third = createTask(harness, { request: 'Rename the helper' });
    buildAll(harness, third);
    harness.send({ type: 'checks.record', taskId: third, results: PASSING });
    expect(harness.activeRun(third).role).toBe('reviewer');
    overlap(harness, third, otherId, ['src/a.ts'], otherId);
    expect(harness.effectsOf('run.steer')).toHaveLength(steers);

    const fourth = createTask(harness, { request: 'Tidy the docs' });
    const gone = createTask(harness, { request: 'Drop the cache' });
    overlap(harness, fourth, gone, ['src/a.ts']);
    harness.send({ type: 'task.cancel', taskId: gone });
    const quiet = overlap(harness, fourth, gone, ['src/a.ts'], taskId);
    expect(quiet.effects).toEqual([]);
    expect(harness.task(fourth).overlaps?.[0]?.untold).toEqual([]);
  });

  test('an overlap with a task that settled before the next turn is dropped unsaid', () => {
    const { harness, taskId, otherId } = createPair();
    overlap(harness, taskId, otherId, ['src/a.ts']);
    harness.send({ type: 'task.cancel', taskId: otherId });
    proposePlan(harness, taskId);
    expect(harness.activeRun(taskId).prompt).not.toContain('Another open task');
    expect(harness.task(taskId).overlaps?.[0]?.untold).toEqual([]);
  });

  test('the note reads right for one task, several, and many files', () => {
    expect(describeOverlaps([{ handle: 'SW-12', title: 'Fix login', paths: ['a.ts', 'b.ts'] }])).toStartWith(
      'Another open task changed files this task also changes: SW-12 “Fix login” (`a.ts`, `b.ts`). Keep your changes to those files to what this task needs, and call `list_repository_work` to see its branch'
    );
    expect(
      describeOverlaps([
        { handle: null, title: 'One', paths: ['1', '2', '3', '4', '5', '6', '7'] },
        { handle: 'SW-3', title: 'Two', paths: ['x'] },
      ])
    ).toStartWith(
      'Other open tasks changed files this task also changes: “One” (`1`, `2`, `3`, `4`, `5` and 2 more); SW-3 “Two” (`x`). Keep your changes to those files to what this task needs, and call `list_repository_work` to see their branches'
    );
  });
});
