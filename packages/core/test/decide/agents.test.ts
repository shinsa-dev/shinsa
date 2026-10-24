import { describe, expect, test } from 'bun:test';
import { listActiveRuns, listOpenGates } from '../../src/index.ts';
import {
  buildAll,
  createHarness,
  createTask,
  failing,
  PLAN,
  proposePlan,
  pullRequest,
  reachReviewGate,
  registerRepo,
} from '../harness.ts';

describe('stale and late commands', () => {
  test('a hand-over from an ended run is rejected', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const planner = harness.activeRun(taskId);
    proposePlan(harness, taskId);
    expect(() => harness.send({ type: 'agent.propose_plan', runId: planner.id, document: PLAN })).toThrow(
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
      harness.send({ type: 'agent.complete_phase', runId, summary: 'x', spots: [], judgementCalls: [] });
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
    harness.send({ type: 'task.create', request: 'Do it', repoId });
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
    proposePlan(harness, taskId);
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

  test('an agent is refused a tool its role does not have', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const runId = harness.activeRun(taskId).id;
    expect(() =>
      harness.send({ type: 'agent.attach_evidence', runId, kind: 'note', title: 'x', uri: '/e/1.txt' })
    ).toThrow('A planner cannot do that.');
  });

  test('asking the same question twice opens one gate, and a gate id cannot be reused', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const runId = harness.activeRun(taskId).id;
    const ask = { type: 'agent.ask', runId, gateId: 'q1', question: 'Which tab?', context: null } as const;
    harness.send(ask);
    harness.send(ask);
    expect(listOpenGates(harness.state, taskId)).toHaveLength(1);
    const other = createTask(harness, { request: 'Other' });
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

  test('a finished fix counts as progress only when it changed the code', () => {
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
    harness.send({
      type: 'agent.complete_fix',
      runId: harness.activeRun(taskId).id,
      summary: 'Fixed.',
      treeHash: 'tree-2',
    });
    expect(harness.task(taskId).treeHash).toBe('tree-2');
    expect(harness.task(taskId).recoveries).toBe(0);
  });

  test('a fix that only says it fixed something keeps the recovery budget spent', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: failing() });
    harness.send({ type: 'run.end', runId: harness.activeRun(taskId).id, outcome: 'failed', summary: 'x' });
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'All fixed!' });
    expect(harness.task(taskId).recoveries).toBe(1);
    expect(harness.task(taskId).recoveryFingerprint).toMatch(/^recovery:[0-9a-f]{8}$/);
  });
});

describe('plan revisions', () => {
  function approvingPlans() {
    const harness = createHarness();
    registerRepo(harness);
    harness.send({ type: 'settings.change', patch: { approvePlans: true } });
    const taskId = createTask(harness, { size: 'large' });
    return { harness, taskId };
  }

  test('the plan gate carries the version it shows', () => {
    const { harness, taskId } = approvingPlans();
    proposePlan(harness, taskId);
    expect(harness.openGate(taskId)).toMatchObject({ type: 'plan', planVersion: 1 });
    expect(harness.task(taskId).plan?.changes).toBeUndefined();
  });

  test('a revision keeps the earlier version with what changed and why', () => {
    const { harness, taskId } = approvingPlans();
    proposePlan(harness, taskId);
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'revise',
      response: 'Add a test phase.',
    });
    expect(harness.activeRun(taskId).feedback).toBe('Add a test phase.');
    harness.send({
      type: 'agent.propose_plan',
      runId: harness.activeRun(taskId).id,
      document: { ...PLAN, phases: [...PLAN.phases, { title: 'Add a test', detail: 'Cover the overflow.' }] },
      changeSummary: '  Added a test phase, as asked.  ',
    });
    const task = harness.task(taskId);
    expect(task.plan).toMatchObject({
      version: 2,
      changeSummary: 'Added a test phase, as asked.',
      feedback: 'Add a test phase.',
      changes: [{ kind: 'phase_added', title: 'Add a test' }],
    });
    expect(task.planHistory?.map((revision) => revision.version)).toEqual([1]);
    expect(harness.openGate(taskId).planVersion).toBe(2);
    expect(task.activity.find((entry) => entry.text === 'Revised the plan (version 2)')?.detail).toBe(
      'Added a test phase, as asked.'
    );
  });

  test('a revision without a summary still lists what changed', () => {
    const { harness, taskId } = approvingPlans();
    proposePlan(harness, taskId);
    harness.send({ type: 'task.message', taskId, text: 'Different goal.' });
    harness.send({
      type: 'agent.propose_plan',
      runId: harness.activeRun(taskId).id,
      document: { ...PLAN, goal: 'Something else.' },
      changeSummary: '   ',
    });
    expect(harness.task(taskId).plan).toMatchObject({ changeSummary: null, changes: [{ kind: 'goal' }] });
    const revised = harness
      .task(taskId)
      .activity.find((entry) => entry.text === 'Revised the plan (version 2)');
    expect(revised?.detail).toBe('Something else.');
  });

  test('history keeps the last ten versions', () => {
    const { harness, taskId } = approvingPlans();
    for (let index = 0; index < 12; index += 1) {
      proposePlan(harness, taskId);
      harness.send({ type: 'task.message', taskId, text: `Again ${index}` });
    }
    proposePlan(harness, taskId);
    const history = harness.task(taskId).planHistory ?? [];
    expect(history).toHaveLength(10);
    expect(history.at(-1)?.version).toBe(12);
    expect(harness.task(taskId).plan?.version).toBe(13);
  });
});

