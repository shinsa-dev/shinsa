import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
import { createAutopilotDecision, listGateDecisionDrafts } from '../../src/autopilot/profile.ts';
import {
  type AutopilotAgreement,
  type AutopilotModel,
  type AutopilotModelHead,
  type AutopilotPolicy,
  type AutopilotProfile,
  type AutopilotReadinessKind,
  type AutopilotVerdict,
  createAutopilotModel,
  describeAutopilotFindingCall,
  learnAutopilotDecisions,
  EMPTY_AUTOPILOT_PROFILE,
  listAutopilotDone,
  type ReviewFinding,
  type ReviewRatings,
  selectAutopilotFindingCall,
  selectAutopilotJudgeRequest,
} from '../../src/index.ts';
import { listOpenGates } from '../../src/state/queries.ts';
import {
  buildAll,
  createHarness,
  createTask,
  fireRetry,
  type Harness,
  PASSING,
  spendRetries,
} from '../harness.ts';

const AGREEING: AutopilotAgreement = {
  scored: 120,
  agreed: 114,
  weight: 120,
  agreedWeight: 114,
  baseWeight: 90,
  loss: 10,
};

function readyProfile(kinds: readonly AutopilotReadinessKind[]): AutopilotProfile {
  const ready = Object.fromEntries(
    kinds.map((kind) => [
      kind,
      {
        tracks: { ...EMPTY_AUTOPILOT_PROFILE.tracks, combined: AGREEING, model: AGREEING },
        rate: { positive: 90, negative: 30 },
      },
    ])
  );
  return { ...EMPTY_AUTOPILOT_PROFILE, kinds: ready };
}

function knownModel(head: AutopilotModelHead, kind: string, p: number): AutopilotModel {
  const model = createAutopilotModel();
  const weights = model.heads[head].weights.map((weight, index) =>
    index === 0 ? Math.log(p / (1 - p)) : weight
  );
  return {
    heads: { ...model.heads, [head]: { seen: 200, weights } },
    segments: { [`${head}|${kind}||`]: { positive: 500, negative: 500 } },
  };
}

function everything(kinds: readonly AutopilotReadinessKind[], policy: Partial<AutopilotPolicy> = {}) {
  const harness = createHarness();
  harness.send({
    type: 'settings.change',
    patch: { autopilot: { enabled: true, level: 'everything', autoMerge: 'approved', ...policy } },
  });
  harness.state.autopilotProfile = readyProfile(kinds);
  return harness;
}

function breakTask(harness: Harness, taskId: string) {
  return harness.send({
    type: 'effect.fail',
    taskId,
    title: 'Could not set up the worktree',
    detail: 'disk',
  });
}

function failTask(harness: Harness) {
  const taskId = createTask(harness);
  breakTask(harness, taskId);
  fireRetry(harness, taskId);
  spendRetries(harness, taskId);
  breakTask(harness, taskId);
  return taskId;
}

function failureGate(harness: Harness, taskId: string) {
  return Object.values(harness.state.gates).find((gate) => gate.taskId === taskId && gate.type === 'failure');
}

function judge(
  harness: Harness,
  taskId: string,
  verdict: AutopilotVerdict,
  reason: string,
  reply: string | null = null,
  shadow = false
) {
  const gate = shadow
    ? listOpenGates(harness.state, taskId)[0]
    : listOpenGates(harness.state, taskId).find((open) => open.autopilotJudging === true);
  if (!gate) throw new Error('No gate waits for Autopilot.');
  return harness.send({
    type: 'autopilot.judgment',
    taskId,
    gateId: gate.id,
    verdict,
    reason,
    reply,
    shadow,
  });
}

const HIGH_HIGH: ReviewRatings = { confidence: 'high', risk: 'high' };

const OPTIONAL: ReviewFinding = { severity: 'optional', file: 'b.ts', line: 7, message: 'Rename it.' };

const SHOULD_FIX: ReviewFinding = {
  severity: 'should_fix',
  file: 'a.ts',
  line: 3,
  message: 'Handle the error.',
};

function reachReview(harness: Harness, findings: ReviewFinding[], ratings = HIGH_HIGH) {
  const taskId = createTask(harness);
  buildAll(harness, taskId);
  harness.send({ type: 'checks.record', taskId, results: PASSING });
  harness.send({
    type: 'agent.report_review',
    ratings,
    runId: harness.activeRun(taskId).id,
    summary: null,
    findings,
  });
  return taskId;
}

function reviewGate(harness: Harness, taskId: string) {
  return Object.values(harness.state.gates).find((gate) => gate.taskId === taskId && gate.type === 'review');
}

