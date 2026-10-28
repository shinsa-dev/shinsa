import type { PlanDocument } from '../report/types.ts';
import { type PipelineStep, STEP_SCHEMA, type StepClass } from './steps.ts';
import type { Evidence, EvidenceKind, EvidenceStage, EvidenceTheme, GateType } from './types.ts';

export type VerifiedClass = Extract<StepClass, 'code' | 'operation'>;

export type PlanField = 'verification' | 'impact' | 'operation';

export type VerificationCheck =
  | { kind: 'step'; step: PipelineStep }
  | { kind: 'guard'; steps: readonly PipelineStep[] }
  | { kind: 'plan'; field: PlanField }
  | { kind: 'evidence' }
  | { kind: 'gate'; gate: GateType };

export type VerificationScope = 'always' | 'alone' | 'with_code' | 'post_merge';

export interface VerificationRule {
  id: string;
  applies: VerifiedClass;
  scope: VerificationScope;
  check: VerificationCheck;
  requirement: string;
  message: string;
}

export type PlanEvidenceKind = Exclude<EvidenceKind, 'check'>;

export const EVIDENCE_KINDS: readonly [EvidenceKind, ...EvidenceKind[]] = [
  'screenshot',
  'recording',
  'test',
  'check',
  'note',
  'preview',
];

export const EVIDENCE_THEMES: readonly [EvidenceTheme, ...EvidenceTheme[]] = ['light', 'dark'];

export const EVIDENCE_STAGES: readonly [EvidenceStage, ...EvidenceStage[]] = ['before', 'after'];

export const PLAN_EVIDENCE_KINDS: readonly [PlanEvidenceKind, ...PlanEvidenceKind[]] = [
  'screenshot',
  'recording',
  'test',
  'note',
  'preview',
];

export const VERIFICATION_RULES: readonly VerificationRule[] = [
  {
    id: 'code.verification_plan',
    applies: 'code',
    scope: 'always',
    check: { kind: 'plan', field: 'verification' },
    requirement:
      'The plan names the checks that prove the change: each a label, its exact scoped command and the phases it covers.',
    message:
      'This task changes code, so the plan needs its checks up front: list in `verification` the checks that prove the change, each a `label`, the exact `command` scoped to what the change touches (the test files or folder, one package’s type check, the linter on the changed paths) and the `phases` it covers.',
  },
  {
    id: 'code.evidence',
    applies: 'code',
    scope: 'always',
    check: { kind: 'evidence' },
    requirement: 'The evidence the plan asks for is attached before your review.',
    message: 'Attach it with `attach_evidence` before you complete the last phase.',
  },
  {
    id: 'code.checks',
    applies: 'code',
    scope: 'always',
    check: { kind: 'step', step: 'checks' },
    requirement:
      'Shinsa runs the plan’s checks after each phase they cover, the failing ones after a fix, and the repository’s own commands once before review.',
    message:
      'A code change is checked: put `checks` after `build`. Shinsa runs the checks the plan lists after each phase they cover.',
  },
  {
    id: 'code.agent_review',
    applies: 'code',
    scope: 'always',
    check: { kind: 'step', step: 'agent_review' },
    requirement: 'A fresh reviewer that did not build it reads the diff.',
    message: 'A code change gets an independent agent review: put `agent_review` after `checks`.',
  },
  {
    id: 'code.shipping',
    applies: 'code',
    scope: 'always',
    check: { kind: 'guard', steps: ['your_review', 'pull_request', 'merge'] },
    requirement: 'You review it, then a pull request opens, CI and bots run, and you merge it.',
    message: 'A code change goes through your review, a pull request and the merge.',
  },
  {
    id: 'code.ci',
    applies: 'code',
    scope: 'always',
    check: { kind: 'gate', gate: 'merge' },
    requirement:
      'The merge gate opens only on a clean pull request: CI green, no unread comment, no conflict.',
    message: 'A merge waits for CI.',
  },
  {
    id: 'operation.evidence',
    applies: 'operation',
    scope: 'alone',
    check: { kind: 'evidence' },
    requirement:
      'An operation without a code change attaches the evidence its plan asks for before it reports.',
    message: 'Attach it with `attach_evidence` before you report the outcome.',
  },
  {
    id: 'operation.plan_approved',
    applies: 'operation',
    scope: 'always',
    check: { kind: 'gate', gate: 'plan' },
    requirement: 'You approve the plan before anything runs.',
    message: 'An operation runs only from a plan you approved.',
  },
  {
    id: 'operation.impact',
    applies: 'operation',
    scope: 'always',
    check: { kind: 'plan', field: 'impact' },
    requirement:
      'The plan states the impact: what changes and how much, the dry run where one is possible, and how to undo it.',
    message:
      'This task runs an operation, so the plan needs `impact`: what the operation changes and how much, the result of a dry run (or why none is possible) and how to undo it.',
  },
  {
    id: 'operation.steps',
    applies: 'operation',
    scope: 'with_code',
    check: { kind: 'plan', field: 'operation' },
    requirement: 'With a code change, the operation’s steps are listed apart from the phases.',
    message:
      'This task also runs an operation: list its steps in `operation`, in order, each with how to check it worked. The `phases` are the code change only.',
  },
  {
    id: 'operation.confirm_post_merge',
    applies: 'operation',
    scope: 'post_merge',
    check: { kind: 'gate', gate: 'operation' },
    requirement: 'After the merge you confirm again, with the merged commit in front of you, before it runs.',
    message: 'An operation after the merge waits for your OK on the merged code.',
  },
];

