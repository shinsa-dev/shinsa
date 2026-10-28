import { capitalise, PLAN_EVIDENCE_KINDS, type PlanDocument, type PlanEvidenceKind } from '@shinsa/core';
import { describeCheckPhases } from '@/lib/tasks/checks.ts';

export type PlanParameters = Partial<Pick<PlanDocument, 'impact' | 'evidence' | 'verification' | 'approval'>>;

interface PlanCheckView {
  label: string;
  command: string;
  phases: string | null;
}

export interface PlanParameterView {
  evidence: string[];
  checks: PlanCheckView[];
  impact: string | null;
  approval: boolean;
}

const EVIDENCE_LABEL: Record<PlanEvidenceKind, string> = {
  screenshot: 'Screenshot',
  recording: 'Recording',
  test: 'Linked test',
  note: 'Note',
  preview: 'Preview link',
};

function isPlanEvidenceKind(value: string): value is PlanEvidenceKind {
  return PLAN_EVIDENCE_KINDS.some((kind) => kind === value);
}

export function listPlanEvidenceKinds(values: readonly string[]): PlanEvidenceKind[] {
  return values.filter(isPlanEvidenceKind);
}

export function resolvePlanParameters(document: PlanParameters): PlanParameterView | null {
  const view = {
    evidence: (document.evidence ?? []).map((kind) => EVIDENCE_LABEL[kind]),
    checks: (document.verification ?? []).map((check) => ({
      label: check.label,
      command: check.command,
      phases: capitalise(describeCheckPhases(check.phases) ?? '') || null,
    })),
    impact: document.impact?.trim() || null,
    approval: document.approval === true,
  };
  const empty = view.evidence.length === 0 && view.checks.length === 0 && !view.impact && !view.approval;
  return empty ? null : view;
}
