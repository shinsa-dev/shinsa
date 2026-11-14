import { describe, expect, test } from 'bun:test';
import { createAutopilotDecision, listGateDecisionDrafts } from '../../src/autopilot/profile.ts';
import {
  AUTOPILOT_PROFILE_LIMITS,
  type AutopilotDecision,
  DAY_MS,
  EMPTY_AUTOPILOT_PROFILE,
  HOUR_MS,
  MINUTE_MS,
  listAutopilotKindLines,
  listAutopilotSteeringLines,
  listAutopilotTallies,
  type ReviewFinding,
  type ReviewRatings,
  recordAutopilotDecisions,
} from '../../src/index.ts';
import { buildAll, createHarness, createTask, type Harness, PASSING, proposePlan } from '../harness.ts';

const NO_CONTEXT = { projectId: null, risk: null };

const HIGH_LOW: ReviewRatings = { confidence: 'high', risk: 'low' };

const OPTIONAL: ReviewFinding = { severity: 'optional', file: 'a.ts', line: 3, message: 'Rename it.' };

const SHOULD_FIX: ReviewFinding = { severity: 'should_fix', file: 'b.ts', line: 7, message: 'Name it.' };

function reachReview(harness: Harness, findings: ReviewFinding[] = []) {
  const taskId = createTask(harness);
  buildAll(harness, taskId);
  harness.send({ type: 'checks.record', taskId, results: PASSING });
  harness.send({
    type: 'agent.report_review',
    ratings: HIGH_LOW,
    runId: harness.activeRun(taskId).id,
    summary: null,
    findings,
  });
  return taskId;
}

function decisions(harness: Harness) {
  return harness.state.autopilotProfile.decisions.filter((entry) => entry.kind !== 'request');
}

function decision(overrides: Partial<AutopilotDecision>): AutopilotDecision {
  return {
    at: 1,
    taskId: 't',
    gateId: null,
    kind: 'review',
    answer: 'approved',
    projectId: null,
    risk: null,
    scope: null,
    urgent: false,
    watchdog: false,
    touched: false,
    guess: null,
    followUp: null,
    note: null,
    facts: null,
    estimate: null,
    ...overrides,
  };
}

