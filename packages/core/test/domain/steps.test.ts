import { describe, expect, test } from 'bun:test';
import {
  GATE_SCHEMA,
  type Gate,
  isPausingGate,
  needsWorktree,
  PIPELINE_ORDER,
  resolveGateDefinition,
  resolveGateType,
  SHAPE_PIPELINES,
  STEP_SCHEMA,
  TASK_SHAPES,
  validatePipeline,
} from '../../src/index.ts';

function gate(overrides: Partial<Gate>): Gate {
  return {
    id: 'g',
    taskId: 't',
    kind: 'question',
    purpose: 'agent_question',
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
    expect(STEP_SCHEMA.build.actor).toEqual({ by: 'agent', role: 'builder' });
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
        expect(definition.decisions.length).toBeGreaterThan(0);
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

  test('a gate reads as its type: plan, review and merge by kind, the rest by purpose, a secret by itself', () => {
    expect(resolveGateType(gate({ kind: 'plan', purpose: 'decision' }))).toBe('plan');
    expect(resolveGateType(gate({ kind: 'merge', purpose: 'decision' }))).toBe('merge');
    expect(resolveGateType(gate({ kind: 'question', purpose: 'decision' }))).toBe('question');
    expect(resolveGateType(gate({ purpose: 'operation' }))).toBe('operation');
    expect(resolveGateType(gate({ secret: { label: 'Key' } }))).toBe('secret');
    expect(
      resolveGateDefinition(gate({ purpose: 'change' })).decisions.map((choice) => choice.decision)
    ).toEqual(['approve', 'reject']);
  });

  test('a gate pauses the task exactly when its type says so', () => {
    expect(isPausingGate(gate({ purpose: 'failure' }))).toBe(true);
    expect(isPausingGate(gate({ purpose: 'sign_in' }))).toBe(true);
    expect(isPausingGate(gate({ purpose: 'configuration' }))).toBe(true);
    expect(isPausingGate(gate({ purpose: 'operation' }))).toBe(false);
    expect(isPausingGate(gate({ kind: 'review', purpose: 'decision' }))).toBe(false);
  });
});
