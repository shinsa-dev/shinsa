import { describe, expect, test } from 'bun:test';
import { resolveTaskProgress } from '../../src/index.ts';
import type { CheckChangeHandOver, PlanDocument } from '../../src/report/types.ts';
import {
  checkResult,
  completePhase,
  createHarness,
  createTask,
  failing,
  type Harness,
  PLAN,
  proposePlan,
  registerRepo,
} from '../harness.ts';

const THREE_PHASES: PlanDocument = {
  ...PLAN,
  phases: [
    { title: 'Parser', detail: 'Split the parser.' },
    { title: 'Cache', detail: 'Cache by commit.' },
    { title: 'Docs', detail: 'Write it down.' },
  ],
  verification: [
    { label: 'Parser tests', command: 'bun test src/parser', phases: [1, 2] },
    { label: 'Cache tests', command: 'bun test src/cache', phases: [2] },
  ],
};

function checksRun(harness: Harness) {
  return harness.lastEffect('checks.run').checks.map((check) => check.id);
}

function start(harness: Harness, plan: PlanDocument = THREE_PHASES) {
  const taskId = createTask(harness);
  proposePlan(harness, taskId, plan);
  return taskId;
}

function completeWith(harness: Harness, taskId: string, checkChanges: CheckChangeHandOver[]) {
  return harness.send({
    type: 'agent.complete_phase',
    runId: harness.activeRun(taskId).id,
    summary: 'Done.',
    spots: [],
    judgementCalls: [],
    checkChanges,
  });
}

const ADD: CheckChangeHandOver = {
  action: 'add',
  id: null,
  label: 'Transcript tests',
  command: 'bun test apps/engine/test/agents/transcripts',
  phases: null,
  reason: 'The phase added the transcript reader.',
};

describe('the plan’s checks', () => {
  test('the plan’s verification becomes the task’s checks, numbered in order', () => {
    const harness = createHarness();
    const taskId = start(harness);
    expect(harness.task(taskId).checks).toEqual([
      { id: 'c1', label: 'Parser tests', command: 'bun test src/parser', phases: [1, 2], source: 'plan' },
      { id: 'c2', label: 'Cache tests', command: 'bun test src/cache', phases: [2], source: 'plan' },
    ]);
  });

  test('a phase runs only its own checks, and the repository’s commands wait for the run before review', () => {
    const harness = createHarness();
    const taskId = start(harness);
    completePhase(harness, taskId);
    expect(harness.task(taskId)).toMatchObject({
      stage: 'checking',
      stageReason: 'running the checks for phase 1 of 3',
    });
    expect(checksRun(harness)).toEqual(['c1']);
    expect(harness.task(taskId).runningChecks).toEqual(['c1']);
    expect(harness.lastEffect('checks.run').coverage).toBe(false);
    expect(
      resolveTaskProgress(harness.task(taskId)).phases.find((phase) => phase.status === 'active')?.key
    ).toStartWith('plan-');
    harness.send({ type: 'checks.record', taskId, results: [checkResult('c1', 'pass')] });
    expect(harness.task(taskId).runningChecks).toEqual([]);
    expect(harness.activeRun(taskId)).toMatchObject({ purpose: 'build', phaseIndex: 1 });
    completePhase(harness, taskId);
    expect(checksRun(harness)).toEqual(['c1', 'c2']);
    harness.send({
      type: 'checks.record',
      taskId,
      results: [checkResult('c1', 'pass'), checkResult('c2', 'pass')],
    });
    completePhase(harness, taskId);
    expect(harness.task(taskId).stageReason).toBe('running the checks before review');
    expect(checksRun(harness)).toEqual(['r1', 'r2']);
    expect(harness.lastEffect('checks.run').coverage).toBe(true);
  });

  test('a phase with no check of its own and no repository commands goes straight on', () => {
    const harness = createHarness();
    registerRepo(harness, 'paywall-next', 'Superwall', []);
    const taskId = start(harness, {
      ...THREE_PHASES,
      verification: [{ label: 'Cache tests', command: 'bun test src/cache', phases: [2] }],
    });
    completePhase(harness, taskId);
    expect(harness.activeRun(taskId)).toMatchObject({ purpose: 'build', phaseIndex: 1 });
    expect(harness.effectsOf('checks.run')).toHaveLength(0);
    completePhase(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: [checkResult('c1', 'pass')] });
    completePhase(harness, taskId);
    expect(harness.activeRun(taskId).role).toBe('reviewer');
  });

  test('checks that report nothing are ignored', () => {
    const harness = createHarness();
    const taskId = start(harness);
    completePhase(harness, taskId);
    expect(harness.send({ type: 'checks.record', taskId, results: [] }).events).toEqual([]);
    expect(harness.task(taskId).stage).toBe('checking');
  });
});