describe('the decisions Autopilot learns from', () => {
  test('a review you approve is learned with Autopilot off, with its risk and scope', () => {
    const harness = createHarness();
    const taskId = reachReview(harness);
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'approve',
      response: null,
    });
    expect(decisions(harness)).toEqual([
      expect.objectContaining({
        taskId,
        kind: 'review',
        answer: 'approved',
        risk: 'low',
        urgent: false,
        watchdog: false,
        touched: false,
        note: null,
      }),
    ]);
    expect(decisions(harness)[0]?.scope).toEqual({ phases: expect.any(Number), files: expect.any(Number) });
    expect(harness.state.autopilotProfile.total).toBe(2);
  });

  test('a decided gate keeps what the gate knew: the ratings, findings, plan, wait, presence and your hour', () => {
    const harness = createHarness();
    harness.send({ type: 'clock.record', timeZone: 'Asia/Tokyo' });
    const taskId = reachReview(harness, [OPTIONAL, SHOULD_FIX, OPTIONAL]);
    const gate = harness.openGate(taskId);
    harness.advance(90 * MINUTE_MS);
    harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'approve', response: null });
    const tokyoHour = Math.floor(((gate.openedAt + 9 * HOUR_MS) % DAY_MS) / HOUR_MS);
    expect(decisions(harness)[0]?.facts).toEqual({
      confidence: 'high',
      shape: 'change',
      repoId: harness.task(taskId).repoId,
      revisions: 0,
      findings: { blocking: 0, shouldFix: 1, optional: 2 },
      heldPlan: false,
      waitedMinutes: Math.floor((harness.now - gate.openedAt) / MINUTE_MS),
      active: gate.autopilotOpened?.active ?? false,
      inHours: null,
      hour: tokyoHour,
    });
    expect(decisions(harness)[0]?.facts?.waitedMinutes).toBeGreaterThanOrEqual(90);
  });

  test('presence and the hour are read when the gate opened, as Autopilot sees them, not when you answered', () => {
    const harness = createHarness();
    const taskId = reachReview(harness, []);
    const gate = harness.openGate(taskId);
    expect(gate.autopilotOpened?.hour).toBe(Math.floor((gate.openedAt % DAY_MS) / HOUR_MS));
    const later = gate.openedAt + 5 * HOUR_MS;
    const draft = {
      task: harness.task(taskId),
      kind: 'review' as const,
      answer: 'approved' as const,
      note: null,
    };
    const answered = { ...harness.state, presence: { [Math.floor(later / HOUR_MS)]: 1 } };
    const fallback = createAutopilotDecision(
      answered,
      { ...draft, gate: { ...gate, autopilotOpened: undefined } },
      later
    );
    expect(fallback.facts).toMatchObject({ active: false, hour: gate.autopilotOpened?.hour });
    const opened = { active: true, inHours: false, hour: 3 };
    const stored = createAutopilotDecision(
      answered,
      { ...draft, gate: { ...gate, autopilotOpened: opened } },
      later
    );
    expect(stored.facts).toMatchObject(opened);
  });

  test('a plan you revised counts its revisions, and a decision with no gate has no wait', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { approvePlans: 'always' } });
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'revise',
      response: 'Smaller.',
    });
    proposePlan(harness, taskId);
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'approve',
      response: null,
    });
    harness.send({ type: 'task.message', taskId, text: 'Thanks.' });
    const [first, second, message] = decisions(harness);
    expect([first?.facts?.revisions, second?.facts?.revisions]).toEqual([0, 1]);
    expect(second?.facts?.hour).toBe(Math.floor((harness.now % DAY_MS) / HOUR_MS));
    expect(message?.kind).toBe('message');
    expect(message?.facts?.waitedMinutes).toBeNull();
  });

  test('each finding you decide is learned beside the review answer', () => {
    const harness = createHarness();
    const taskId = reachReview(harness, [OPTIONAL, OPTIONAL]);
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'revise',
      response: 'Fix the first.',
      verdicts: [
        { index: 0, verdict: 'fix', note: null },
        { index: 1, verdict: 'dismiss', note: '  Intended.  ' },
      ],
    });
    expect(decisions(harness).map(({ kind, answer, note }) => [kind, answer, note])).toEqual([
      ['review', 'revised', 'Fix the first.'],
      ['finding', 'fixed', null],
      ['finding', 'dismissed', 'Intended.'],
    ]);
  });

  test('a suggested task you accept or dismiss is learned, but not one an agent settles for you', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({
      type: 'agent.suggest_tasks',
      runId: harness.activeRun(taskId).id,
      suggestions: ['Cache it', 'Retry it', 'Log it'].map((title) => ({
        title,
        request: `${title}, please.`,
        why: 'It came up.',
        waitsOnThis: false,
      })),
    });
    const [first, second, third] = harness.task(taskId).suggestions ?? [];
    harness.send({ type: 'suggestion.accept', taskId, suggestionId: first?.id ?? '', waitsOnThis: false });
    harness.send({ type: 'suggestion.dismiss', taskId, suggestionId: second?.id ?? '' });
    harness.send({ type: 'suggestion.dismiss', taskId, suggestionId: third?.id ?? '' }, { onBehalf: true });
    expect(decisions(harness).map(({ kind, answer, note, gateId }) => [kind, answer, note, gateId])).toEqual([
      ['suggestion', 'accepted', 'Cache it', null],
      ['suggestion', 'dismissed', 'Retry it', null],
    ]);
  });
});

describe('the failures you decide', () => {
  function pausedGate(harness: Harness) {
    const taskId = createTask(harness);
    harness.send({ type: 'task.pause', taskId });
    return { taskId, gate: harness.openGate(taskId) };
  }

  test('a failure you paused yourself teaches nothing, since resuming it is never a judgment', () => {
    const harness = createHarness();
    const { gate } = pausedGate(harness);
    expect(gate).toMatchObject({ type: 'failure', cause: 'paused' });
    harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'approve', response: null });
    expect(decisions(harness)).toEqual([]);
  });

  test('a failed step is learned as retried, retried with guidance or cancelled', () => {
    const harness = createHarness();
    const { taskId, gate } = pausedGate(harness);
    const task = harness.task(taskId);
    const failed = { ...gate, cause: undefined };
    const drafts = (['approve', 'reply', 'reject'] as const).map((answer) =>
      listGateDecisionDrafts(task, { gate: failed, decision: answer, response: 'Try the other port.' })
    );
    expect(drafts.map((found) => found.map(({ kind, answer }) => [kind, answer]))).toEqual([
      [['failure', 'approved']],
      [['failure', 'replied']],
      [['failure', 'rejected']],
    ]);
    const monitored = listGateDecisionDrafts(task, {
      gate: { ...gate, cause: 'monitor' },
      decision: 'approve',
      response: null,
    });
    expect(monitored.map(({ kind }) => kind)).toEqual(['failure']);
    for (const cause of ['budget', 'owner_account', 'github_sso'] as const)
      expect(
        listGateDecisionDrafts(task, { gate: { ...gate, cause }, decision: 'approve', response: null })
      ).toEqual([]);
  });
});

