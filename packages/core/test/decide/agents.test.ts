import { describe, expect, test } from 'bun:test';
import { listActiveRuns, listOpenGates } from '../../src/index.ts';
import { assembleReport } from '../../src/report/index.ts';
import {
  buildAll,
  checkResult,
  completePhase,
  createHarness,
  createTask,
  failing,
  PASSING,
  PLAN,
  proposePlan,
  pullRequest,
  REPLY,
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

  test('the round agent cannot hand over a step it is not on', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    expect(() =>
      harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'x' })
    ).toThrow('You are planning this round: hand the plan over with `propose_plan`');
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: failing() });
    expect(() =>
      harness.send({ type: 'agent.deliver', runId: harness.activeRun(taskId).id, step: 'operate', body: 'x' })
    ).toThrow('You are fixing the work: hand the fix over with `complete_fix`.');
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

  test('evidence keeps what it shows, its width, theme and stage', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    const runId = harness.activeRun(taskId).id;
    harness.send({
      type: 'agent.attach_evidence',
      runId,
      kind: 'screenshot',
      title: 'Settings',
      uri: '/e/after.png',
      detail: 'The muted labels now read clearly.',
      width: 1280,
      theme: 'dark',
      stage: 'after',
    });
    harness.send({ type: 'agent.attach_check', runId, kind: 'test', checkId: 'c1', detail: null });
    const [shot, run] = Object.values(harness.state.evidence);
    expect(shot).toMatchObject({
      detail: 'The muted labels now read clearly.',
      width: 1280,
      theme: 'dark',
      stage: 'after',
    });
    expect(run).toMatchObject({
      kind: 'test',
      checkId: 'c1',
      title: 'Panel tests',
      uri: 'shinsa://check/c1',
    });
    expect(run).not.toHaveProperty('detail');
    expect(run).not.toHaveProperty('stage');
  });

  test('a test run links a check of the task by its id, and an unknown id is refused with the list', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    const runId = harness.activeRun(taskId).id;
    expect(() =>
      harness.send({
        type: 'agent.attach_check',
        runId,
        kind: 'test',
        checkId: 'c9',
        detail: 'It proves it.',
      })
    ).toThrow('There is no check c9. The checks are c1 (Panel tests), r1 (bun lint), r2 (bun check-types).');
    harness.send({ type: 'agent.attach_check', runId, kind: 'check', checkId: 'r2', detail: 'Types hold.' });
    expect(Object.values(harness.state.evidence)).toMatchObject([
      { kind: 'check', checkId: 'r2', title: 'bun check-types', detail: 'Types hold.', runId },
    ]);
  });

  test('a comparison attaches each part as a piece of one item, with one activity entry', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    const runId = harness.activeRun(taskId).id;
    harness.send({
      type: 'agent.attach_comparison',
      runId,
      title: 'Settings',
      detail: 'The labels read clearly now.',
      width: 1280,
      theme: 'dark',
      parts: [
        { kind: 'screenshot', uri: '/e/before.png', stage: 'before' },
        { kind: 'screenshot', uri: '/e/empty.png', label: 'Empty list' },
        { kind: 'recording', uri: '/e/after.webm', stage: 'after', label: null },
      ],
    });
    const pieces = Object.values(harness.state.evidence);
    const [before, empty, after] = pieces;
    expect(pieces).toHaveLength(3);
    expect(before).toMatchObject({
      kind: 'screenshot',
      title: 'Settings',
      detail: 'The labels read clearly now.',
      width: 1280,
      theme: 'dark',
      stage: 'before',
    });
    expect(empty).toMatchObject({ label: 'Empty list', itemId: before?.itemId });
    expect(empty).not.toHaveProperty('stage');
    expect(after).toMatchObject({ kind: 'recording', stage: 'after', itemId: before?.itemId });
    expect(after).not.toHaveProperty('label');
    expect(harness.task(taskId).activity.filter((entry) => entry.kind === 'evidence')).toMatchObject([
      { text: 'Attached Settings', evidenceId: before?.id },
    ]);
    harness.send({ type: 'agent.attach_comparison', runId, title: 'Bare', parts: [] });
    expect(Object.values(harness.state.evidence)).toHaveLength(3);
  });

  test('the reviewer is told what evidence the agent attached, or that there is none', () => {
    const bare = createHarness();
    const bareTask = createTask(bare);
    buildAll(bare, bareTask);
    bare.send({
      type: 'checks.record',
      taskId: bareTask,
      results: PASSING,
      outputs: [{ checkId: 'c1', title: 'Panel tests', uri: '/e/checks.txt' }],
    });
    expect(bare.activeRun(bareTask).prompt).toContain('The agent attached no evidence this round.');
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    harness.send({
      type: 'agent.attach_evidence',
      runId: harness.activeRun(taskId).id,
      kind: 'screenshot',
      title: 'Settings',
      uri: '/e/after.png',
      width: 390,
      theme: 'light',
      stage: 'after',
    });
    harness.send({
      type: 'agent.attach_check',
      runId: harness.activeRun(taskId).id,
      kind: 'test',
      checkId: 'c1',
    });
    harness.send({
      type: 'agent.attach_comparison',
      runId: harness.activeRun(taskId).id,
      title: 'Tabs',
      width: 1280,
      parts: [
        { kind: 'screenshot', uri: '/e/tabs-before.png', stage: 'before' },
        { kind: 'screenshot', uri: '/e/tabs-after.png', stage: 'after' },
      ],
    });
    for (const _phase of harness.task(taskId).plan?.document?.phases ?? []) completePhase(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    const prompt = harness.activeRun(taskId).prompt ?? '';
    expect(prompt).toContain('- `settings-390-light`, screenshot: Settings (after, 390px, light)');
    expect(prompt).toContain('- `tabs-1280`, comparison: Tabs (before and after, 1280px)');
    expect(prompt).toContain('- `check-c1`, test: Panel tests\n');
    expect(prompt).toContain('independent evidence from the review');
  });

  test('Shinsa attaches the output of each check it ran, of no run, while the task is checking', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({
      type: 'checks.record',
      taskId,
      results: failing(),
      outputs: [
        { checkId: 'r1', title: 'bun lint', uri: '/e/r1-1.txt' },
        { checkId: 'r2', title: 'bun check-types', uri: '/e/r2-1.txt' },
      ],
    });
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Fixed it.' });
    harness.send({
      type: 'checks.record',
      taskId,
      results: [checkResult('r2', 'pass')],
      outputs: [{ checkId: 'r2', title: 'bun check-types', uri: '/e/r2-2.txt' }],
    });
    harness.send({
      type: 'checks.record',
      taskId,
      results: PASSING,
      outputs: [{ checkId: 'r2', title: 'Late', uri: '/e/late.txt' }],
    });
    const pieces = Object.values(harness.state.evidence);
    expect(pieces.map((piece) => piece.uri)).toEqual(['/e/r1-1.txt', '/e/r2-1.txt', '/e/r2-2.txt']);
    expect(pieces[1]).toMatchObject({
      taskId,
      runId: null,
      kind: 'check',
      checkId: 'r2',
      title: 'bun check-types',
    });
    expect(pieces[1]).not.toHaveProperty('round');
  });

  test('an agent is refused a tool its role does not have', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    const runId = harness.activeRun(taskId).id;
    expect(() =>
      harness.send({ type: 'agent.ask', runId, gateId: 'q1', question: 'Which?', context: null })
    ).toThrow('A reviewer cannot do that.');
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

  test('a phase is handed over as a phase, never as a fix', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    expect(() =>
      harness.send({
        type: 'agent.complete_fix',
        runId: harness.activeRun(taskId).id,
        summary: 'Skipped ahead.',
      })
    ).toThrow('You are building a phase: hand it over with `complete_phase`.');
    expect(() =>
      harness.send({ type: 'agent.propose_plan', runId: harness.activeRun(taskId).id, document: PLAN })
    ).toThrow('You are building a phase');
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
    harness.send({ type: 'settings.change', patch: { approvePlans: 'always' } });
    const taskId = createTask(harness, { size: 'large' });
    return { harness, taskId };
  }

  test('the plan gate carries the version it shows', () => {
    const { harness, taskId } = approvingPlans();
    proposePlan(harness, taskId);
    expect(harness.openGate(taskId)).toMatchObject({ type: 'plan', planVersion: 1 });
    expect(harness.task(taskId).plan?.changes).toBeUndefined();
  });

  test('the plan gate shows the title the plan proposes, and the task title when it proposes none', () => {
    const { harness, taskId } = approvingPlans();
    proposePlan(harness, taskId);
    expect(harness.openGate(taskId).title).toBe(harness.task(taskId).title);
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'revise',
      response: 'Rename it.',
    });
    harness.send({
      type: 'agent.propose_plan',
      runId: harness.activeRun(taskId).id,
      document: { ...PLAN, title: 'Fix the overflow on narrow screens' },
      changeSummary: 'Renamed it.',
      reply: REPLY,
    });
    expect(harness.openGate(taskId).title).toBe('Fix the overflow on narrow screens');
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
      reply: REPLY,
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
      reply: REPLY,
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
  test('a plan for a change without a verification plan goes back to the agent, who carries on', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const planner = harness.activeRun(taskId);
    expect(() => proposePlan(harness, taskId, { ...PLAN, verification: [] })).toThrow(
      'This task changes code, so the plan needs its checks up front'
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
      'The plan asks for a screenshot (`screenshot`) and a test run, linked to its check (`test`) as evidence. Attach it with `attach_evidence` before you complete the last phase.'
    );
    harness.send({
      type: 'agent.attach_evidence',
      runId: last.id,
      kind: 'screenshot',
      title: 'The panel',
      uri: 'a.png',
    });
    expect(complete).toThrow('The plan asks for a test run, linked to its check (`test`) as evidence.');
    harness.send({ type: 'agent.attach_check', runId: last.id, kind: 'test', checkId: 'c1' });
    complete();
    expect(harness.task(taskId).stage).toBe('checking');
    expect(harness.task(taskId).plan?.body).toContain('## Evidence\nscreenshot, test');
  });
});

