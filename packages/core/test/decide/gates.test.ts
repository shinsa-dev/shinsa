import { describe, expect, test } from 'bun:test';
import {
  GATE_SCHEMA,
  type GateType,
  listOpenGates,
  type ReviewComment,
  SHAPE_PIPELINES,
  type TaskShape,
} from '../../src/index.ts';
import {
  approve,
  buildAll,
  checkResult,
  completePhase,
  createHarness,
  createTask,
  type Harness,
  PASSING,
  PLAN,
  proposePlan,
  pullRequest,
  pushed,
  reachReviewGate,
  reachShipping,
  readInstruction,
  readyWorktree,
  verifySetup,
} from '../harness.ts';

describe('answering a gate', () => {
  test('a gate is answered once', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    const gateId = harness.openGate(taskId).id;
    approve(harness, taskId);
    expect(() => harness.send({ type: 'gate.answer', gateId, decision: 'approve', response: null })).toThrow(
      'This has already been answered.'
    );
    expect(() =>
      harness.send({ type: 'gate.answer', gateId: 'nope', decision: 'approve', response: null })
    ).toThrow('No gate nope');
  });

  test('each kind of gate takes only the decisions that mean something for it', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    const review = harness.openGate(taskId).id;
    expect(() =>
      harness.send({ type: 'gate.answer', gateId: review, decision: 'reply', response: 'ok' })
    ).toThrow('Approve it, ask for changes or reject it.');

    const asking = createTask(harness, { request: 'Ask' });
    const runId = harness.activeRun(asking).id;
    harness.send({ type: 'agent.ask', runId, gateId: 'q1', question: 'Which tab?', context: null });
    expect(() =>
      harness.send({ type: 'gate.answer', gateId: 'q1', decision: 'approve', response: 'x' })
    ).toThrow('Answer the question.');
    expect(() =>
      harness.send({ type: 'gate.answer', gateId: 'q1', decision: 'reply', response: ' ' })
    ).toThrow('Write an answer first.');

    harness.send({ type: 'effect.fail', taskId: asking, title: 'Broke', detail: 'x' });
    const failure = harness.openGate(asking).id;
    expect(() =>
      harness.send({ type: 'gate.answer', gateId: failure, decision: 'revise', response: null })
    ).toThrow('Retry or cancel the task.');
    expect(listOpenGates(harness.state)).toHaveLength(2);
  });

  test('an answer to a failure retries the step with it as guidance', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    harness.send({ type: 'effect.fail', taskId, title: 'Broke', detail: 'x' });
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'reply',
      response: 'Use the grid.',
    });
    expect(harness.activeRun(taskId).prompt).toContain('Guidance from the human: Use the grid.');
  });

  test('approving a plan stores the answers to its questions and starts building', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { approvePlans: true } });
    const taskId = createTask(harness, { size: 'large' });
    proposePlan(harness, taskId);
    approve(harness, taskId, '  Use 240px.  ');
    expect(harness.task(taskId)).toMatchObject({ stage: 'building', planAnswers: 'Use 240px.' });
    expect(harness.activeRun(taskId).prompt).toContain('The human answered:\nUse 240px.');
  });

  test('asking for changes to a plan sends it back to the agent', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { approvePlans: true } });
    const taskId = createTask(harness, { size: 'large' });
    proposePlan(harness, taskId);
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'revise',
      response: null,
    });
    expect(harness.task(taskId).stageReason).toBe('revising the plan');
    expect(harness.activeRun(taskId).prompt).toContain('Feedback on the previous plan:\nRevise the plan.');
  });

  test('asking for changes at the review gate starts the agent, then the checks it names and review again', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'revise',
      response: 'Dark mode.',
    });
    const run = harness.activeRun(taskId);
    expect(run).toMatchObject({ role: 'agent', purpose: 'fix' });
    expect(run.prompt).toContain('Dark mode.');
    harness.send({ type: 'agent.complete_fix', runId: run.id, summary: 'Added dark mode.', checks: ['c1'] });
    expect(harness.task(taskId).stage).toBe('checking');
    harness.send({ type: 'checks.record', taskId, results: [checkResult('c1', 'pass')] });
    expect(harness.activeRun(taskId).role).toBe('reviewer');
  });

  test('a fix of your changes that names no check goes straight to the agent review', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'revise',
      response: 'Fix the copy.',
    });
    harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary: 'Reworded.' });
    expect(harness.task(taskId).stage).toBe('reviewing');
    expect(harness.effectsOf('checks.run')).toHaveLength(1);
  });

  test('asking for changes at the merge gate without words still starts a fix', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachShipping(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'revise',
      response: null,
    });
    expect(harness.activeRun(taskId).prompt).toContain('Revise the work.');
    expect(harness.task(taskId).fixFor).toBe('you');
  });

  test('rejecting a decision cancels the task', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'reject',
      response: null,
    });
    expect(harness.task(taskId)).toMatchObject({ stage: 'cancelled', stageReason: 'review rejected' });
  });
});

