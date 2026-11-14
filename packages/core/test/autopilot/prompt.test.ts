import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
import {
  AUTOPILOT_JUDGE_SYSTEM,
  AUTOPILOT_SHADOW_NOTE,
  AUTOPILOT_JUDGMENT_LIMITS,
  type AutopilotFacts,
  type Gate,
  resolveAutopilotJudgePrompt,
  selectAutopilotJudgeRequest,
  selectJudgedGateKind,
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
  ready: false,
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
        'Verdicts: act, forward',
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

  test('adds the model’s estimate, the nearest earlier decisions and how you steer, after the lessons', () => {
    const { task, gate } = setup();
    const prompt = resolveAutopilotJudgePrompt(task, gate, FACTS, ['- a lesson'], {
      estimate: 'Their personal model: 90%.',
      examples: ['- A question: they replied.'],
      steering: ['How they steer their tasks:', '- All messages to agents: 1 decided'],
    });
    expect(prompt).toEndWith(
      [
        'What the developer taught you at earlier ones, most recent first:',
        '- a lesson',
        '',
        'Their personal model: 90%.',
        '',
        'Earlier decisions most like this one, with or without you:',
        '- A question: they replied.',
        '',
        'How they steer their tasks:',
        '- All messages to agents: 1 decided',
      ].join('\n')
    );
    expect(resolveAutopilotJudgePrompt(task, gate, FACTS)).not.toContain('with or without you');
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
    const request = Option.getOrNull(selectAutopilotJudgeRequest(harness.state, gate.id, harness.now));
    expect(request?.system).toBe(AUTOPILOT_JUDGE_SYSTEM);
    expect(request?.prompt).toStartWith('Decision: Approve the plan');
    expect(Option.isNone(selectAutopilotJudgeRequest(harness.state, 'gone', harness.now))).toBe(true);
    const quiet = { ...harness.state, gates: { [gate.id]: { ...gate, autopilotJudging: false } } };
    expect(Option.isNone(selectAutopilotJudgeRequest(quiet, gate.id, harness.now))).toBe(true);
    const other = {
      ...harness.state,
      gates: { [gate.id]: { ...gate, type: 'failure' as const, cause: 'budget' as const } },
    };
    expect(Option.isNone(selectAutopilotJudgeRequest(other, gate.id, harness.now))).toBe(true);
    expect(Option.isNone(selectJudgedGateKind({ ...gate, type: 'secret' }))).toBe(true);
  });

  test('is made for a guess only on a gate brought to you that has none yet, and says it is a guess', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { approvePlans: 'always' } });
    harness.send({ type: 'settings.change', patch: { autopilot: { enabled: true, gates: ['reviews'] } } });
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    const gate = harness.openGate(taskId);
    const guess = Option.getOrNull(selectAutopilotJudgeRequest(harness.state, gate.id, harness.now, true));
    expect(guess?.prompt).toEndWith(AUTOPILOT_SHADOW_NOTE);
    expect(Option.isNone(selectAutopilotJudgeRequest(harness.state, gate.id, harness.now))).toBe(true);
    const guessed = { ...harness.state, gates: { [gate.id]: { ...gate, autopilotGuess: 'act' as const } } };
    expect(Option.isNone(selectAutopilotJudgeRequest(guessed, gate.id, harness.now, true))).toBe(true);
    const judging = { ...harness.state, gates: { [gate.id]: { ...gate, autopilotJudging: true } } };
    expect(Option.isNone(selectAutopilotJudgeRequest(judging, gate.id, harness.now, true))).toBe(true);
    expect(
      Option.getOrNull(selectAutopilotJudgeRequest(judging, gate.id, harness.now))?.prompt
    ).not.toContain(AUTOPILOT_SHADOW_NOTE);
  });

  test('carries the model’s estimate and your earlier plans most like this one, with your words', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { approvePlans: 'always' } });
    harness.send({ type: 'settings.change', patch: { autopilot: { enabled: true } } });
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    const gate = harness.openGate(taskId);
    harness.replay({
      type: 'autopilot.decided',
      decisions: [
        {
          at: 1,
          taskId,
          gateId: null,
          kind: 'plan',
          answer: 'revised',
          projectId: null,
          risk: null,
          scope: null,
          urgent: false,
          watchdog: false,
          touched: false,
          guess: null,
          note: 'Keep it smaller',
          facts: null,
          estimate: null,
        },
        {
          at: 2,
          taskId: 'gone',
          gateId: null,
          kind: 'message',
          answer: 'sent',
          projectId: null,
          risk: null,
          scope: null,
          urgent: false,
          watchdog: false,
          touched: false,
          guess: null,
          note: null,
          facts: null,
          estimate: null,
        },
      ],
    });
    const prompt = Option.getOrNull(selectAutopilotJudgeRequest(harness.state, gate.id, harness.now))?.prompt;
    expect(prompt).toMatch(
      /\nTheir personal model, learned from every decision they made: \d+% that they approve this, from 1 similar decisions\. It is still learning, so weigh it lightly\.\n/
    );
    expect(prompt).toContain(
      `- A plan on “${harness.task(taskId).title}”: they asked for changes. They wrote: “Keep it smaller”`
    );
    expect(prompt).toContain('- All messages to agents: 1 decided: sent 1; lately sent 100%');
    expect(prompt).not.toContain('- All plans:');
  });
});
