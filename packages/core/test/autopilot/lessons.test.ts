import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
import {
  AUTOPILOT_LESSON_LIMITS,
  type AutopilotLesson,
  type AutopilotPolicy,
  describeAutopilotLesson,
  listAutopilotLessons,
  selectAutopilotJudgeRequest,
  resolveAutopilotLessonSummary,
  resolveLessonLimit,
  MINUTE_MS,
  type ReviewRatings,
} from '../../src/index.ts';
import { listOpenGates } from '../../src/state/queries.ts';
import {
  buildAll,
  completePhase,
  createHarness,
  createTask,
  type Harness,
  PASSING,
  proposePlan,
  pullRequest,
  pushed,
  refreshWorktree,
} from '../harness.ts';

const HIGH_LOW: ReviewRatings = { confidence: 'high', risk: 'low' };

const MEDIUM: ReviewRatings = { confidence: 'medium', risk: 'low' };

function enable(harness: Harness, policy: Partial<AutopilotPolicy> = {}) {
  harness.send({
    type: 'settings.change',
    patch: { autopilot: { enabled: true, autoMerge: 'off', ...policy } },
  });
}

function reachReview(harness: Harness, ratings = HIGH_LOW) {
  const taskId = createTask(harness);
  buildAll(harness, taskId);
  harness.send({ type: 'checks.record', taskId, results: PASSING });
  harness.send({
    type: 'agent.report_review',
    ratings,
    runId: harness.activeRun(taskId).id,
    summary: null,
    findings: [],
  });
  return taskId;
}

function judgedGate(harness: Harness, taskId: string) {
  return listOpenGates(harness.state, taskId).find((gate) => gate.autopilotJudging === true);
}

function judge(harness: Harness, taskId: string, reason: string, verdict: 'act' | 'forward' = 'act') {
  const gate = judgedGate(harness, taskId);
  if (!gate) throw new Error('No gate waits for Autopilot.');
  harness.send({
    type: 'autopilot.judgment',
    taskId,
    gateId: gate.id,
    verdict,
    reason,
    reply: null,
    shadow: false,
  });
}

function reachMergeAfterAutopilot(harness: Harness) {
  const taskId = reachReview(harness);
  judge(harness, taskId, 'Small and clear.');
  pushed(harness, taskId);
  harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
  return taskId;
}

function answer(
  harness: Harness,
  taskId: string,
  decision: 'approve' | 'revise' | 'reject' | 'reply',
  response: string | null = null,
  options: Parameters<Harness['send']>[1] = {}
) {
  const gate = harness.openGate(taskId);
  harness.send({ type: 'gate.answer', gateId: gate.id, decision, response }, options);
}

function lessons(harness: Harness) {
  return harness.state.autopilotLessons;
}

describe('what Autopilot learns from your answers', () => {
  test('a review it brought you that you approve as it was says it could have acted', () => {
    const harness = createHarness();
    enable(harness);
    const taskId = reachReview(harness, MEDIUM);
    answer(harness, taskId, 'approve');
    expect(lessons(harness)).toEqual([
      {
        id: expect.any(String),
        at: harness.now,
        taskId,
        gateId: expect.any(String),
        gate: 'review',
        kind: 'forwarded',
        answer: 'approved',
        reason: 'The reviewer’s confidence is medium.',
        note: null,
        facts: {
          urgent: false,
          watchdog: false,
          confidence: 'medium',
          risk: 'low',
          scope: expect.any(Object),
        },
      },
    ]);
  });

  test('a review it approved that you send back at the merge is a correction, with your words', () => {
    const harness = createHarness();
    enable(harness);
    const taskId = reachMergeAfterAutopilot(harness);
    answer(harness, taskId, 'revise', '  Rename the helper.  ');
    expect(lessons(harness)).toEqual([
      expect.objectContaining({
        gate: 'review',
        kind: 'acted',
        answer: 'revised',
        reason: 'Small and clear.',
        note: 'Rename the helper.',
      }),
    ]);
    const reviewGate = Object.values(harness.state.gates).find(
      (gate) => gate.taskId === taskId && gate.type === 'review'
    );
    expect(reviewGate).toMatchObject({ autopilotAnswer: 'Small and clear.', autopilotLearned: true });
  });

  test('learns from each thing it did once, so a later answer on the same task adds nothing', () => {
    const harness = createHarness();
    enable(harness);
    const taskId = reachMergeAfterAutopilot(harness);
    answer(harness, taskId, 'approve');
    expect(lessons(harness)).toEqual([expect.objectContaining({ kind: 'acted', answer: 'approved' })]);
    expect(listAutopilotLessons(harness.state)).toHaveLength(1);
  });

  test('a guest’s answer teaches it nothing', () => {
    const harness = createHarness();
    enable(harness);
    const taskId = reachReview(harness, MEDIUM);
    answer(harness, taskId, 'approve', null, {
      guest: { id: 'kai', login: 'kai', name: null, avatarUrl: null, scope: { kind: 'task', taskId } },
    });
    expect(lessons(harness)).toEqual([]);
  });

  test('a question it was not sure about keeps your answer as what it learned', () => {
    const harness = createHarness();
    enable(harness);
    const taskId = createTask(harness);
    const runId = harness.activeRun(taskId).id;
    harness.send({
      type: 'agent.ask',
      runId,
      gateId: 'q1',
      question: 'Which name?',
      context: null,
      choices: ['a', 'b'],
    });
    judge(harness, taskId, 'Needs your taste.', 'forward');
    answer(harness, taskId, 'reply', 'Use b.');
    expect(lessons(harness)).toEqual([
      expect.objectContaining({ gate: 'question', kind: 'forwarded', answer: 'replied', note: 'Use b.' }),
    ]);
  });

  test('keeps only the last lessons', () => {
    const harness = createHarness();
    enable(harness);
    for (let index = 0; index <= AUTOPILOT_LESSON_LIMITS.kept; index += 1)
      answer(harness, reachReview(harness, MEDIUM), 'approve');
    expect(lessons(harness)).toHaveLength(AUTOPILOT_LESSON_LIMITS.kept);
  });
});