describe('approving a plan', () => {
  function planGate() {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { approvePlans: true } });
    const taskId = createTask(harness, { size: 'large' });
    proposePlan(harness, taskId);
    return { harness, taskId, gate: harness.openGate(taskId) };
  }

  test('approves the version you read and hands the agent that version', () => {
    const { harness, taskId, gate } = planGate();
    harness.send({
      type: 'gate.answer',
      gateId: gate.id,
      decision: 'approve',
      response: null,
      planVersion: 1,
    });
    expect(harness.task(taskId).plan?.approvedAt).toBeNumber();
    expect(harness.activeRun(taskId).prompt).toContain(
      'This is plan version 1, approved by the human. Follow this exact version'
    );
  });

  test('refuses an approval for a version that is no longer current', () => {
    const { harness, gate } = planGate();
    expect(() =>
      harness.send({
        type: 'gate.answer',
        gateId: gate.id,
        decision: 'approve',
        response: null,
        planVersion: 3,
      })
    ).toThrow('The plan changed to version 1 after you opened it.');
  });

  test('refuses an approval of a plan that is being revised or was replaced', () => {
    const { harness, taskId, gate } = planGate();
    harness.send({ type: 'task.message', taskId, text: 'Smaller, please.' });
    expect(() =>
      harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'approve', response: null })
    ).toThrow('The planner is revising this plan.');
    proposePlan(harness, taskId);
    expect(() =>
      harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'approve', response: null })
    ).toThrow('The plan changed to version 2 after you opened it.');
    harness.send({ type: 'task.cancel', taskId });
    expect(() =>
      harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'approve', response: null })
    ).toThrow('This has already been answered.');
  });

  test('a plan gate from before versions still approves', () => {
    const { harness, taskId, gate } = planGate();
    harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'approve', response: 'Use the flag.' });
    expect(harness.task(taskId).planAnswers).toBe('Use the flag.');
    expect(harness.task(taskId).stage).toBe('building');
  });
});

describe('verdicts on review findings', () => {
  function reviewWithFindings() {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    harness.send({
      type: 'agent.report_review',
      runId: harness.activeRun(taskId).id,
      summary: null,
      findings: [
        { severity: 'should_fix', file: 'a.ts', line: 3, message: 'Rename it.' },
        { severity: 'optional', file: 'b.ts', line: 9, message: 'Cache it.' },
      ],
    });
    return { harness, taskId, gate: harness.openGate(taskId) };
  }

  test('asking for changes sends the agent only what you kept and leaves the rest alone', () => {
    const { harness, taskId, gate } = reviewWithFindings();
    harness.send({
      type: 'gate.answer',
      gateId: gate.id,
      decision: 'revise',
      response: 'Keep the API stable.',
      verdicts: [
        { index: 0, verdict: 'fix', note: null },
        { index: 1, verdict: 'dismiss', note: 'Premature.' },
      ],
    });
    const prompt = readInstruction(harness.activeRun(taskId));
    expect(prompt.startsWith('The human looked at the work and decided on each review finding.')).toBe(true);
    expect(prompt).toContain('Fix these:\n- [should fix] a.ts:3: Rename it.');
    expect(prompt).toContain(
      'Leave these alone; the human dismissed them:\n- [optional] b.ts:9: Cache it. (the human: Premature.)'
    );
    expect(prompt).toContain('The human also wrote:\nKeep the API stable.');
    expect(harness.task(taskId).findings.map((finding) => finding.verdict)).toEqual(['fix', 'dismiss']);
    expect(harness.task(taskId).dismissedFindings).toHaveLength(1);
    expect(harness.state.gates[gate.id]?.verdicts).toHaveLength(2);
  });

  test('approving can dismiss findings but cannot ask for a fix', () => {
    const { harness, taskId, gate } = reviewWithFindings();
    expect(() =>
      harness.send({
        type: 'gate.answer',
        gateId: gate.id,
        decision: 'approve',
        response: null,
        verdicts: [{ index: 0, verdict: 'fix', note: null }],
      })
    ).toThrow('Approving ships the work as it is.');
    harness.send({
      type: 'gate.answer',
      gateId: gate.id,
      decision: 'approve',
      response: null,
      verdicts: [{ index: 1, verdict: 'dismiss', note: null }],
    });
    expect(harness.task(taskId).stage).toBe('shipping');
  });

  test('a verdict must name a finding of this review, once', () => {
    const { harness, gate } = reviewWithFindings();
    const send = (verdicts: { index: number; verdict: 'fix' | 'dismiss'; note: null }[]) =>
      harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'revise', response: null, verdicts });
    expect(() => send([{ index: 5, verdict: 'fix', note: null }])).toThrow('Each verdict must name');
    expect(() =>
      send([
        { index: 0, verdict: 'fix', note: null },
        { index: 0, verdict: 'dismiss', note: null },
      ])
    ).toThrow('Each verdict must name');
  });

  test('only review findings take verdicts, and an empty list is no verdict', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { approvePlans: true } });
    const taskId = createTask(harness, { size: 'large' });
    proposePlan(harness, taskId);
    const gate = harness.openGate(taskId);
    expect(() =>
      harness.send({
        type: 'gate.answer',
        gateId: gate.id,
        decision: 'revise',
        response: 'x',
        verdicts: [{ index: 0, verdict: 'fix', note: null }],
      })
    ).toThrow('Only review findings take a verdict.');
    harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'approve', response: null, verdicts: [] });
    expect(harness.state.gates[gate.id]?.verdicts).toBeUndefined();
  });
});