describe('the agent changes its checks as it builds', () => {
  test('a check added mid-build runs at once with the phase’s checks, and covers this phase onward', () => {
    const harness = createHarness();
    const taskId = start(harness);
    completeWith(harness, taskId, [ADD]);
    expect(checksRun(harness)).toEqual(['c1', 'c3']);
    expect(harness.task(taskId).checks?.at(-1)).toEqual({
      id: 'c3',
      label: 'Transcript tests',
      command: 'bun test apps/engine/test/agents/transcripts',
      phases: [1, 2, 3],
      source: 'agent',
    });
    expect(harness.task(taskId).activity.find((entry) => entry.kind === 'check')).toMatchObject({
      actor: 'agent',
      text: 'Added the check “Transcript tests”',
      detail: '`bun test apps/engine/test/agents/transcripts`: The phase added the transcript reader.',
    });
  });

  test('a check is changed or removed by id with a reason, and its old result goes with it', () => {
    const harness = createHarness();
    const taskId = start(harness);
    completePhase(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: [checkResult('c1', 'fail', 'boom')] });
    harness.send({
      type: 'agent.complete_fix',
      runId: harness.activeRun(taskId).id,
      summary: 'Moved the tests.',
      checkChanges: [
        {
          action: 'change',
          id: 'c1',
          label: null,
          command: 'bun test src/parse',
          phases: null,
          reason: 'Renamed.',
        },
        { action: 'remove', id: 'c2', label: null, command: null, phases: null, reason: 'Covered by c1.' },
      ],
    });
    const task = harness.task(taskId);
    expect(task.checks).toEqual([
      { id: 'c1', label: 'Parser tests', command: 'bun test src/parse', phases: [1, 2], source: 'plan' },
    ]);
    expect(task.checkResults).toEqual([]);
    expect(harness.lastEffect('checks.run').checks).toEqual([
      { id: 'c1', label: 'Parser tests', command: 'bun test src/parse' },
    ]);
    expect(task.activity.filter((entry) => entry.kind === 'check').map((entry) => entry.detail)).toContain(
      'Covered by c1.'
    );
  });

  test('a change the task cannot take is refused before anything is recorded', () => {
    const harness = createHarness();
    const taskId = start(harness);
    const before = harness.events.length;
    const refuse = (change: Partial<CheckChangeHandOver>, message: string) =>
      expect(() => completeWith(harness, taskId, [{ ...ADD, ...change }])).toThrow(message);
    refuse(
      { action: 'change', id: 'c9', command: null, phases: [1] },
      'There is no check c9. The checks are c1'
    );
    refuse({ action: 'remove', id: 'r1' }, 'r1 is the repository’s own command, `bun lint`. Only the human');
    refuse({ command: 'bun test src/parser' }, '`bun test src/parser` is already c1, “Parser tests”.');
    refuse({ phases: [4] }, 'The plan has 3 phases, so a check cannot cover phase 4.');
    expect(harness.events).toHaveLength(before);
    expect(harness.task(taskId).stage).toBe('building');
  });

  test('a run that changes nothing records nothing', () => {
    const harness = createHarness();
    const taskId = start(harness);
    const result = completeWith(harness, taskId, []);
    expect(result.events.map((event) => event.type)).not.toContain('checks.changed');
  });
});