describe('the reviewer disagrees with a judgement call', () => {
  function reachReview() {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    const walkthrough = {
      approach: 'Clamp it.',
      flow: 'a → b',
      risks: [],
      testing: { automated: ['Resize it.'], manual: [] },
    };
    const calls = [
      { title: 'Clamp in the layout', call: 'Clamped the width in the tab layout' },
      { title: 'No new prop', call: 'Kept the tab props as they are' },
    ];
    for (const [index, { title, call }] of calls.entries()) {
      harness.send({
        type: 'agent.complete_phase',
        runId: harness.activeRun(taskId).id,
        summary: `Phase ${index + 1} done.`,
        spots: [],
        judgementCalls: [{ title, call, reason: 'Simpler.', file: null, line: null }],
        walkthrough: index === 1 ? walkthrough : null,
      });
    }
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    return { harness, taskId, walkthrough };
  }

  test('the review keeps each disagreement next to the call it is about', () => {
    const { harness, taskId, walkthrough } = reachReview();
    expect(harness.task(taskId).phaseReports.map((report) => report.walkthrough ?? null)).toEqual([
      null,
      walkthrough,
    ]);
    harness.send({
      type: 'agent.report_review',
      runId: harness.activeRun(taskId).id,
      summary: null,
      findings: [],
      disagreements: [{ call: 2, reason: 'A prop is clearer.' }],
    });
    expect(harness.task(taskId).reviewDisagreements).toEqual([
      { call: 'Kept the tab props as they are', reason: 'A prop is clearer.' },
    ]);
  });

  test('the reviewer is told each call by its number, title, decision and reason', () => {
    const { harness, taskId } = reachReview();
    expect(harness.activeRun(taskId).prompt).toContain(
      [
        '1. Clamp in the layout. Clamped the width in the tab layout: Simpler.',
        '2. No new prop. Kept the tab props as they are: Simpler.',
      ].join('\n')
    );
  });

  test('a judgement call number the brief never gave is refused', () => {
    const { harness, taskId } = reachReview();
    expect(() =>
      harness.send({
        type: 'agent.report_review',
        runId: harness.activeRun(taskId).id,
        summary: null,
        findings: [],
        disagreements: [{ call: 3, reason: 'No.' }],
      })
    ).toThrow('disagreements names judgement call 3, but the agent made 2.');
  });

  test('a review without disagreements clears the last one', () => {
    const { harness, taskId } = reachReview();
    harness.send({
      type: 'agent.report_review',
      runId: harness.activeRun(taskId).id,
      summary: null,
      findings: [],
    });
    expect(harness.task(taskId).reviewDisagreements).toEqual([]);
  });
});