describe('line comments with a request for changes', () => {
  const comment: ReviewComment = {
    path: 'src/a.ts',
    side: 'new',
    line: 2,
    endLine: 3,
    text: 'Make these one constant.',
  };

  function reviewGate() {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    return { harness, taskId, gate: harness.openGate(taskId) };
  }

  test('the agent gets each comment with its path, lines and words', () => {
    const { harness, taskId, gate } = reviewGate();
    harness.send({
      type: 'gate.answer',
      gateId: gate.id,
      decision: 'revise',
      response: null,
      comments: [comment, { ...comment, line: 9, endLine: null, text: 'Why?' }],
    });
    const prompt = readInstruction(harness.activeRun(taskId));
    expect(prompt).toStartWith('The human looked at the work and left line comments.');
    expect(prompt).toContain('- src/a.ts, lines 2-3: Make these one constant.');
    expect(prompt).toContain('- src/a.ts, line 9: Why?');
  });

  test('line comments go only with a request for changes at a review or merge gate', () => {
    const { harness, gate } = reviewGate();
    expect(() =>
      harness.send({
        type: 'gate.answer',
        gateId: gate.id,
        decision: 'approve',
        response: null,
        comments: [comment],
      })
    ).toThrow('Line comments go to the agent when you request changes.');
    harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'approve', response: null, comments: [] });
    expect(harness.state.gates[gate.id]?.status).toBe('answered');

    const planned = createHarness();
    planned.send({ type: 'settings.change', patch: { approvePlans: true } });
    const taskId = createTask(planned, { size: 'large' });
    proposePlan(planned, taskId);
    expect(() =>
      planned.send({
        type: 'gate.answer',
        gateId: planned.openGate(taskId).id,
        decision: 'revise',
        response: 'x',
        comments: [comment],
      })
    ).toThrow('Only a review takes line comments.');
  });

  test('refuses a comment whose lines or words do not hold together', () => {
    const { harness, gate } = reviewGate();
    const send = (sent: ReviewComment) =>
      refusalOf(() =>
        harness.send({
          type: 'gate.answer',
          gateId: gate.id,
          decision: 'revise',
          response: null,
          comments: [sent],
        })
      );
    expect(send({ ...comment, endLine: 2 })).toBe('The comment on src/a.ts must end on a line after line 2.');
    expect(send({ ...comment, text: ' ' })).toBe('The comment on src/a.ts has no words.');
  });
});

