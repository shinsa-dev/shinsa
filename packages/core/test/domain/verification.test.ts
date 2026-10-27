import { describe, expect, test } from 'bun:test';
import {
  type Evidence,
  listMissingEvidence,
  listVerificationRules,
  type PipelineStep,
  type PlanDocument,
  SHAPE_PIPELINES,
  VERIFICATION_RULES,
  validatePlanRules,
  validateVerification,
} from '../../src/index.ts';
import { IMPACT, PLAN } from '../harness.ts';

const AFTER_MERGE: PipelineStep[] = [...SHAPE_PIPELINES.change, 'operate'];

const UNVERIFIED_PLAN: PlanDocument = { ...PLAN, verification: [] };

function evidence(kind: Evidence['kind']): Evidence {
  return { id: kind, taskId: 't', runId: null, kind, title: kind, uri: `${kind}.png`, attachedAt: 0 };
}

describe('the verification rules', () => {
  test('apply to work that changes code or runs an operation, never to an inquiry', () => {
    for (const inquiry of [SHAPE_PIPELINES.answer, SHAPE_PIPELINES.research, SHAPE_PIPELINES.investigate]) {
      expect(listVerificationRules(inquiry)).toEqual([]);
      expect(validateVerification(inquiry)).toEqual([]);
      expect(validatePlanRules(inquiry, UNVERIFIED_PLAN)).toEqual([]);
    }
    const classes = (steps: readonly PipelineStep[]) => [
      ...new Set(listVerificationRules(steps).map((rule) => rule.applies)),
    ];
    expect(classes(SHAPE_PIPELINES.fix)).toEqual(['code']);
    expect(classes(AFTER_MERGE)).toEqual(['code', 'operation']);
  });

  test('every rule names its class, scope and check, and the scoped ones apply only in their scope', () => {
    expect(new Set(VERIFICATION_RULES.map((rule) => rule.id)).size).toBe(VERIFICATION_RULES.length);
    const ids = (steps: readonly PipelineStep[]) => listVerificationRules(steps).map((rule) => rule.id);
    expect(ids(SHAPE_PIPELINES.operation)).not.toContain('operation.steps');
    expect(ids(SHAPE_PIPELINES.operation)).not.toContain('operation.confirm_after_merge');
    expect(ids(['plan', 'operate', ...SHAPE_PIPELINES.change.slice(1)])).toContain('operation.steps');
    expect(ids(AFTER_MERGE)).toContain('operation.confirm_after_merge');
  });

  test('a code change needs its checks and an independent agent review, each named on its own', () => {
    expect(
      validateVerification(['plan', 'build', 'agent_review', 'your_review', 'pull_request', 'merge'])
    ).toEqual([
      "A code change is checked: put `checks` after `build`. Shinsa runs the repository's checks on every change; the plan's `checks` add to them.",
    ]);
    expect(validateVerification(['plan', 'build', 'checks', 'your_review', 'pull_request', 'merge'])).toEqual(
      ['A code change gets an independent agent review: put `agent_review` after `checks`.']
    );
    expect(validateVerification(SHAPE_PIPELINES.change)).toEqual([]);
    expect(validateVerification(SHAPE_PIPELINES.operation)).toEqual([]);
  });

  test('a plan for a change needs a verification plan, and one for an operation its impact', () => {
    expect(validatePlanRules(SHAPE_PIPELINES.change, UNVERIFIED_PLAN)).toEqual([
      'This task changes code, so the plan needs a verification plan up front: list in `verification` how the change is proven (the tests, checks, runs or screenshots that show it works).',
    ]);
    expect(validatePlanRules(SHAPE_PIPELINES.change, PLAN)).toEqual([]);
    expect(validatePlanRules(SHAPE_PIPELINES.operation, UNVERIFIED_PLAN)).toEqual([
      'This task runs an operation, so the plan needs `impact`: what the operation changes and how much, the result of a dry run (or why none is possible) and how to undo it.',
    ]);
    expect(validatePlanRules(SHAPE_PIPELINES.operation, { ...UNVERIFIED_PLAN, impact: IMPACT })).toEqual([]);
    expect(validatePlanRules(AFTER_MERGE, { ...PLAN, impact: IMPACT })).toEqual([
      'This task also runs an operation: list its steps in `operation`, in order, each with how to check it worked. The `phases` are the code change only.',
    ]);
  });

  test('extra checks are a parameter of a code change only, while an operation may ask for evidence', () => {
    const asks = { ...PLAN, impact: IMPACT, evidence: ['screenshot' as const], checks: ['bun test x'] };
    expect(validatePlanRules(SHAPE_PIPELINES.change, asks)).toEqual([]);
    expect(validatePlanRules(SHAPE_PIPELINES.operation, asks)).toEqual([
      '`checks` are for a code change, and this task changes no code: leave them out.',
    ]);
    expect(validatePlanRules(SHAPE_PIPELINES.operation, { ...asks, checks: [] })).toEqual([]);
  });

  test('an operation without a code change attaches its evidence before it reports, one after a merge does not', () => {
    const ids = (steps: readonly PipelineStep[]) => listVerificationRules(steps).map((rule) => rule.id);
    expect(ids(SHAPE_PIPELINES.operation)).toContain('operation.evidence');
    expect(ids(['investigate', 'your_ok', 'plan', 'operate'])).toContain('operation.evidence');
    expect(ids(POST_MERGE)).not.toContain('operation.evidence');
    expect(ids(SHAPE_PIPELINES.change)).not.toContain('operation.evidence');
    expect(VERIFICATION_RULES.find((rule) => rule.id === 'operation.evidence')).toMatchObject({
      scope: 'alone',
      check: { kind: 'evidence' },
    });
  });

  test('the evidence a plan asks for is missing until a piece of that kind is attached', () => {
    const asks = { ...PLAN, evidence: ['screenshot' as const, 'test' as const] };
    expect(listMissingEvidence(asks, [])).toEqual(['screenshot', 'test']);
    expect(listMissingEvidence(asks, [evidence('screenshot'), evidence('note')])).toEqual(['test']);
    expect(listMissingEvidence(PLAN, [])).toEqual([]);
    expect(listMissingEvidence(null, [])).toEqual([]);
  });
});
