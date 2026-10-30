import { describe, expect, test } from 'bun:test';
import { type Coverage, listActiveRuns, listOpenGates } from '../../src/index.ts';
import {
  buildAll,
  completePhase,
  createHarness,
  createTask,
  failing,
  type Harness,
  linkSession,
  PASSING,
  proposePlan,
  reachReviewGate,
  readInstruction,
  registerRepo,
} from '../harness.ts';

const MANY_CHECKS = Array.from({ length: 24 }, (_, index) => `check ${index + 1}`);

function createManyChecks(harness: Harness) {
  registerRepo(harness, 'paywall-next', 'Superwall', MANY_CHECKS);
}

const COVERAGE = {
  status: 'measured',
  command: 'bun test --coverage',
  covered: 3,
  executable: 4,
  files: [{ path: 'src/a.ts', covered: 3, executable: 4, uncovered: [[7, 7]] }],
} as const;

describe('coverage of the changed lines', () => {
  test('is recorded with the checks, and read by the reviewer', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({
      type: 'checks.record',
      taskId,
      results: PASSING,
      coverage: structuredClone(COVERAGE) as unknown as Coverage,
    });
    expect(harness.task(taskId).coverage).toEqual(COVERAGE as unknown as Coverage);
    const reviewer = harness.activeRun(taskId).prompt ?? '';
    expect(reviewer).toContain(
      "Shinsa measured the tests' coverage of the changed lines: 75% of changed lines are covered (3 of 4)."
    );
    expect(reviewer).toContain('- src/a.ts: 3 of 4 changed lines covered; not covered: 7');
  });

  test('a run that measured nothing keeps what the last measured run found', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({
      type: 'checks.record',
      taskId,
      results: failing(),
      coverage: COVERAGE as unknown as Coverage,
    });
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Typed it.' });
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    expect(harness.task(taskId).coverage).toEqual(COVERAGE as unknown as Coverage);
    expect(harness.activeRun(taskId).prompt).toContain('coverage of the changed lines');
  });
});