describe('a fix revises the walkthrough', () => {
  const WALKTHROUGH = {
    approach: 'Clamp the width.',
    flow: 'layout → clamp',
    risks: [{ title: 'Narrow windows', risk: 'Narrow windows.', file: 'a.ts', line: 3, end: 4 }],
    testing: { automated: ['Resize it.'], manual: [] },
  };

  function reachFix(walkthroughs: [typeof WALKTHROUGH | null, typeof WALKTHROUGH | null]) {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    for (const [index, walkthrough] of walkthroughs.entries()) {
      harness.send({
        type: 'agent.complete_phase',
        runId: harness.activeRun(taskId).id,
        summary: `Phase ${index + 1} done.`,
        spots: [],
        judgementCalls: [],
        walkthrough,
      });
    }
    harness.send({ type: 'checks.record', taskId, results: failing() });
    return { harness, taskId };
  }

  function walkthroughsOf(harness: ReturnType<typeof createHarness>, taskId: string) {
    return harness.task(taskId).phaseReports.map((report) => report.walkthrough ?? null);
  }

  test('replaces only the parts the fix sends, on the phase that has the walkthrough', () => {
    const { harness, taskId } = reachFix([WALKTHROUGH, null]);
    const runId = harness.activeRun(taskId).id;
    const decision = harness.send({
      type: 'agent.complete_fix',
      runId,
      summary: 'Clamped earlier.',
      walkthrough: { flow: 'clamp → layout', risks: [] },
    });
    expect(decision.events.find((event) => event.type === 'walkthrough.revised')).toEqual({
      type: 'walkthrough.revised',
      taskId,
      walkthrough: { flow: 'clamp → layout', risks: [] },
      runId,
    });
    expect(walkthroughsOf(harness, taskId)).toEqual([
      { ...WALKTHROUGH, flow: 'clamp → layout', risks: [] },
      null,
    ]);
    expect(assembleReport(harness.task(taskId)).walkthrough?.flow).toBe('clamp → layout');
  });

  test('a fix without one leaves the walkthrough as it was and records nothing for it', () => {
    const { harness, taskId } = reachFix([null, WALKTHROUGH]);
    const decision = harness.send({
      type: 'agent.complete_fix',
      runId: harness.activeRun(taskId).id,
      summary: 'Fixed the types.',
      walkthrough: null,
    });
    expect(decision.events.map((event) => event.type)).not.toContain('walkthrough.revised');
    expect(walkthroughsOf(harness, taskId)).toEqual([null, WALKTHROUGH]);
  });

  test('with no walkthrough yet, a revision with the approach and the flow starts one on the last phase', () => {
    const { harness, taskId } = reachFix([null, null]);
    harness.send({
      type: 'agent.complete_fix',
      runId: harness.activeRun(taskId).id,
      summary: 'Rewrote it.',
      walkthrough: { approach: 'Measure first.', flow: 'measure → clamp' },
    });
    expect(walkthroughsOf(harness, taskId)).toEqual([
      null,
      {
        approach: 'Measure first.',
        flow: 'measure → clamp',
        risks: [],
        testing: { automated: [], manual: [] },
      },
    ]);
  });

  test('with no walkthrough yet, a revision missing the approach or the flow changes nothing', () => {
    const { harness, taskId } = reachFix([null, null]);
    harness.send({
      type: 'agent.complete_fix',
      runId: harness.activeRun(taskId).id,
      summary: 'Rewrote it.',
      walkthrough: { flow: 'measure → clamp', testing: { automated: ['Resize it.'], manual: [] } },
    });
    expect(walkthroughsOf(harness, taskId)).toEqual([null, null]);
  });

  test('a task with no phase reports ignores a revision', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const before = harness.task(taskId);
    harness.replay({
      type: 'walkthrough.revised',
      taskId,
      walkthrough: { approach: 'A.', flow: 'B.' },
      runId: 'run-x',
    });
    expect(harness.task(taskId)).toBe(before);
  });
});
