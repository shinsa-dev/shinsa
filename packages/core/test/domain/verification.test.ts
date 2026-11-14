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
import { IMPACT, INITIATIVE_PLAN, PLAN, SPLIT_PLAN } from '../harness.ts';

const POST_MERGE: PipelineStep[] = [...SHAPE_PIPELINES.change, 'operate'];

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
    expect(classes(POST_MERGE)).toEqual(['code', 'operation']);
  });

  test('every rule names its class, scope and check, and the scoped ones apply only in their scope', () => {
    expect(new Set(VERIFICATION_RULES.map((rule) => rule.id)).size).toBe(VERIFICATION_RULES.length);
    const ids = (steps: readonly PipelineStep[]) => listVerificationRules(steps).map((rule) => rule.id);
    expect(ids(SHAPE_PIPELINES.operation)).not.toContain('operation.steps');
    expect(ids(SHAPE_PIPELINES.operation)).not.toContain('operation.confirm_post_merge');
    expect(ids(['plan', 'operate', ...SHAPE_PIPELINES.change.slice(1)])).toContain('operation.steps');
    expect(ids(POST_MERGE)).toContain('operation.confirm_post_merge');
  });

  test('a code change needs its checks and an independent agent review, each named on its own', () => {
    expect(
      validateVerification(['plan', 'build', 'agent_review', 'your_review', 'pull_request', 'merge'])
    ).toEqual([
      'A code change is checked: put `checks` after `build`. Shinsa runs the checks the plan lists after each phase they cover.',
    ]);
    expect(validateVerification(['plan', 'build', 'checks', 'your_review', 'pull_request', 'merge'])).toEqual(
      ['A code change gets an independent agent review: put `agent_review` after `checks`.']
    );
    expect(validateVerification(SHAPE_PIPELINES.change)).toEqual([]);
    expect(validateVerification(SHAPE_PIPELINES.operation)).toEqual([]);
  });

  test('a plan for a change needs a verification plan, and one for an operation its impact', () => {
    expect(validatePlanRules(SHAPE_PIPELINES.change, UNVERIFIED_PLAN)).toEqual([
      'This task changes code, so the plan needs its checks up front: list in `verification` the checks that prove the change, each a `label`, the exact `command` scoped to what the change touches (the test files or folder, one package’s type check, the linter on the changed paths) and the `phases` it covers.',
    ]);
    expect(validatePlanRules(SHAPE_PIPELINES.change, PLAN)).toEqual([]);
    expect(validatePlanRules(SHAPE_PIPELINES.operation, UNVERIFIED_PLAN)).toEqual([
      'This task runs an operation, so the plan needs `impact`: what the operation changes and how much, the result of a dry run (or why none is possible) and how to undo it.',
    ]);
    expect(validatePlanRules(SHAPE_PIPELINES.operation, { ...UNVERIFIED_PLAN, impact: IMPACT })).toEqual([]);
    expect(validatePlanRules(POST_MERGE, { ...PLAN, impact: IMPACT })).toEqual([
      'This task also runs an operation: list its steps in `operation`, in order, each with how to check it worked. The `phases` are the code change only.',
    ]);
  });

  test('a plan makes an initiative only of a split', () => {
    expect(validatePlanRules(SHAPE_PIPELINES.change, INITIATIVE_PLAN)).toEqual([]);
    expect(validatePlanRules(SHAPE_PIPELINES.change, { ...PLAN, initiative: true })).toEqual([
      '`initiative` makes this task and its split parts an initiative: give the parts in `split`, or leave it out.',
    ]);
  });

  test('an initiative never stacks its parts as a bundle, while a plain split may', () => {
    const stacked =
      "An initiative's tasks each merge on their own, so none stacks as a bundle: give each part `parallel`, or `waits_on` when it needs another part merged first.";
    expect(validatePlanRules(SHAPE_PIPELINES.change, SPLIT_PLAN)).toEqual([]);
    expect(validatePlanRules(SHAPE_PIPELINES.change, { ...SPLIT_PLAN, initiative: true })).toEqual([stacked]);
    const lead = { ...SPLIT_PLAN, files: [], verification: [] };
    expect(validatePlanRules(SHAPE_PIPELINES.lead, lead)).toEqual([stacked]);
    expect(validatePlanRules(SHAPE_PIPELINES.lead, { ...lead, split: INITIATIVE_PLAN.split })).toEqual([]);
  });

  test('a plan splits off other tasks only when this task opens a pull request', () => {
    expect(validatePlanRules(SHAPE_PIPELINES.change, SPLIT_PLAN)).toEqual([]);
    expect(
      validatePlanRules(SHAPE_PIPELINES.operation, { ...SPLIT_PLAN, verification: [], impact: IMPACT })
    ).toEqual([
      '`split` starts other changes, and this task opens no pull request: leave it out and suggest the work with `suggest_tasks`.',
    ]);
  });

  test('checks are for a code change only, while an operation may ask for evidence', () => {
    const asks = { ...PLAN, impact: IMPACT, evidence: ['screenshot' as const] };
    expect(validatePlanRules(SHAPE_PIPELINES.change, asks)).toEqual([]);
    expect(validatePlanRules(SHAPE_PIPELINES.operation, asks)).toEqual([
      '`verification` lists checks for a code change, and this task changes no code: leave it empty.',
    ]);
    expect(validatePlanRules(SHAPE_PIPELINES.operation, { ...asks, verification: [] })).toEqual([]);
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