describe('what blocks', () => {
  test('a fix runs again only the checks that failed and the ones it names', () => {
    const harness = createHarness();
    const taskId = start(harness);
    completePhase(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: [checkResult('c1', 'pass')] });
    completePhase(harness, taskId);
    harness.send({
      type: 'checks.record',
      taskId,
      results: [checkResult('c1', 'pass'), checkResult('c2', 'fail', 'x')],
    });
    expect(harness.task(taskId)).toMatchObject({ stage: 'fixing', fixFor: 'checks' });
    expect(
      resolveTaskProgress(harness.task(taskId)).phases.find((phase) => phase.status === 'active')?.key
    ).toStartWith('plan-');
    expect(harness.activeRun(taskId).prompt).toContain(
      'Afterwards Shinsa runs those checks, then you build the next phase.'
    );
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Fixed.' });
    expect(harness.task(taskId).stageReason).toBe('running the checks again after the fix');
    expect(checksRun(harness)).toEqual(['c2']);
    harness.send({ type: 'checks.record', taskId, results: [checkResult('c2', 'fail', 'y')] });
    harness.send({
      type: 'agent.complete_fix',
      runId: harness.activeRun(taskId).id,
      summary: 'Fixed again.',
      checks: ['c1'],
    });
    expect(checksRun(harness)).toEqual(['c1', 'c2']);
    harness.send({
      type: 'checks.record',
      taskId,
      results: [checkResult('c1', 'pass'), checkResult('c2', 'pass')],
    });
    expect(harness.activeRun(taskId)).toMatchObject({ purpose: 'build', phaseIndex: 2 });
  });

  test('a fix runs the checks of the phases whose files it touched, the failing ones and the named ones', () => {
    const harness = createHarness();
    registerRepo(harness, 'paywall-next', 'Superwall', []);
    const taskId = start(harness);
    const phase = (files: string[]) =>
      harness.send({
        type: 'agent.complete_phase',
        runId: harness.activeRun(taskId).id,
        summary: 'Done.',
        spots: [],
        judgementCalls: [],
        files,
      });
    phase(['src/parser.ts']);
    expect(harness.task(taskId).phaseReports[0]?.files).toEqual(['src/parser.ts']);
    harness.send({ type: 'checks.record', taskId, results: [checkResult('c1', 'pass')] });
    phase(['src/cache.ts']);
    harness.send({
      type: 'checks.record',
      taskId,
      results: [checkResult('c1', 'pass'), checkResult('c2', 'pass')],
    });
    phase([]);
    expect(harness.task(taskId).phaseReports[2]?.files).toBeUndefined();
    harness.send({
      type: 'agent.report_review',
      runId: harness.activeRun(taskId).id,
      summary: null,
      findings: [],
    });
    const fix = (files: string[] | undefined, checks: string[] = []) => {
      harness.send({
        type: 'agent.complete_fix',
        runId: harness.activeRun(taskId).id,
        summary: 'Fixed.',
        checks,
        ...(files ? { files } : {}),
      });
    };
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'revise',
      response: 'Rename.',
    });
    fix(['src/parser.ts', 'README.md']);
    expect(harness.task(taskId).stageReason).toBe('running the checks again after the fix');
    expect(checksRun(harness)).toEqual(['c1']);
    harness.send({ type: 'checks.record', taskId, results: [checkResult('c1', 'fail', 'x')] });
    fix(['src/cache.ts']);
    expect(checksRun(harness)).toEqual(['c1', 'c2']);
    harness.send({
      type: 'checks.record',
      taskId,
      results: [checkResult('c1', 'pass'), checkResult('c2', 'pass')],
    });
    harness.send({
      type: 'agent.report_review',
      runId: harness.activeRun(taskId).id,
      summary: null,
      findings: [],
    });
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'revise',
      response: 'Docs.',
    });
    const runs = harness.effectsOf('checks.run').length;
    fix(['docs/notes.md']);
    expect(harness.effectsOf('checks.run')).toHaveLength(runs);
    expect(harness.activeRun(taskId).role).toBe('reviewer');
    harness.send({
      type: 'agent.report_review',
      runId: harness.activeRun(taskId).id,
      summary: null,
      findings: [],
    });
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'revise',
      response: 'Again.',
    });
    fix(undefined, ['c2']);
    expect(checksRun(harness)).toEqual(['c2']);
  });

  test('a fix that names a check the task lacks is refused', () => {
    const harness = createHarness();
    const taskId = start(harness);
    completePhase(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: [checkResult('c1', 'fail', 'x')] });
    expect(() =>
      harness.send({
        type: 'agent.complete_fix',
        runId: harness.activeRun(taskId).id,
        summary: 'x',
        checks: ['c7'],
      })
    ).toThrow('There is no check c7.');
    expect(harness.task(taskId).stage).toBe('fixing');
  });

  test('a failure that also fails on the base branch does not block, and a pass when re-run alone is a pass', () => {
    const harness = createHarness();
    const taskId = start(harness);
    completePhase(harness, taskId);
    harness.send({
      type: 'checks.record',
      taskId,
      results: [
        { ...checkResult('c1', 'fail', 'old failure'), label: 'Parser tests', note: 'fails_on_base' },
      ],
    });
    expect(harness.activeRun(taskId)).toMatchObject({ purpose: 'build', phaseIndex: 1 });
    completePhase(harness, taskId);
    harness.send({
      type: 'checks.record',
      taskId,
      results: [
        checkResult('c1', 'pass'),
        { ...checkResult('c2', 'pass'), label: 'Cache tests', note: 'passed_alone' },
      ],
    });
    expect(harness.task(taskId).stage).toBe('building');
    expect(
      harness
        .task(taskId)
        .activity.filter((entry) => entry.kind === 'check')
        .map((entry) => entry.detail)
    ).toEqual([
      'Parser tests: already failing on the base branch, so it does not block',
      'Cache tests: passed when re-run alone',
    ]);
  });

  test('a retry while checking runs the failing checks and the last phase’s again', () => {
    const harness = createHarness();
    const taskId = start(harness);
    completePhase(harness, taskId);
    harness.send({ type: 'effect.fail', taskId, title: 'Could not run the checks', detail: 'boom' });
    harness.send({ type: 'task.retry', taskId });
    expect(harness.task(taskId).stageReason).toBe('running the checks for phase 1 of 3');
    expect(checksRun(harness)).toEqual(['c1']);
  });

  test('a retry while checking your edits runs every check again', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    completePhase(harness, taskId);
    completePhase(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: failing() });
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'x' });
    harness.send({ type: 'checks.record', taskId, results: [checkResult('r2', 'pass')] });
    harness.send({
      type: 'agent.report_review',
      runId: harness.activeRun(taskId).id,
      summary: null,
      findings: [],
    });
    harness.send({ type: 'task.record_edit', taskId, path: 'src/a.ts', changed: true });
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'approve',
      response: null,
    });
    expect(harness.task(taskId).stageReason).toBe('committing your edits and running the checks');
    expect(checksRun(harness)).toEqual(['c1', 'r1', 'r2']);
    harness.send({ type: 'effect.fail', taskId, title: 'Could not run the checks', detail: 'boom' });
    harness.send({ type: 'task.retry', taskId });
    expect(checksRun(harness)).toEqual(['c1', 'r1', 'r2']);
  });
});