describe('what Autopilot learns from a plan it approved', () => {
  test('approving the review later says the plan was fine, and an Auto merge setting teaches nothing', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { approvePlans: 'always' } });
    enable(harness, { gates: ['plans', 'questions'] });
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    judge(harness, taskId, 'Two small phases.');
    refreshWorktree(harness, taskId);
    const phases = harness.task(taskId).plan?.document?.phases.length ?? 1;
    for (let index = 0; index < phases; index += 1) completePhase(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    harness.send({
      type: 'agent.report_review',
      ratings: HIGH_LOW,
      runId: harness.activeRun(taskId).id,
      summary: null,
      findings: [],
    });
    expect(harness.openGate(taskId)).toMatchObject({ type: 'review', autopilotTeaches: false });
    answer(harness, taskId, 'approve');
    expect(lessons(harness)).toEqual([
      expect.objectContaining({
        gate: 'plan',
        kind: 'acted',
        answer: 'approved',
        reason: 'Two small phases.',
      }),
    ]);
  });
});

describe('what Autopilot learns when it did more than one thing', () => {
  test('sending back the merge corrects the review it approved, not the plan, and the plan is confirmed by the later approve', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { approvePlans: 'always' } });
    enable(harness);
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    judge(harness, taskId, 'Two small phases.');
    refreshWorktree(harness, taskId);
    const phases = harness.task(taskId).plan?.document?.phases.length ?? 1;
    for (let index = 0; index < phases; index += 1) completePhase(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    harness.send({
      type: 'agent.report_review',
      ratings: HIGH_LOW,
      runId: harness.activeRun(taskId).id,
      summary: null,
      findings: [],
    });
    harness.advance(MINUTE_MS);
    judge(harness, taskId, 'Clean review.');
    pushed(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    answer(harness, taskId, 'revise', 'Not like this.');
    expect(lessons(harness).map((found) => [found.gate, found.kind, found.answer])).toEqual([
      ['review', 'acted', 'revised'],
    ]);
    expect(resolveLessonLimit(harness.state, 'plan')).toEqual({ allowed: true });
  });
});