describe('Autopilot at a failed step', () => {
  test('below Everything, brings the failure to you and guesses what you will do', () => {
    const harness = everything(['failure'], { level: 'most' });
    const taskId = failTask(harness);
    expect(failureGate(harness, taskId)).toMatchObject({
      status: 'open',
      autopilotHeld: 'Below Everything, failed steps wait for you.',
      autopilotTeaches: false,
    });
    expect(harness.effectsOf('autopilot.judge').at(-1)).toMatchObject({ shadow: true });
    judge(harness, taskId, 'cancel', 'They would drop it.', null, true);
    expect(failureGate(harness, taskId)?.autopilotGuess).toBe('cancel');
  });

  test('at Everything, a kind that is not ready yet acts as Most things', () => {
    const harness = everything(['plan']);
    const taskId = failTask(harness);
    expect(failureGate(harness, taskId)).toMatchObject({
      status: 'open',
      autopilotHeld: 'Below Everything, failed steps wait for you.',
    });
  });

  test('once failures are ready, retries the step with the guidance it wrote, and says so', () => {
    const harness = everything(['failure']);
    const taskId = failTask(harness);
    const gate = failureGate(harness, taskId);
    expect(gate?.autopilotJudging).toBe(true);
    const request = selectAutopilotJudgeRequest(harness.state, gate?.id ?? '', harness.now);
    expect(request).toMatchObject({
      value: { verdicts: ['act', 'cancel', 'forward'] },
    });
    judge(harness, taskId, 'act', 'A full disk clears on its own.', 'Use the scratch disk.');
    expect(failureGate(harness, taskId)).toMatchObject({
      status: 'answered',
      decision: 'reply',
      response: 'Use the scratch disk.',
      autopilotAnswer: 'A full disk clears on its own.',
    });
    expect(harness.activeRun(taskId).prompt).toContain('Use the scratch disk.');
    expect(harness.task(taskId).activity.at(-1)?.text).not.toBe('');
    expect(harness.task(taskId).activity.map((entry) => entry.text)).toContain(
      'Retried for you by Autopilot: Could not set up the worktree'
    );
    expect(listAutopilotDone(harness.state)[0]).toMatchObject({ gate: 'failure', action: 'retried' });
  });

  test('retries a task once per round, then brings the next failure to you', () => {
    const harness = everything(['failure']);
    const taskId = failTask(harness);
    judge(harness, taskId, 'act', 'A full disk clears on its own.');
    expect(harness.task(taskId).autoRetry).toBeNull();
    breakTask(harness, taskId);
    fireRetry(harness, taskId);
    spendRetries(harness, taskId);
    breakTask(harness, taskId);
    const gates = Object.values(harness.state.gates).filter(
      (gate) => gate.taskId === taskId && gate.type === 'failure'
    );
    expect(gates).toHaveLength(2);
    expect(gates[1]).toMatchObject({
      status: 'open',
      autopilotHeld: 'Autopilot already retried this task once and it failed again.',
    });
    expect(gates[1]?.autopilotJudging).not.toBe(true);
  });

  test('retries without guidance when it wrote none', () => {
    const harness = everything(['failure']);
    const taskId = failTask(harness);
    judge(harness, taskId, 'act', '');
    expect(failureGate(harness, taskId)).toMatchObject({
      decision: 'approve',
      response: null,
      autopilotAnswer: 'Autopilot judged it clear and small enough to do for you.',
    });
  });

  test('cancels the task when it judges you would drop it', () => {
    const harness = everything(['failure']);
    const taskId = failTask(harness);
    judge(harness, taskId, 'cancel', '');
    expect(failureGate(harness, taskId)).toMatchObject({
      decision: 'reject',
      autopilotAnswer: 'Autopilot judged you would drop this task after the failure.',
      autopilotGuess: 'cancel',
    });
    expect(harness.task(taskId).stage).toBe('cancelled');
    expect(harness.task(taskId).activity.map((entry) => entry.text)).toContain(
      'Cancelled for you by Autopilot: Could not set up the worktree'
    );
    expect(listAutopilotDone(harness.state)[0]).toMatchObject({ action: 'cancelled' });
  });

  test('does not cancel when your model says you would retry', () => {
    const harness = everything(['failure']);
    harness.state.autopilotModel = knownModel('gate', 'failure', 0.8);
    const taskId = failTask(harness);
    judge(harness, taskId, 'cancel', 'Drop it.');
    expect(failureGate(harness, taskId)).toMatchObject({ status: 'open' });
    expect(failureGate(harness, taskId)?.autopilotHeld).toStartWith(
      'From 1000 decisions like this one, Autopilot puts the chance you would retry it at 80%'
    );
    expect(harness.task(taskId).stage).not.toBe('cancelled');
  });

  test('never judges a failure you caused or one about spending', () => {
    const harness = everything(['failure']);
    const taskId = createTask(harness);
    harness.send({ type: 'task.pause', taskId });
    expect(failureGate(harness, taskId)).toMatchObject({ cause: 'paused', status: 'open' });
    expect(failureGate(harness, taskId)?.autopilotHeld).toBeUndefined();
    expect(failureGate(harness, taskId)?.autopilotJudging).toBeUndefined();
  });

  test('a cancel on any other gate is read as bringing it to you', () => {
    const harness = everything(['review']);
    const taskId = reachReview(harness, []);
    const gate = reviewGate(harness, taskId);
    expect(gate?.autopilotJudging).toBe(true);
    judge(harness, taskId, 'cancel', 'No.');
    expect(harness.state.gates[gate?.id ?? '']).toMatchObject({ status: 'open', autopilotGuess: 'forward' });
    expect(harness.task(taskId).stage).not.toBe('cancelled');
  });
});