function isPostMerge(steps: readonly PipelineStep[]) {
  const build = steps.indexOf('build');
  return build !== -1 && steps.indexOf('operate') > build;
}

function listVerifiedClasses(steps: readonly PipelineStep[]): VerifiedClass[] {
  const classes = steps.map((step) => STEP_SCHEMA[step].class);
  return (['code', 'operation'] as const).filter((verified) => classes.includes(verified));
}

function isInScope(steps: readonly PipelineStep[], scope: VerificationScope) {
  if (scope === 'alone') return !steps.includes('build');
  if (scope === 'with_code') return steps.includes('build');
  if (scope === 'post_merge') return isPostMerge(steps);
  return true;
}

export function listVerificationRules(steps: readonly PipelineStep[]) {
  const classes = listVerifiedClasses(steps);
  return VERIFICATION_RULES.filter((rule) => classes.includes(rule.applies) && isInScope(steps, rule.scope));
}

export function validateVerification(steps: readonly PipelineStep[]): string[] {
  return listVerificationRules(steps).flatMap((rule) => {
    if (rule.check.kind !== 'step' || steps.includes(rule.check.step)) return [];
    return [rule.message];
  });
}

const PLAN_FIELD_FILLED: Record<PlanField, (document: PlanDocument) => boolean> = {
  verification: (document) => document.verification.length > 0,
  impact: (document) => Boolean(document.impact?.trim()),
  operation: (document) => (document.operation ?? []).length > 0,
};

export function validatePlanRules(steps: readonly PipelineStep[], document: PlanDocument): string[] {
  const errors = listVerificationRules(steps).flatMap((rule) => {
    if (rule.check.kind !== 'plan' || PLAN_FIELD_FILLED[rule.check.field](document)) return [];
    return [rule.message];
  });
  if (document.verification.length > 0 && !steps.includes('build')) {
    errors.push(
      '`verification` lists checks for a code change, and this task changes no code: leave it empty.'
    );
  }
  return errors;
}

export function listMissingEvidence(document: PlanDocument | null, attached: readonly Evidence[]) {
  const kinds = new Set(attached.map((evidence) => evidence.kind));
  return (document?.evidence ?? []).filter((kind) => !kinds.has(kind));
}