describe('what Autopilot does with what it learned', () => {
  test('brings reviews to you after you changed what it approved twice of the last four', () => {
    const harness = createHarness();
    enable(harness);
    answer(harness, reachMergeAfterAutopilot(harness), 'revise', 'No.');
    expect(resolveLessonLimit(harness.state, 'review')).toEqual({ allowed: true });
    answer(harness, reachMergeAfterAutopilot(harness), 'reject');
    const paused =
      'You changed what Autopilot did at your last few reviews, so it brings them to you for now.';
    expect(resolveLessonLimit(harness.state, 'review')).toEqual({
      allowed: false,
      reason: paused,
      setting: false,
    });
    expect(resolveLessonLimit(harness.state, 'plan')).toEqual({ allowed: true });
    const taskId = reachReview(harness);
    expect(harness.openGate(taskId)).toMatchObject({ type: 'review', autopilotHeld: paused });
    expect(judgedGate(harness, taskId)).toBeUndefined();
    answer(harness, taskId, 'approve');
    answer(harness, reachReview(harness, MEDIUM), 'approve');
    answer(harness, reachReview(harness, MEDIUM), 'approve');
    expect(resolveLessonLimit(harness.state, 'review')).toEqual({ allowed: true });
    expect(judgedGate(harness, reachReview(harness))).toBeDefined();
  });

  test('tells the judge what you taught it at the same kind of gate, most recent first', () => {
    const harness = createHarness();
    enable(harness);
    answer(harness, reachMergeAfterAutopilot(harness), 'revise', 'Rename it.');
    answer(harness, reachReview(harness, MEDIUM), 'approve');
    const taskId = reachReview(harness);
    const gate = judgedGate(harness, taskId);
    const request = Option.getOrNull(selectAutopilotJudgeRequest(harness.state, gate?.id ?? '', harness.now));
    const prompt = request?.prompt ?? '';
    expect(prompt).toContain('What the developer taught you at earlier ones, most recent first:');
    const first = prompt.indexOf('You brought a review to them');
    const second = prompt.indexOf('You approved a review for them');
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expect(prompt).toContain('they asked for changes later: “Rename it.”');
    expect(request?.system).toContain('Weigh what the developer taught you');
  });
});

function lesson(overrides: Partial<AutopilotLesson>): AutopilotLesson {
  return {
    id: 'l',
    at: 0,
    taskId: 't',
    gateId: 'g',
    gate: 'plan',
    kind: 'acted',
    answer: 'approved',
    reason: 'Small.',
    note: null,
    facts: { urgent: false, watchdog: false, confidence: null, risk: null, scope: null },
    ...overrides,
  };
}

describe('describing a lesson', () => {
  test.each([
    [lesson({}), 'You approved a plan for them; they went along with it.'],
    [
      lesson({ gate: 'merge', answer: 'rejected' }),
      'You merged a change for them; they rejected the task later.',
    ],
    [
      lesson({ gate: 'question', answer: 'replied' }),
      'You answered an agent’s question for them; they replied later.',
    ],
    [
      lesson({ gate: 'merge', kind: 'forwarded', answer: 'revised', note: 'Wait.' }),
      'You brought a merge to them; they asked for changes: “Wait.”.',
    ],
    [lesson({ kind: 'forwarded', answer: 'rejected' }), 'You brought a plan to them; they rejected it.'],
    [
      lesson({
        gate: 'review',
        facts: {
          urgent: true,
          watchdog: true,
          confidence: 'high',
          risk: 'medium',
          scope: { phases: 2, files: 3 },
        },
      }),
      'You approved a review for them (risk medium, confidence high, 2 phases, 3 files, urgent, filed by a watchdog); they went along with it.',
    ],
  ])('%#', (given, text) => {
    expect(describeAutopilotLesson(given)).toBe(text);
  });

  test('cuts a long note to its budget', () => {
    const harness = createHarness();
    enable(harness);
    answer(harness, reachReview(harness, MEDIUM), 'revise', 'x'.repeat(400));
    expect(lessons(harness)[0]?.note).toHaveLength(AUTOPILOT_LESSON_LIMITS.note);
    expect(lessons(harness)[0]?.note?.endsWith('…')).toBe(true);
  });
});

describe('the summary of what it learned', () => {
  test('counts what it did and you kept or changed, and what it brought you that it could have done', () => {
    const state = {
      autopilotLessons: [
        lesson({ gate: 'review', answer: 'revised' }),
        lesson({ gate: 'review' }),
        lesson({ gate: 'review', kind: 'forwarded' }),
        lesson({ gate: 'review', kind: 'forwarded', answer: 'revised' }),
        lesson({ gate: 'plan', answer: 'rejected', id: 'p1' }),
        lesson({ gate: 'plan', answer: 'revised', id: 'p2' }),
      ],
    };
    const summary = resolveAutopilotLessonSummary(state);
    expect(summary.gates).toEqual([
      { gate: 'plan', acted: 2, kept: 0, corrected: 2, forwarded: 0, couldHaveActed: 0, paused: true },
      { gate: 'question', acted: 0, kept: 0, corrected: 0, forwarded: 0, couldHaveActed: 0, paused: false },
      { gate: 'review', acted: 2, kept: 1, corrected: 1, forwarded: 2, couldHaveActed: 1, paused: false },
      { gate: 'merge', acted: 0, kept: 0, corrected: 0, forwarded: 0, couldHaveActed: 0, paused: false },
    ]);
    expect(summary.recent.map((found) => found.id)).toEqual(['p2', 'p1', 'l', 'l', 'l']);
  });

  test('is empty before you answered anything', () => {
    expect(resolveAutopilotLessonSummary({ autopilotLessons: [] }).recent).toEqual([]);
  });
});
