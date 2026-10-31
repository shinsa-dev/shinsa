import { describe, expect, test } from 'bun:test';
import {
  COMPOSABLE_STEPS,
  describePlanGateRule,
  GATE_SCHEMA,
  type Gate,
  type GateType,
  isAgentQuestion,
  isComposableStep,
  isDecisionGate,
  isPausingGate,
  needsWorktree,
  PIPELINE_ORDER,
  PLAN_GATE_RULE,
  resolveGateDefinition,
  resolveHandOverPipeline,
  SHAPE_PIPELINES,
  STEP_SCHEMA,
  TASK_SHAPES,
  validatePipeline,
} from '../../src/index.ts';

function gate(overrides: Partial<Gate>): Gate {
  return {
    id: 'g',
    taskId: 't',
    type: 'question',
    status: 'open',
    title: 'Which one?',
    body: '',
    runId: null,
    openedAt: 0,
    answeredAt: null,
    decision: null,
    response: null,
    ...overrides,
  };
}

describe('the step schema', () => {
  test('defines every step once, in the fixed order, with a role, an exit and a gate strength', () => {
    expect(Object.keys(STEP_SCHEMA).sort()).toEqual([...PIPELINE_ORDER].sort());
    for (const step of PIPELINE_ORDER) {
      const definition = STEP_SCHEMA[step];
      expect(definition.step).toBe(step);
      expect(definition.exit.length).toBeGreaterThan(0);
      expect(definition.outputs.length).toBeGreaterThan(0);
      expect(['hard', 'soft', 'none']).toContain(definition.gate.strength);
    }
    expect(STEP_SCHEMA.your_review.actor).toEqual({ by: 'you' });
    expect(STEP_SCHEMA.checks.actor).toEqual({ by: 'shinsa' });
    expect(STEP_SCHEMA.build.actor).toEqual({ by: 'agent', role: 'agent' });
    expect(STEP_SCHEMA.agent_review.gate.strength).toBe('soft');
    expect(STEP_SCHEMA.merge.gate.strength).toBe('hard');
    expect(STEP_SCHEMA.answer.gate.strength).toBe('none');
  });

  test('every gate a step names is in the gate schema, and every hard gate is decided by you', () => {
    for (const step of PIPELINE_ORDER) {
      for (const type of STEP_SCHEMA[step].gate.types) expect(GATE_SCHEMA[type].type).toBe(type);
    }
    for (const definition of Object.values(GATE_SCHEMA)) {
      if (definition.strength === 'hard') {
        expect(definition.decidedBy).toBe('you');
        expect(definition.decisions.length > 0).toBe(definition.type !== 'post_merge');
      } else {
        expect(definition.outcomes.map((outcome) => outcome.decision)).toEqual(['pass', 'fail', 'escalate']);
      }
    }
  });

  test('every preset passes the schema, and only work on files needs a worktree', () => {
    for (const shape of TASK_SHAPES) expect(validatePipeline(SHAPE_PIPELINES[shape])).toEqual([]);
    expect(needsWorktree(SHAPE_PIPELINES.research)).toBe(false);
    expect(needsWorktree(SHAPE_PIPELINES.operation)).toBe(true);
  });

  test('a gate’s definition is the hard gate of its type', () => {
    const types: GateType[] = [
      'plan',
      'review',
      'merge',
      'question',
      'secret',
      'proposal',
      'operation',
      'failure',
      'configuration',
      'sign_in',
    ];
    for (const type of types) expect(resolveGateDefinition(gate({ type }))).toBe(GATE_SCHEMA[type]);
    expect(
      resolveGateDefinition(gate({ type: 'proposal' })).decisions.map((choice) => choice.decision)
    ).toEqual(['approve', 'reject']);
    expect(
      resolveGateDefinition(gate({ type: 'operation' })).decisions.map((choice) => choice.decision)
    ).toEqual(['approve', 'reply', 'reject']);
    expect(
      resolveGateDefinition(gate({ type: 'configuration' })).decisions.map((choice) => choice.decision)
    ).toEqual(['approve', 'reject']);
  });

  test('plan, review and merge are the decision gates; a question and a secret are an agent’s questions', () => {
    expect(['plan', 'review', 'merge'].every((type) => isDecisionGate({ type: type as GateType }))).toBe(
      true
    );
    expect(isDecisionGate(gate({ type: 'question' }))).toBe(false);
    expect(isDecisionGate(gate({ type: 'proposal' }))).toBe(false);
    expect(isAgentQuestion(gate({ type: 'question' }))).toBe(true);
    expect(isAgentQuestion(gate({ type: 'secret' }))).toBe(true);
    expect(isAgentQuestion(gate({ type: 'sign_in' }))).toBe(false);
  });

  test('each soft gate escalates to a hard gate: checks and CI to a failure, the agent review to yours', () => {
    expect(GATE_SCHEMA.checks.escalatesTo).toBe('failure');
    expect(GATE_SCHEMA.ci.escalatesTo).toBe('failure');
    expect(GATE_SCHEMA.agent_review.escalatesTo).toBe('review');
  });

  test('the plan gate rule is data, and the plan step describes it', () => {
    expect(PLAN_GATE_RULE).toEqual({
      always: ['operates', 'plan_first', 'backlog', 'asks_approval'],
      withLargePlans: ['large', 'revised'],
    });
    expect(describePlanGateRule()).toBe(
      'Always when the task runs an operation, it was created plan first, it is in the backlog or the plan asks for approval; with Approve plans on Large plans, also when the plan has more than 3 phases or 6 files or the plan is a revision; on Always, every plan.'
    );
    expect(describePlanGateRule({ always: ['large'], withLargePlans: ['revised'] })).toBe(
      'Always when the plan has more than 3 phases or 6 files; with Approve plans on Large plans, also when the plan is a revision; on Always, every plan.'
    );
    expect(STEP_SCHEMA.plan.gate.when).toBe(describePlanGateRule());
  });

  test('a gate pauses the task exactly when its type says so', () => {
    expect(isPausingGate(gate({ type: 'failure' }))).toBe(true);
    expect(isPausingGate(gate({ type: 'sign_in' }))).toBe(true);
    expect(isPausingGate(gate({ type: 'configuration' }))).toBe(true);
    expect(isPausingGate(gate({ type: 'operation' }))).toBe(false);
    expect(isPausingGate(gate({ type: 'review' }))).toBe(false);
  });

  test('your steps before and after the merge are steps no agent composes, guarded like the rest', () => {
    expect(COMPOSABLE_STEPS).not.toContain('pre_merge');
    expect(COMPOSABLE_STEPS).not.toContain('post_merge');
    expect(isComposableStep('merge')).toBe(true);
    expect(isComposableStep('pre_merge')).toBe(false);
    expect(STEP_SCHEMA.pre_merge.gate.types).toEqual(['merge']);
    expect(STEP_SCHEMA.post_merge.gate.types).toEqual(['post_merge']);
    expect(GATE_SCHEMA.post_merge.decisions).toEqual([]);
    const change = SHAPE_PIPELINES.change;
    const both = resolveHandOverPipeline(change, { before: true, after: true });
    expect(both.slice(-4)).toEqual(['pull_request', 'pre_merge', 'merge', 'post_merge']);
    expect(validatePipeline(both)).toEqual([]);
    expect(validatePipeline([...change, 'operate', 'post_merge'])).toEqual([]);
    expect(validatePipeline([...change, 'post_merge', 'operate'])).toContain(
      'An operation runs right after the plan, or after the merge, before your steps after it.'
    );
    expect(
      validatePipeline([
        'plan',
        'build',
        'checks',
        'agent_review',
        'your_review',
        'pre_merge',
        'pull_request',
        'merge',
      ])
    ).toContain('Your pre-merge steps come after the pull request.');
    expect(validatePipeline(['plan', 'operate', 'pre_merge'])).toEqual(
      expect.arrayContaining([
        'Your pre-merge steps come after the pull request.',
        'Your pre-merge steps need a merge after them.',
      ])
    );
    expect(validatePipeline(['plan', 'operate', 'post_merge'])).toContain(
      'Your post-merge steps come after the merge.'
    );
    expect(resolveHandOverPipeline(both, { before: false, after: false })).toEqual([...change]);
    expect(resolveHandOverPipeline(SHAPE_PIPELINES.operation, { before: true, after: true })).toEqual([
      ...SHAPE_PIPELINES.operation,
    ]);
    expect(resolveHandOverPipeline([...change, 'operate'], { before: false, after: true }).slice(-2)).toEqual(
      ['operate', 'post_merge']
    );
  });
});