describe('Autopilot at a review at Everything', () => {
  test('approves a high risk change once reviews are ready', () => {
    const harness = everything(['review']);
    const taskId = reachReview(harness, []);
    judge(harness, taskId, 'act', 'Clear.');
    expect(reviewGate(harness, taskId)).toMatchObject({ status: 'answered', decision: 'approve' });
  });

  test('keeps a high risk change for you while reviews are not ready', () => {
    const harness = everything(['plan']);
    const taskId = reachReview(harness, []);
    const reason = 'The risk is high, above what Autopilot does on its own.';
    expect(reviewGate(harness, taskId)).toMatchObject({ status: 'open', autopilotFollowUpOnly: reason });
    judge(harness, taskId, 'act', 'Clear.');
    expect(reviewGate(harness, taskId)).toMatchObject({ status: 'open', autopilotHeld: reason });
  });

  test('dismisses the open findings when your model says you would', () => {
    const harness = everything(['review', 'finding']);
    harness.state.autopilotModel = knownModel('finding', 'finding', 0.2);
    const taskId = reachReview(harness, [OPTIONAL]);
    judge(harness, taskId, 'act', 'Clear.');
    expect(reviewGate(harness, taskId)).toMatchObject({
      status: 'answered',
      decision: 'approve',
      verdicts: [{ index: 0, verdict: 'dismiss', note: null }],
      autopilotAnswer:
        'Clear. Autopilot dismissed the finding: from 1000 findings like it, it puts the chance you fix it at 20%.',
    });
    expect(harness.task(taskId).findings[0]?.verdict).toBe('dismiss');
    expect(harness.task(taskId).autopiloted).toBeTruthy();
  });

  test('sends the open findings back to fix when your model says you would fix them', () => {
    const harness = everything(['review', 'finding']);
    harness.state.autopilotModel = knownModel('finding', 'finding', 0.9);
    const taskId = reachReview(harness, [OPTIONAL, { ...OPTIONAL, line: 9 }]);
    judge(harness, taskId, 'act', 'Clear.');
    expect(reviewGate(harness, taskId)).toMatchObject({
      status: 'answered',
      decision: 'revise',
      verdicts: [
        { index: 0, verdict: 'fix', note: null },
        { index: 1, verdict: 'fix', note: null },
      ],
    });
    expect(harness.activeRun(taskId).purpose).toBe('fix');
    expect(harness.task(taskId).autopiloted).toBeFalsy();
    expect(harness.task(taskId).activity.map((entry) => entry.text)).toContain(
      `Asked for changes for you by Autopilot: ${harness.task(taskId).title}`
    );
    expect(listAutopilotDone(harness.state)[0]).toMatchObject({ gate: 'review', action: 'revised' });
  });

  test('leaves the findings alone while findings are not ready or the model is unsure', () => {
    const unready = everything(['review']);
    unready.state.autopilotModel = knownModel('finding', 'finding', 0.9);
    const first = reachReview(unready, [OPTIONAL]);
    judge(unready, first, 'act', 'Clear.');
    expect(reviewGate(unready, first)?.verdicts).toBeUndefined();
    const unsure = everything(['review', 'finding']);
    const second = reachReview(unsure, [OPTIONAL]);
    judge(unsure, second, 'act', 'Clear.');
    expect(reviewGate(unsure, second)).toMatchObject({ decision: 'approve' });
    expect(reviewGate(unsure, second)?.verdicts).toBeUndefined();
  });
});