function refusalOf(send: () => unknown) {
  try {
    send();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('decisions only the human makes', () => {
  function triaged(harness: Harness, repoId: string, request: string, shape?: TaskShape) {
    harness.send({ type: 'task.create', request, repoId });
    const taskId = Object.keys(harness.state.tasks).at(-1) ?? '';
    harness.send({
      type: 'task.triage',
      taskId,
      title: request,
      repoId,
      size: 'small',
      branch: `fix/${taskId}`,
      waitsOn: [],
      ...(shape ? { shape } : {}),
    });
    return taskId;
  }

  function openEveryGate() {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { approvePlans: true } });
    const gates = new Map<GateType, string>();
    const remember = (taskId: string) => {
      const gate = harness.openGate(taskId);
      gates.set(gate.type, gate.id);
    };
    const plan = createTask(harness, { request: 'Plan', size: 'large' });
    proposePlan(harness, plan);
    remember(plan);
    const review = createTask(harness, { request: 'Review' });
    reachReviewGate(harness, review);
    remember(review);
    const merge = createTask(harness, { request: 'Merge' });
    reachShipping(harness, merge);
    harness.send({ type: 'pull_request.record', taskId: merge, pullRequest: pullRequest() });
    remember(merge);
    const question = createTask(harness, { request: 'Question' });
    const asker = harness.activeRun(question).id;
    harness.send({ type: 'agent.ask', runId: asker, gateId: 'q1', question: 'Which?', context: null });
    remember(question);
    const secret = createTask(harness, { request: 'Secret' });
    harness.send({
      type: 'agent.request_secret',
      runId: harness.activeRun(secret).id,
      gateId: 's1',
      label: 'Token',
      reason: 'To call the API.',
    });
    remember(secret);
    const failure = createTask(harness, { request: 'Failure' });
    harness.send({ type: 'effect.fail', taskId: failure, title: 'Broke', detail: 'x' });
    remember(failure);
    const signIn = createTask(harness, { request: 'Sign in' });
    harness.send({
      type: 'run.end',
      runId: harness.activeRun(signIn).id,
      outcome: 'failed',
      summary: 'Signed out.',
      failure: {
        class: 'auth',
        message: 'Signed out.',
        code: 'authentication_failed',
        retryable: null,
        resetAt: null,
        account: { id: 'acc-work', email: 'work@example.com' },
      },
    });
    remember(signIn);
    const repoId = Object.keys(harness.state.repos)[0] ?? '';
    const setup = triaged(harness, repoId, 'Setup');
    verifySetup(harness, setup, [{ kind: 'default_branch', detail: 'No main.' }]);
    remember(setup);
    const proposal = triaged(harness, repoId, 'Proposal', 'investigate');
    readyWorktree(harness, proposal);
    harness.send({
      type: 'agent.deliver',
      runId: harness.activeRun(proposal).id,
      step: 'investigate',
      body: 'The cache.',
      proposal: { request: 'Clear the cache.', why: 'It is stale.' },
    });
    remember(proposal);
    const operation = createTask(harness, { request: 'Operation' });
    harness.send({
      type: 'agent.reshape',
      runId: harness.activeRun(operation).id,
      steps: [...SHAPE_PIPELINES.change, 'operate'],
      reason: 'Backfill after the merge.',
    });
    proposePlan(harness, operation, { ...PLAN, operation: ['Backfill the column.'] });
    approve(harness, operation);
    completePhase(harness, operation);
    completePhase(harness, operation);
    harness.send({ type: 'checks.record', taskId: operation, results: PASSING });
    harness.send({
      type: 'agent.report_review',
      runId: harness.activeRun(operation).id,
      summary: null,
      findings: [],
    });
    approve(harness, operation);
    pushed(harness, operation);
    harness.send({
      type: 'pull_request.record',
      taskId: operation,
      pullRequest: pullRequest({ state: 'merged', mergeCommit: 'f00d' }),
    });
    remember(operation);
    return { harness, gates };
  }

  test('core refuses every gate answered on an agent’s behalf, whatever the decision, and records nothing', () => {
    const { harness, gates } = openEveryGate();
    const types: GateType[] = [
      'configuration',
      'failure',
      'merge',
      'operation',
      'plan',
      'proposal',
      'question',
      'review',
      'secret',
      'sign_in',
    ];
    expect([...gates.keys()].sort()).toEqual(types.sort());
    for (const gateId of gates.values()) {
      for (const decision of ['approve', 'revise', 'reject', 'reply'] as const) {
        const before = harness.events.length;
        expect(() =>
          harness.send(
            { type: 'gate.answer', gateId, decision, response: 'Ship it.' },
            { onBehalf: true, byTask: 'other' }
          )
        ).toThrow('Only the human decides this.');
        expect(harness.events).toHaveLength(before);
        expect(harness.state.gates[gateId]?.status).toBe('open');
      }
    }
    expect(() =>
      harness.send(
        { type: 'gate.answer', gateId: 'gone', decision: 'approve', response: null },
        { onBehalf: true }
      )
    ).toThrow('Only the human decides this.');
  });

  test('a reply is taken only by the gates that list it, and refused with the gate’s own words', () => {
    const { harness, gates } = openEveryGate();
    for (const [type, gateId] of gates) {
      const definition = GATE_SCHEMA[type];
      if (definition.decisions.some((choice) => choice.decision === 'reply')) continue;
      const refusal = type === 'secret' ? 'Paste the secret into the secret field.' : definition.refusal;
      expect(
        () => harness.send({ type: 'gate.answer', gateId, decision: 'reply', response: 'Words.' }),
        type
      ).toThrow(refusal);
    }
    const takesReply = [...gates.keys()].filter((type) =>
      GATE_SCHEMA[type].decisions.some((choice) => choice.decision === 'reply')
    );
    expect(takesReply.sort()).toEqual(['failure', 'operation', 'question', 'secret', 'sign_in']);
  });

  test('a reply retries a failure or a Sign in gate with the words as guidance, and needs words', () => {
    const { harness, gates } = openEveryGate();
    for (const type of ['failure', 'sign_in'] as const) {
      const gateId = gates.get(type) ?? '';
      expect(() => harness.send({ type: 'gate.answer', gateId, decision: 'reply', response: ' ' })).toThrow(
        'Write an answer first.'
      );
      harness.send({ type: 'gate.answer', gateId, decision: 'reply', response: 'Use the grid.' });
      const taskId = harness.state.gates[gateId]?.taskId ?? '';
      expect(harness.activeRun(taskId).prompt).toContain('Use the grid.');
    }
  });

  test('a retry, a completion or a cancel on your behalf cannot step past an open gate, and records nothing', () => {
    const { harness, gates } = openEveryGate();
    const refused: string[] = [];
    for (const gateId of gates.values()) {
      const taskId = harness.state.gates[gateId]?.taskId ?? '';
      for (const command of [
        { type: 'task.retry', taskId },
        { type: 'task.complete', taskId },
        { type: 'task.cancel', taskId },
      ] as const) {
        const before = harness.events.length;
        const refusal = refusalOf(() => harness.send(command, { onBehalf: true, byTask: 'other' }));
        if (refusal?.startsWith('This task waits for a decision only the human makes.'))
          refused.push(refusal);
        expect(harness.events).toHaveLength(before);
      }
      expect(harness.state.gates[gateId]?.status).toBe('open');
    }
    expect(refused.length).toBeGreaterThanOrEqual(gates.size);
  });

  test('a message on your behalf to a task at a gate is kept for the next agent and closes nothing', () => {
    const { harness, gates } = openEveryGate();
    for (const gateId of gates.values()) {
      const taskId = harness.state.gates[gateId]?.taskId ?? '';
      const before = harness.events.length;
      const decision = harness.send(
        { type: 'task.message', taskId, text: 'Carry on.' },
        { onBehalf: true, byTask: 'other' }
      );
      expect(decision.events.map((event) => event.type)).toEqual(['task.messaged', 'on_behalf.acted']);
      expect(decision.effects).toEqual([]);
      expect(harness.events.length).toBe(before + 2);
      expect(harness.state.gates[gateId]?.status).toBe('open');
    }
  });

  test('an agent cannot mark a task done for you while it waits on a decision only you make', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    expect(() =>
      harness.send({ type: 'task.complete', taskId }, { onBehalf: true, byTask: 'other' })
    ).toThrow('This task waits for a decision only the human makes.');
    expect(harness.task(taskId).stage).toBe('awaiting_review');
    harness.send({ type: 'task.complete', taskId });
    expect(harness.task(taskId).stage).toBe('done');
  });

  test('the human answers the same gates after an agent was refused', () => {
    const { harness, gates } = openEveryGate();
    const question = gates.get('question') ?? '';
    harness.send({ type: 'gate.answer', gateId: question, decision: 'reply', response: 'Redis.' });
    expect(harness.state.gates[question]?.status).toBe('answered');
    const failure = gates.get('failure') ?? '';
    harness.send({ type: 'gate.answer', gateId: failure, decision: 'approve', response: null });
    expect(harness.state.gates[failure]?.status).toBe('answered');
  });
});
