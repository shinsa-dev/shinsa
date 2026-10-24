import { PLAN_EVIDENCE_KINDS, type PlanEvidenceKind, type PlanDocument } from '@shinsa/core';

export type PlanParameters = Pick<PlanDocument, 'impact' | 'evidence' | 'checks' | 'approval'>;

export interface PlanParameterView {
  evidence: string[];
  checks: string[];
  impact: string | null;
  approval: boolean;
}

const EVIDENCE_LABEL: Record<PlanEvidenceKind, string> = {
  screenshot: 'Screenshot',
  recording: 'Recording',
  test: 'Test output',
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
    checks: document.checks ?? [],
    impact: document.impact?.trim() || null,
    approval: document.approval === true,
  };
  const empty = view.evidence.length === 0 && view.checks.length === 0 && !view.impact && !view.approval;
  return empty ? null : view;
}
