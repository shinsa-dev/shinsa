import { describe, expect, test } from 'bun:test';
import { listActiveRuns, listOpenGates } from '../../src/index.ts';
import {
  buildAll,
  createHarness,
  createTask,
  failing,
  proposePlan,
  pullRequest,
  reachReviewGate,
  registerRepo,
  SPEC,
} from '../harness.ts';

describe('stale and late commands', () => {
  test('a hand-over from an ended run is rejected', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const planner = harness.activeRun(taskId);
    proposePlan(harness, taskId);
    expect(() => harness.send({ type: 'agent.propose_plan', runId: planner.id, document: SPEC })).toThrow(
      'This step is already over'
    );
  });

  test('nothing an agent does can revive a cancelled task', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    const builder = harness.activeRun(taskId);
    harness.send({ type: 'task.cancel', taskId });
    expect(harness.lastEffect('run.cancel').runId).toBe(builder.id);
    expect(() => completePhaseFor(builder.id)).toThrow();
    expect(() =>
      harness.send({ type: 'agent.ask', runId: builder.id, gateId: 'q', question: 'Hm?', context: null })
    ).toThrow();
    expect(harness.task(taskId).stage).toBe('cancelled');

    function completePhaseFor(runId: string) {
      harness.send({ type: 'agent.complete_phase', runId, summary: 'x', spots: [], decisions: [] });
    }
  });

  test('a role cannot use another role’s hand-over', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    expect(() =>
      harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'x' })
    ).toThrow('A planner cannot do that.');
  });

  test('triage that finishes after a cancel removes the worktree and starts nothing', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    harness.send({ type: 'task.create', intent: 'Do it', repoId });
    const taskId = Object.keys(harness.state.tasks)[0] ?? '';
    harness.send({ type: 'task.cancel', taskId });
    harness.send({ type: 'worktree.ready', taskId, path: '/wt/x', branch: 'fix/x' });
    expect(harness.task(taskId).stage).toBe('cancelled');
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);
    expect(harness.lastEffect('worktree.remove').taskId).toBe(taskId);
  });

  test('cancelling a merged task does nothing', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'approve',
      response: null,
    });
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ state: 'merged' }) });
    harness.send({ type: 'task.cancel', taskId });
    expect(harness.task(taskId).stage).toBe('merged');
  });

  test('a task marked done is settled and its agent stopped', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.complete', taskId });
    expect(harness.task(taskId).stage).toBe('done');
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);
    expect(() => harness.send({ type: 'task.message', taskId, text: 'more' })).toThrow(
      'This task is finished'
    );
  });
});

describe('agent hand-overs', () => {
  test('evidence and notes are recorded against the run that made them', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const runId = harness.activeRun(taskId).id;
    harness.send({
      type: 'agent.attach_evidence',
      runId,
      kind: 'screenshot',
      title: 'the tabs',
      uri: '/e/1.png',
    });
    harness.send({ type: 'agent.note', runId, note: 'Looking at the CSS.' });
    const [evidence] = Object.values(harness.state.evidence);
    expect(evidence).toMatchObject({ taskId, runId, kind: 'screenshot', uri: '/e/1.png' });
    expect(harness.task(taskId).note).toBe('Looking at the CSS.');
    expect(harness.task(taskId).activity.slice(-2)).toMatchObject([
      { kind: 'evidence', text: 'Attached the tabs', evidenceId: evidence?.id },
      { kind: 'note', text: 'Looking at the CSS.', runId },
    ]);
  });

  test('asking the same question twice opens one gate, and a gate id cannot be reused', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const runId = harness.activeRun(taskId).id;
    const ask = { type: 'agent.ask', runId, gateId: 'q1', question: 'Which tab?', context: null } as const;
    harness.send(ask);
    harness.send(ask);
    expect(listOpenGates(harness.state, taskId)).toHaveLength(1);
    const other = createTask(harness, { intent: 'Other' });
    expect(() => harness.send({ ...ask, runId: harness.activeRun(other).id })).toThrow(
      'Gate q1 already exists.'
    );
  });

  test('only a fixer can hand over a fix', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    expect(() =>
      harness.send({
        type: 'agent.complete_fix',
        runId: harness.activeRun(taskId).id,
        summary: 'Skipped ahead.',
      })
    ).toThrow('A builder cannot do that.');
    expect(harness.task(taskId).stage).toBe('building');
  });

  test('a finished fix counts as progress', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: failing() });
    harness.send({
      type: 'run.end',
      runId: harness.activeRun(taskId).id,
      outcome: 'failed',
      summary: 'crash',
    });
    expect(harness.task(taskId).recoveries).toBe(1);
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Fixed.' });
    expect(harness.task(taskId).recoveries).toBe(0);
  });
});