describe('checks and agent review', () => {
  test('passing checks start an independent reviewer', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    const run = harness.activeRun(taskId);
    expect(harness.task(taskId).stage).toBe('reviewing');
    expect(run.role).toBe('reviewer');
    expect(run.resume).toBe(false);
    expect(run.prompt).toContain('You did not write this code.');
  });

  test('failing checks start the agent on the agent session with the failure output', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    completePhase(harness, taskId);
    linkSession(harness, taskId, 'builder-2');
    completePhase(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: failing() });
    const run = harness.activeRun(taskId);
    const task = harness.task(taskId);
    expect(task.stage).toBe('fixing');
    expect(task.fixFor).toBe('checks');
    expect(task.fixRounds).toBe(1);
    expect(run).toMatchObject({ role: 'agent', purpose: 'fix' });
    expect(run.sessionId).toBe('builder-2');
    expect(run.prompt).toContain('src/a.ts(3,1): error TS2322');
  });

  test('a finished fix runs the checks again, then the review', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: failing() });
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Typed it.' });
    expect(harness.task(taskId).stage).toBe('checking');
    expect(harness.lastEffect('checks.run').round).toBe(1);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    expect(harness.task(taskId).stage).toBe('reviewing');
  });

  test('blocking findings go to the agent, then checks and a fresh reviewer', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    const reviewer = harness.activeRun(taskId);
    harness.send({
      type: 'agent.report_review',
      runId: reviewer.id,
      summary: null,
      findings: [{ severity: 'blocking', file: 'src/a.ts', line: 3, message: 'Off by one.' }],
    });
    expect(harness.task(taskId).stage).toBe('fixing');
    expect(harness.activeRun(taskId).prompt).toContain('src/a.ts:3: Off by one.');
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Fixed.' });
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    const second = harness.activeRun(taskId);
    expect(second.role).toBe('reviewer');
    expect(second.id).not.toBe(reviewer.id);
  });

  test('suggestions alone do not block the review gate', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    harness.send({
      type: 'agent.report_review',
      runId: harness.activeRun(taskId).id,
      summary: 'Checked the change; one naming nit.',
      findings: [
        {
          severity: 'optional',
          file: null,
          line: null,
          title: 'Vague name',
          message: 'Rename it.',
          fix: 'Call it `retryCount`.',
        },
      ],
    });
    expect(harness.task(taskId).stage).toBe('awaiting_review');
    expect(harness.task(taskId).reviewSummary).toBe('Checked the change; one naming nit.');
    expect(harness.task(taskId).findings[0]).toMatchObject({
      title: 'Vague name',
      fix: 'Call it `retryCount`.',
    });
  });

  test('the same failure twice in a row stops the loop with a failure gate', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    for (let round = 0; round < 3; round += 1) {
      harness.send({ type: 'checks.record', taskId, results: failing() });
      if (harness.task(taskId).stage !== 'fixing') break;
      harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Tried.' });
    }
    const gate = harness.openGate(taskId);
    expect(gate.type).toBe('failure');
    expect(gate.title).toBe('Fixing is not making progress');
    expect(gate.body).toBe(
      'The failing checks came back after 2 fix rounds. Steer the agent in the chat, or retry.'
    );
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);
  });

  test('a different failure each round keeps fixing until the round cap', () => {
    const harness = createHarness();
    createManyChecks(harness);
    harness.send({ type: 'settings.change', patch: { maxFixRounds: 2 } });
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: failing('r3') });
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'One.' });
    harness.send({ type: 'checks.record', taskId, results: failing('r4') });
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Two.' });
    harness.send({ type: 'checks.record', taskId, results: failing('r5') });
    expect(harness.openGate(taskId).title).toBe('Out of automatic fix rounds');
  });

  test('retrying after a stalled loop gives the agent another go', () => {
    const harness = createHarness();
    createManyChecks(harness);
    harness.send({ type: 'settings.change', patch: { maxFixRounds: 1 } });
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: failing('r3') });
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'One.' });
    harness.send({ type: 'checks.record', taskId, results: failing('r4') });
    const gate = harness.openGate(taskId);
    harness.send({
      type: 'gate.answer',
      gateId: gate.id,
      decision: 'approve',
      response: 'Look at the types.',
    });
    expect(harness.task(taskId).stage).toBe('checking');
  });

  test('checks recorded outside the checking stage are ignored', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'checks.record', taskId, results: failing() });
    expect(harness.task(taskId).stage).toBe('planning');
    expect(harness.task(taskId).checkResults).toBeNull();
  });
});

describe('fix loop limits', () => {
  test('alternating failures still stop: a failure seen twice before ends the loop', () => {
    const harness = createHarness();
    createManyChecks(harness);
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    const finding = (message: string) => ({
      severity: 'blocking' as const,
      file: 'src/a.ts',
      line: 1,
      message,
    });
    for (let round = 0; round < 3; round += 1) {
      harness.send({ type: 'checks.record', taskId, results: failing('r1') });
      if (harness.task(taskId).stage !== 'fixing') break;
      harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'x' });
      harness.send({ type: 'checks.record', taskId, results: PASSING });
      harness.send({
        type: 'agent.report_review',
        runId: harness.activeRun(taskId).id,
        summary: null,
        findings: [finding(`wording ${round}`)],
      });
      if (harness.task(taskId).stage !== 'fixing') break;
      harness.send({
        type: 'agent.complete_fix',
        runId: harness.activeRun(taskId).id,
        summary: 'y',
        checks: ['r1'],
      });
    }
    expect(harness.openGate(taskId).title).toBe('Fixing is not making progress');
  });

  test('"until clean" has no round cap while each round brings something new', () => {
    const harness = createHarness();
    createManyChecks(harness);
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    for (let round = 0; round < 20; round += 1) {
      harness.send({ type: 'checks.record', taskId, results: failing(`r${round + 3}`) });
      expect(harness.task(taskId).stage).toBe('fixing');
      harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'x' });
    }
    expect(harness.task(taskId).fixRounds).toBe(20);
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
  });
});