describe('the other things you do in Shinsa', () => {
  test('your messages, priority changes and cancellations are learned, not ones sent for you', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.message', taskId, text: 'Keep the old copy.' });
    harness.send({ type: 'task.message', taskId, text: 'Sent for you.' }, { onBehalf: true });
    harness.send({ type: 'task.prioritize', taskId, priority: 'urgent' });
    harness.send({ type: 'task.prioritize', taskId, priority: 'urgent' });
    harness.send({ type: 'task.prioritize', taskId, priority: 'low' });
    harness.send({ type: 'task.cancel', taskId });
    expect(decisions(harness).map(({ kind, answer, note }) => [kind, answer, note])).toEqual([
      ['message', 'sent', 'Keep the old copy.'],
      ['priority', 'raised', 'urgent'],
      ['priority', 'lowered', 'low'],
      ['cancel', 'cancelled', null],
    ]);
  });

  test('the tasks you file and your own code edits are learned, not ones filed for you', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send(
      { type: 'task.create', request: 'Filed for you.', repoId: null, projectId: null },
      { onBehalf: true }
    );
    buildAll(harness, taskId);
    harness.send({ type: 'task.record_edit', taskId, path: 'src/a.ts', changed: true });
    harness.send({ type: 'task.record_edit', taskId, path: 'src/a.ts', changed: true });
    harness.send({ type: 'task.record_edit', taskId, path: 'src/a.ts', changed: false });
    const learned = harness.state.autopilotProfile.decisions.map(({ kind, answer, note }) => [
      kind,
      answer,
      note,
    ]);
    expect(learned).toEqual([
      ['request', 'filed', harness.task(taskId).request],
      ['edit', 'edited', 'src/a.ts'],
    ]);
  });
});

describe('the profile', () => {
  test('counts every decision overall, per project and per risk, past the words it keeps', () => {
    const many = Array.from({ length: AUTOPILOT_PROFILE_LIMITS.words + 5 }, (_, index) =>
      decision({ at: index, projectId: 'p1', risk: 'low', answer: index % 2 ? 'revised' : 'approved' })
    );
    const profile = recordAutopilotDecisions(undefined, many);
    expect(profile.total).toBe(AUTOPILOT_PROFILE_LIMITS.words + 5);
    expect(profile.decisions).toHaveLength(AUTOPILOT_PROFILE_LIMITS.words);
    expect(profile.decisions[0]?.at).toBe(5);
    const tallies = listAutopilotTallies({ autopilotProfile: profile }, 'review');
    expect(tallies.map(({ key, total, answers }) => [key, total, answers])).toEqual([
      ['review||', 205, { approved: 103, revised: 102 }],
      ['review|p1|', 205, { approved: 103, revised: 102 }],
      ['review||low', 205, { approved: 103, revised: 102 }],
    ]);
    expect(tallies[0]?.at).toBe(204);
    expect(listAutopilotTallies({ autopilotProfile: profile }, 'plan')).toEqual([]);
  });

  test('a decision with no project or risk only counts toward its kind', () => {
    const profile = recordAutopilotDecisions(EMPTY_AUTOPILOT_PROFILE, [decision({ kind: 'proposal' })]);
    expect(profile.tallies.map((tally) => tally.key)).toEqual(['proposal||']);
  });

  test('keeps a tally for every project, however many there are', () => {
    const spread = Array.from({ length: 500 }, (_, index) =>
      decision({ kind: 'plan', projectId: `p${index}` })
    );
    const profile = recordAutopilotDecisions(undefined, spread);
    expect(profile.tallies).toHaveLength(501);
  });

  test('weighs recent decisions more: one from a month ago counts half', () => {
    const month = AUTOPILOT_PROFILE_LIMITS.halfLifeDays * DAY_MS;
    const profile = recordAutopilotDecisions(undefined, [
      decision({ at: 0, answer: 'revised' }),
      decision({ at: 0, answer: 'revised' }),
      decision({ at: month, answer: 'approved' }),
    ]);
    const [tally] = listAutopilotTallies({ autopilotProfile: profile }, 'review');
    expect(tally?.answers).toEqual({ revised: 2, approved: 1 });
    expect(tally?.recent.revised).toBeCloseTo(1);
    expect(tally?.recent.approved).toBe(1);
    expect(recordAutopilotDecisions(profile, [decision({ at: 0, answer: 'approved' })]).tallies[0]?.at).toBe(
      month
    );
  });
});