describe('the findings call', () => {
  test('judges only findings without a verdict, and none when every finding has one', () => {
    const harness = everything(['finding']);
    harness.state.autopilotModel = knownModel('finding', 'finding', 0.2);
    const taskId = createTask(harness);
    const gate = { ...Object.values(harness.state.gates)[0], taskId } as never;
    harness.state.tasks[taskId] = {
      ...harness.task(taskId),
      findings: [{ ...OPTIONAL, verdict: 'fix' }, OPTIONAL],
    };
    const call = selectAutopilotFindingCall(harness.state, harness.task(taskId), gate, harness.now);
    expect(call).toMatchObject({
      value: { verdict: 'dismiss', verdicts: [{ index: 1, verdict: 'dismiss' }] },
    });
    harness.state.tasks[taskId] = { ...harness.task(taskId), findings: [{ ...OPTIONAL, verdict: 'fix' }] };
    expect(selectAutopilotFindingCall(harness.state, harness.task(taskId), gate, harness.now)).toMatchObject({
      _tag: 'None',
    });
  });

  test('judges each finding on its own, from your verdicts on findings like it', () => {
    const harness = everything(['finding']);
    const taskId = createTask(harness);
    const gate = { ...Object.values(harness.state.gates)[0], taskId, type: 'review' } as never;
    const task = { ...harness.task(taskId), findings: [SHOULD_FIX, OPTIONAL] };
    const drafts = listGateDecisionDrafts(task, {
      gate,
      decision: 'revise',
      response: null,
      verdicts: [
        { index: 0, verdict: 'fix', note: null },
        { index: 1, verdict: 'dismiss', note: null },
      ],
    }).filter((draft) => draft.kind === 'finding');
    const decisions = Array.from({ length: 200 }, (_, at) =>
      drafts.map((draft) => createAutopilotDecision(harness.state, draft, harness.now + at))
    ).flat();
    harness.state.autopilotModel = learnAutopilotDecisions(undefined, decisions).model;
    harness.state.tasks[taskId] = task;
    const call = Option.getOrThrow(selectAutopilotFindingCall(harness.state, task, gate, harness.now));
    expect(call.verdict).toBe('fix');
    expect(call.verdicts).toEqual([
      { index: 0, verdict: 'fix', note: null },
      { index: 1, verdict: 'dismiss', note: null },
    ]);
    expect(describeAutopilotFindingCall(call)).toStartWith(
      'Autopilot sent 1 of the findings back to fix and dismissed 1: from your verdicts on findings like each'
    );
  });

  test('leaves every finding to you when it is unsure of any one of them', () => {
    const harness = everything(['finding']);
    harness.state.autopilotModel = knownModel('finding', 'finding', 0.2);
    const taskId = createTask(harness);
    const gate = { ...Object.values(harness.state.gates)[0], taskId } as never;
    harness.state.tasks[taskId] = {
      ...harness.task(taskId),
      projectId: null,
      findings: [OPTIONAL],
    };
    expect(selectAutopilotFindingCall(harness.state, harness.task(taskId), gate, harness.now)).toMatchObject({
      _tag: 'Some',
    });
    harness.state.autopilotModel = createAutopilotModel();
    expect(selectAutopilotFindingCall(harness.state, harness.task(taskId), gate, harness.now)).toMatchObject({
      _tag: 'None',
    });
  });

  test('says how many findings it sent back and why', () => {
    const guess = { head: 'finding' as const, p: 0.9, confidence: 0.9, similar: 12 };
    const low = { ...guess, p: 0.1 };
    expect(
      describeAutopilotFindingCall({
        verdict: 'fix',
        verdicts: [{ index: 0, verdict: 'fix', note: null }],
        guesses: [guess],
      })
    ).toBe(
      'Autopilot sent the finding back to fix: from 12 findings like it, it puts the chance you fix it at 90%.'
    );
    expect(
      describeAutopilotFindingCall({
        verdict: 'dismiss',
        verdicts: [
          { index: 0, verdict: 'dismiss', note: null },
          { index: 1, verdict: 'dismiss', note: null },
          { index: 2, verdict: 'dismiss', note: null },
        ],
        guesses: [low, low, { ...low, p: 0.2 }],
      })
    ).toBe(
      'Autopilot dismissed the 3 findings: from your verdicts on findings like each, it puts the chance you fix them at 10%, 10% and 20%.'
    );
    expect(
      describeAutopilotFindingCall({
        verdict: 'fix',
        verdicts: [
          { index: 0, verdict: 'fix', note: null },
          { index: 1, verdict: 'fix', note: null },
        ],
        guesses: [guess, guess],
      })
    ).toStartWith('Autopilot sent the 2 findings back to fix:');
  });
});