describe('the automatic fix budget', () => {
  test('retrying after the rounds ran out gives the agent a fresh budget', () => {
    const harness = createHarness();
    createManyChecks(harness);
    harness.send({ type: 'settings.change', patch: { maxFixRounds: 1 } });
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: failing('r3') });
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'One.' });
    harness.send({ type: 'checks.record', taskId, results: failing('r4') });
    expect(harness.openGate(taskId).title).toBe('Out of automatic fix rounds');
    harness.send({ type: 'task.retry', taskId });
    harness.send({ type: 'checks.record', taskId, results: failing('r4') });
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'fix' });
    expect(harness.task(taskId).fixRounds).toBe(1);
  });

  test('retrying after a stalled loop does not stop again on the same failure', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    for (let round = 0; round < 3; round += 1) {
      harness.send({ type: 'checks.record', taskId, results: failing() });
      if (harness.task(taskId).stage !== 'fixing') break;
      harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Tried.' });
    }
    expect(harness.openGate(taskId).title).toBe('Fixing is not making progress');
    harness.send({ type: 'task.retry', taskId });
    harness.send({ type: 'checks.record', taskId, results: failing() });
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'fix' });
  });

  test('changes you ask for start a fresh budget and do not use it up', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { maxFixRounds: 1 } });
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'revise',
      response: 'Rename.',
    });
    harness.send({
      type: 'agent.complete_fix',
      runId: harness.activeRun(taskId).id,
      summary: 'Renamed.',
      checks: ['r2'],
    });
    harness.send({ type: 'checks.record', taskId, results: failing() });
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'fix' });
  });
});

describe('review rounds that escalate to you', () => {
  const blocking = (message = 'Off by one.') => [
    { severity: 'blocking' as const, file: 'src/a.ts', line: 3, message },
  ];

  function review(harness: Harness, taskId: string, findings = blocking()) {
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    harness.send({
      type: 'agent.report_review',
      runId: harness.activeRun(taskId).id,
      summary: null,
      findings,
    });
  }

  function fix(harness: Harness, taskId: string, treeHash: string | null = null) {
    harness.send({
      type: 'agent.complete_fix',
      runId: harness.activeRun(taskId).id,
      summary: 'Fixed.',
      ...(treeHash ? { treeHash } : {}),
    });
  }

  test('the third request for changes goes to you as a review, not a failure', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    review(harness, taskId, blocking('First.'));
    fix(harness, taskId, 'tree-1');
    review(harness, taskId, blocking('Second.'));
    fix(harness, taskId, 'tree-2');
    review(harness, taskId, blocking('Third.'));
    const gate = harness.openGate(taskId);
    expect(gate).toMatchObject({
      type: 'review',
      escalation: { reason: 'rounds', rounds: 2 },
    });
    expect(harness.task(taskId).stage).toBe('awaiting_review');
    expect(harness.task(taskId).stageReason).toBe('the agents could not settle the review');
    expect(
      harness.task(taskId).activity.some((entry) => entry.text.startsWith('Sent the review to you'))
    ).toBe(true);
  });

  test('a fix that changed no code sends the review to you at once', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    for (let phase = 0; phase < 2; phase += 1) {
      harness.send({
        type: 'agent.complete_phase',
        runId: harness.activeRun(taskId).id,
        summary: 'x',
        spots: [],
        judgementCalls: [],
        treeHash: 'tree-0',
      });
    }
    review(harness, taskId);
    fix(harness, taskId, 'tree-0');
    review(harness, taskId, blocking('Still off.'));
    expect(harness.openGate(taskId).escalation).toMatchObject({ reason: 'stalled', rounds: 1 });
  });

  test('when the fix rounds run out during review, you decide', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { maxFixRounds: 1 } });
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    review(harness, taskId);
    fix(harness, taskId, 'tree-1');
    review(harness, taskId, blocking('Still off.'));
    expect(harness.openGate(taskId).escalation?.reason).toBe('exhausted');
  });

  test('your decision resets the count', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    review(harness, taskId, blocking('First.'));
    fix(harness, taskId, 'tree-1');
    review(harness, taskId, blocking('Second.'));
    fix(harness, taskId, 'tree-2');
    review(harness, taskId, blocking('Third.'));
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'revise',
      response: 'Do the first one only.',
    });
    expect(harness.task(taskId).fixFingerprints).toEqual([]);
    fix(harness, taskId, 'tree-3');
    review(harness, taskId, blocking('Fourth.'));
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'fix' });
  });

  test('fixing the findings you kept sends your line comments too, and the activity keeps them', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    review(harness, taskId, blocking('First.'));
    fix(harness, taskId, 'tree-1');
    review(harness, taskId, blocking('Second.'));
    fix(harness, taskId, 'tree-2');
    review(harness, taskId, blocking('Third.'));
    const comment = {
      path: 'src/a.ts',
      side: 'new' as const,
      line: 4,
      endLine: null,
      text: 'Keep the guard here.',
    };
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'revise',
      response: null,
      verdicts: [{ index: 0, verdict: 'fix', note: null }],
      comments: [comment],
    });
    const prompt = readInstruction(harness.activeRun(taskId));
    expect(prompt).toStartWith('The human looked at the work and decided on each review finding.');
    expect(prompt).toContain('- src/a.ts, line 4: Keep the guard here.');
    const decision = harness
      .task(taskId)
      .activity.filter((entry) => entry.kind === 'decision')
      .at(-1);
    expect(decision?.comments).toEqual([comment]);
    expect(harness.events.filter((event) => event.type === 'gate.answered').at(-1)).toMatchObject({
      comments: [comment],
    });
  });

  test('a decision without line comments records none', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'revise',
      response: 'Again.',
    });
    const decision = harness
      .task(taskId)
      .activity.filter((entry) => entry.kind === 'decision')
      .at(-1);
    expect(decision).toBeDefined();
    expect(decision && 'comments' in decision).toBe(false);
  });

  test('a finding you dismissed does not block when the reviewer raises it again', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    review(harness, taskId, blocking('First.'));
    fix(harness, taskId, 'tree-1');
    review(harness, taskId, blocking('Second.'));
    fix(harness, taskId, 'tree-2');
    review(harness, taskId, blocking('Third.'));
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'revise',
      response: null,
      verdicts: [{ index: 0, verdict: 'dismiss', note: 'Intended.' }],
    });
    fix(harness, taskId, 'tree-3');
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    expect(harness.activeRun(taskId).prompt).toContain('The human dismissed these findings');
    harness.send({
      type: 'agent.report_review',
      runId: harness.activeRun(taskId).id,
      summary: null,
      findings: blocking('Third.'),
    });
    expect(harness.openGate(taskId)).toMatchObject({ type: 'review' });
    expect(harness.openGate(taskId).escalation).toBeUndefined();
  });
});