describe('the profile summary for a judgment', () => {
  const profile = (learned: AutopilotDecision[]) => ({
    autopilotProfile: recordAutopilotDecisions(undefined, learned),
  });

  test('is empty until you decided that kind of point', () => {
    expect(
      listAutopilotKindLines({ autopilotProfile: EMPTY_AUTOPILOT_PROFILE }, ['plan'], NO_CONTEXT)
    ).toEqual([]);
    const state = profile([decision({ kind: 'merge' })]);
    expect(listAutopilotKindLines(state, ['plan'], NO_CONTEXT)).toEqual([]);
    expect(listAutopilotSteeringLines(state, NO_CONTEXT)).toEqual([]);
  });

  test('counts each kind overall, in this project and at this risk, then your recent words', () => {
    const state = profile([
      decision({ kind: 'review', answer: 'approved', projectId: 'p1', risk: 'low', note: 'first' }),
      decision({ kind: 'review', answer: 'revised', projectId: 'p2', risk: 'high', note: 'second' }),
      decision({ kind: 'finding', answer: 'dismissed', projectId: 'p1', risk: 'low', note: 'third' }),
      decision({ kind: 'finding', answer: 'fixed', projectId: 'p1', risk: 'low', note: 'fourth' }),
      decision({ kind: 'merge', answer: 'approved', note: 'not a review' }),
    ]);
    expect(listAutopilotKindLines(state, ['review', 'finding'], { projectId: 'p1', risk: 'low' })).toEqual([
      '- All reviews: 2 decided: approved 1, revised 1; lately approved 50%, revised 50%',
      '- In this project: 1 decided: approved 1; lately approved 100%',
      '- At low risk: 1 decided: approved 1; lately approved 100%',
      '- All review findings: 2 decided: fixed 1, dismissed 1; lately fixed 50%, dismissed 50%',
      '- In this project: 2 decided: fixed 1, dismissed 1; lately fixed 50%, dismissed 50%',
      '- At low risk: 2 decided: fixed 1, dismissed 1; lately fixed 50%, dismissed 50%',
      'Their recent words:',
      '- review findings, fixed: “fourth”',
      '- review findings, dismissed: “third”',
      '- reviews, revised: “second”',
    ]);
  });

  test('says how you steer and file your tasks', () => {
    const state = profile([
      decision({ kind: 'plan', answer: 'approved' }),
      decision({ kind: 'message', answer: 'sent', note: 'Keep it small.' }),
      decision({ kind: 'edit', answer: 'edited' }),
      decision({ kind: 'request', answer: 'filed' }),
      decision({ kind: 'priority', answer: 'raised' }),
      decision({ kind: 'cancel', answer: 'cancelled' }),
    ]);
    expect(listAutopilotSteeringLines(state, NO_CONTEXT)).toEqual([
      'How they steer their tasks:',
      '- All messages to agents: 1 decided: sent 1; lately sent 100%',
      '- All their own code edits: 1 decided: edited 1; lately edited 100%',
      '- All tasks they filed: 1 decided: filed 1; lately filed 100%',
      '- All priority changes: 1 decided: raised 1; lately raised 100%',
      '- All cancelled tasks: 1 decided: cancelled 1; lately cancelled 100%',
      'Their recent words:',
      '- messages to agents, sent: “Keep it small.”',
    ]);
  });

  test('leaves out a project or risk you never decided at, and words when there are none', () => {
    const state = profile([decision({ kind: 'plan', answer: 'approved', projectId: 'p1', risk: 'low' })]);
    expect(listAutopilotKindLines(state, ['plan'], { projectId: 'p9', risk: 'high' })).toEqual([
      '- All plans: 1 decided: approved 1; lately approved 100%',
    ]);
  });

  test('stays inside its budget', () => {
    const long = 'x'.repeat(AUTOPILOT_PROFILE_LIMITS.summary / 2);
    const state = profile(
      Array.from({ length: 6 }, () => decision({ kind: 'question', answer: 'replied', note: long }))
    );
    const lines = listAutopilotKindLines(state, ['question'], NO_CONTEXT);
    expect(lines.join('\n').length).toBeLessThanOrEqual(AUTOPILOT_PROFILE_LIMITS.summary);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('- All agent questions: 6 decided: replied 6; lately replied 100%');
  });
});
