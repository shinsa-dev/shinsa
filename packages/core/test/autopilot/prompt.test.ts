import { describe, expect, test } from 'bun:test';
import {
  AUTOPILOT_JUDGE_SYSTEM,
  AUTOPILOT_JUDGMENT_LIMITS,
  type AutopilotFacts,
  type Gate,
  resolveAutopilotJudgePrompt,
  resolveAutopilotJudgeRequest,
  resolveJudgedGateKind,
} from '../../src/index.ts';
import { createHarness, createTask, proposePlan } from '../harness.ts';

const FACTS: AutopilotFacts = {
  gate: 'question',
  urgent: false,
  watchdog: false,
  confidence: null,
  risk: null,
  scope: null,
  heldPlan: false,
  escalatedReview: false,
  approvedByYou: true,
  waitedMinutes: 0,
  presence: { inHours: null, active: true, awayMinutes: 0 },
};

function setup() {
  const harness = createHarness();
  const taskId = createTask(harness, { request: 'Fix the scroll in tab groups' });
  const gate: Gate = {
    id: 'q1',
    taskId,
    type: 'question',
    status: 'open',
    title: 'Which container scrolls?',
    body: 'Two containers scroll.',
    runId: null,
    openedAt: 0,
    answeredAt: null,
    decision: null,
    response: null,
  };
  return { task: harness.task(taskId), gate };
}

describe('the judge prompt', () => {
  test('keeps one fixed system prompt that asks for one JSON object', () => {
    expect(AUTOPILOT_JUDGE_SYSTEM).toContain('trusted employee');
    expect(AUTOPILOT_JUDGE_SYSTEM).toEndWith('Answer with one JSON object and nothing else.');
  });

  test('gives the decision, the task, the facts and the gate, with no facts it does not have', () => {
    const { task, gate } = setup();
    expect(resolveAutopilotJudgePrompt(task, gate, FACTS)).toBe(
      [
        'Decision: Answer the agent’s question',
        '',
        `Task: ${task.title}`,
        'Request: Fix the scroll in tab groups',
        '',
        'Facts:',
        '- Urgent: no',
        '- Filed by a watchdog: no',
        '- Reviewer confidence: not rated yet',
        '- Reviewer risk: not rated yet',
        '- Plan size: no plan yet',
        '- Waiting for: 0 minutes',
        '- The developer: active now',
        '',
        'Which container scrolls?',
        'Two containers scroll.',
      ].join('\n')
    );
  });

  test('says where you are and lists the choices with the agent’s recommendation', () => {
    const { task, gate } = setup();
    const facts: AutopilotFacts = {
      ...FACTS,
      gate: 'merge',
      urgent: true,
      watchdog: true,
      confidence: 'high',
      risk: 'low',
      scope: { phases: 2, files: 3 },
      waitedMinutes: 75,
      presence: { inHours: false, active: false, awayMinutes: 90 },
    };
    const prompt = resolveAutopilotJudgePrompt(
      task,
      { ...gate, choices: ['Outer', 'Inner'], recommendation: 'Inner' },
      facts
    );
    expect(prompt).toContain('Decision: Merge the pull request');
    expect(prompt).toContain('- Plan size: 2 phases, 3 files');
    expect(prompt).toContain('- The developer: away 90 minutes, outside their usual hours');
    expect(prompt).toEndWith('Choices (the agent recommends: Inner):\n- Outer\n- Inner');
    const inside = { ...facts.presence, inHours: true };
    expect(resolveAutopilotJudgePrompt(task, gate, { ...facts, presence: inside })).toContain(
      'away 90 minutes, inside their usual hours'
    );
    const unseen = { inHours: null, active: false, awayMinutes: null };
    expect(resolveAutopilotJudgePrompt(task, gate, { ...facts, presence: unseen })).toContain(
      'not seen yet, hours not known yet'
    );
    expect(
      resolveAutopilotJudgePrompt(task, { ...gate, choices: ['A'], recommendation: null }, facts)
    ).toEndWith('Choices:\n- A');
  });

  test('cuts a long request and body to their budgets', () => {
    const { task, gate } = setup();
    const long = 'x'.repeat(AUTOPILOT_JUDGMENT_LIMITS.context * 3);
    const prompt = resolveAutopilotJudgePrompt({ ...task, request: long }, { ...gate, body: long }, FACTS);
    expect(prompt).toContain(`Request: ${'x'.repeat(AUTOPILOT_JUDGMENT_LIMITS.context - 1)}…\n`);
    expect(prompt).toEndWith(`${'x'.repeat(AUTOPILOT_JUDGMENT_LIMITS.context * 2 - 1)}…`);
  });
});

describe('the judge request', () => {
  test('is made only for an open gate Autopilot is judging', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { approvePlans: 'always' } });
    harness.send({ type: 'settings.change', patch: { autopilot: { enabled: true } } });
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    const gate = harness.openGate(taskId);
    const request = resolveAutopilotJudgeRequest(harness.state, gate.id, harness.now);
    expect(request?.system).toBe(AUTOPILOT_JUDGE_SYSTEM);
    expect(request?.prompt).toStartWith('Decision: Approve the plan');
    expect(resolveAutopilotJudgeRequest(harness.state, 'gone', harness.now)).toBeNull();
    const quiet = { ...harness.state, gates: { [gate.id]: { ...gate, autopilotJudging: false } } };
    expect(resolveAutopilotJudgeRequest(quiet, gate.id, harness.now)).toBeNull();
    const other = { ...harness.state, gates: { [gate.id]: { ...gate, type: 'failure' as const } } };
    expect(resolveAutopilotJudgeRequest(other, gate.id, harness.now)).toBeNull();
    expect(resolveJudgedGateKind({ ...gate, type: 'secret' })).toBeNull();
  });
});