describe('fix fingerprints', () => {
  test('a round that changed no code counts as a repeat even when the failure differs', () => {
    const harness = createHarness();
    createManyChecks(harness);
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: failing('r3') });
    harness.send({
      type: 'agent.complete_fix',
      runId: harness.activeRun(taskId).id,
      summary: 'x',
      treeHash: 't1',
    });
    harness.send({ type: 'checks.record', taskId, results: failing('r4') });
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Same.' });
    harness.send({ type: 'checks.record', taskId, results: failing('r5') });
    expect(harness.task(taskId).stalledFixes).toBe(1);
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Same again.' });
    harness.send({ type: 'checks.record', taskId, results: failing('r6') });
    expect(harness.openGate(taskId).title).toBe('Fixing is not making progress');
  });

  test('a round that changed the code and moved the failure keeps going', () => {
    const harness = createHarness();
    createManyChecks(harness);
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    for (const [round, check] of ['r3', 'r4', 'r5', 'r6'].entries()) {
      harness.send({ type: 'checks.record', taskId, results: failing(check) });
      harness.send({
        type: 'agent.complete_fix',
        runId: harness.activeRun(taskId).id,
        summary: 'x',
        treeHash: `t${round}`,
      });
    }
    expect(harness.task(taskId).fixRounds).toBe(4);
    expect(harness.task(taskId).fixFingerprints?.map((fingerprint) => fingerprint.signature)).toEqual([
      'r3',
      'r4',
      'r5',
      'r6',
    ]);
  });
});