describe('questions with choices', () => {
  test('the gate keeps the choices and the recommended one', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({
      type: 'agent.ask',
      runId: harness.activeRun(taskId).id,
      gateId: 'q',
      question: 'Which store?',
      context: null,
      choices: ['SQLite', 'Postgres'],
      recommendation: 'SQLite',
    });
    expect(harness.state.gates.q).toMatchObject({
      choices: ['SQLite', 'Postgres'],
      recommendation: 'SQLite',
    });
  });

  test('a question without choices stays free text', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({
      type: 'agent.ask',
      runId: harness.activeRun(taskId).id,
      gateId: 'q',
      question: 'Which store?',
      context: null,
      choices: [],
    });
    expect(harness.state.gates.q?.choices).toBeUndefined();
  });
});

describe('the tree a hand-over committed', () => {
  test('is recorded once and only when it changed', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    const commit = (treeHash: string) =>
      harness.send({
        type: 'agent.complete_phase',
        runId: harness.activeRun(taskId).id,
        summary: 'x',
        spots: [],
        judgementCalls: [],
        treeHash,
      });
    expect(commit('tree-1').events.map((event) => event.type)).toContain('work.committed');
    expect(commit('tree-1').events.map((event) => event.type)).not.toContain('work.committed');
    expect(harness.task(taskId).treeHash).toBe('tree-1');
  });
});

describe('the plan meets the verification rules', () => {
  test('a plan for a change without a verification plan goes back to the planner, who carries on', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const planner = harness.activeRun(taskId);
    expect(() => proposePlan(harness, taskId, { ...PLAN, verification: [] })).toThrow(
      'This task changes code, so the plan needs a verification plan up front'
    );
    expect(harness.activeRun(taskId).id).toBe(planner.id);
    expect(harness.task(taskId).plan).toBeNull();
    proposePlan(harness, taskId);
    expect(harness.task(taskId).plan?.document?.verification).toEqual(PLAN.verification);
  });

  test('a plan that asks for approval waits for you even with plan approval switched off', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId, { ...PLAN, approval: true });
    expect(harness.task(taskId).stage).toBe('awaiting_plan');
    expect(listOpenGates(harness.state, taskId)[0]?.type).toBe('plan');
  });

  test('the last phase waits for the evidence the plan asks for, and only the last one', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId, { ...PLAN, evidence: ['screenshot', 'test'] });
    const first = harness.activeRun(taskId);
    harness.send({
      type: 'agent.complete_phase',
      runId: first.id,
      summary: 'One.',
      spots: [],
      judgementCalls: [],
    });
    const last = harness.activeRun(taskId);
    const complete = () =>
      harness.send({
        type: 'agent.complete_phase',
        runId: last.id,
        summary: 'Two.',
        spots: [],
        judgementCalls: [],
      });
    expect(complete).toThrow(
      'The plan asks for a screenshot (`screenshot`) and test output (`test`) as evidence. Attach it with `attach_evidence` before you complete the last phase.'
    );
    harness.send({
      type: 'agent.attach_evidence',
      runId: last.id,
      kind: 'screenshot',
      title: 'The panel',
      uri: 'a.png',
    });
    expect(complete).toThrow('The plan asks for test output (`test`) as evidence.');
    harness.send({
      type: 'agent.attach_evidence',
      runId: last.id,
      kind: 'test',
      title: 'Tests',
      uri: 'out.txt',
    });
    complete();
    expect(harness.task(taskId).stage).toBe('checking');
    expect(harness.task(taskId).plan?.body).toContain('## Evidence\nscreenshot, test');
  });
});
