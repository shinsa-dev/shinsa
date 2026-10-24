import type { FindingVerdict, FindingVerdictKind, Gate, ReviewEscalation, ReviewFinding } from '@shinsa/core';
import { formatCount } from '@/lib/format/count.ts';
import { type LineComment, serializeComments } from '@/lib/review/draft.ts';
import type { AnswerExtras, GateReply } from '@/lib/tasks/gates.ts';

export type VerdictDraft = Record<number, FindingVerdictKind>;

export const VERDICT_ITEMS: { value: FindingVerdictKind; label: string }[] = [
  { value: 'fix', label: 'Fix' },
  { value: 'dismiss', label: 'Dismiss' },
];

export interface VerdictAction {
  reply: Extract<GateReply, 'approveChanges' | 'fixFindings'>;
  label: string;
}

export function createVerdictDraft(findings: ReviewFinding[]): VerdictDraft {
  return Object.fromEntries(
    findings.map((finding, index) => [index, finding.severity === 'blocking' ? 'fix' : 'dismiss'])
  );
}

export function resolveVerdict(draft: VerdictDraft, index: number): FindingVerdictKind {
  return draft[index] ?? 'dismiss';
}

export function listVerdicts(findings: ReviewFinding[], draft: VerdictDraft): FindingVerdict[] {
  return findings.map((_, index) => ({ index, verdict: resolveVerdict(draft, index), note: null }));
}

export function resolveVerdictAction(findings: ReviewFinding[], draft: VerdictDraft): VerdictAction {
  const fixes = listVerdicts(findings, draft).filter((verdict) => verdict.verdict === 'fix').length;
  if (fixes === 0) {
    return { reply: 'approveChanges', label: 'Approve changes' };
  }
  return { reply: 'fixFindings', label: `Fix ${formatCount(fixes, 'finding', 'findings')}` };
}

export function isVerdictActionBlocked(commented: boolean, action: VerdictAction) {
  return commented && action.reply === 'approveChanges';
}

export function resolveVerdictAnswer(
  findings: ReviewFinding[],
  draft: VerdictDraft,
  comments: readonly LineComment[]
): AnswerExtras {
  const verdicts = findings.length > 0 ? { verdicts: listVerdicts(findings, draft) } : {};
  const fixing = resolveVerdictAction(findings, draft).reply === 'fixFindings';
  if (!fixing || comments.length === 0) return verdicts;
  return { ...verdicts, comments: serializeComments(comments) };
}

function describeEscalationTitle(escalation: ReviewEscalation) {
  return escalation.reason === 'stalled'
    ? 'The fix changed nothing and the same findings came back'
    : 'The agents could not settle the review';
}

export function describeEscalationBody(escalation: ReviewEscalation) {
  const rounds = formatCount(escalation.rounds, 'fix round', 'fix rounds');
  if (escalation.reason === 'stalled') {
    return 'Shinsa stopped instead of trying again. Decide on each finding: keep the ones to fix, dismiss the rest.';
  }
  return `The reviewer still had findings after ${rounds}. Decide on each one: keep the ones to fix, dismiss the rest.`;
}

export function describeReviewTitle(gate: Gate) {
  if (gate.escalation) return describeEscalationTitle(gate.escalation);
  return gate.type === 'merge'
    ? 'The pull request is clean and ready to merge'
    : 'Built and checked. Your turn to review the changes.';
}

export function describeApproveHint(commented: boolean, action: VerdictAction) {
  if (action.reply === 'fixFindings') {
    return commented
      ? 'Sends the findings you kept and your line comments to the agent'
      : 'Sends the findings you kept to the agent';
  }
  return commented ? 'Send your line comments to the agent or remove them first' : 'Opens the pull request';
}
