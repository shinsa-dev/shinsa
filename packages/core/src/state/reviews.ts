import type { FindingVerdict } from '../domain/index.ts';
import type { ReviewFinding } from '../report/types.ts';
import type { ShinsaState } from './project.ts';
import { updateTask } from './write.ts';

const DISMISSED_LIMIT = 30;

function isSameFinding(a: ReviewFinding, b: ReviewFinding) {
  return a.file === b.file && a.line === b.line && a.message === b.message;
}

export function applyVerdicts(state: ShinsaState, taskId: string, at: number, verdicts: FindingVerdict[]) {
  const task = state.tasks[taskId];
  if (!task) return;
  const byIndex = new Map(verdicts.map((verdict) => [verdict.index, verdict]));
  const findings = task.findings.map((finding, index) => {
    const verdict = byIndex.get(index);
    return verdict ? { ...finding, verdict: verdict.verdict, verdictNote: verdict.note } : finding;
  });
  const dismissed = findings.filter((finding) => finding.verdict === 'dismiss');
  const kept = (task.dismissedFindings ?? []).filter(
    (earlier) => !dismissed.some((finding) => isSameFinding(finding, earlier))
  );
  updateTask(state, taskId, at, {
    findings,
    ...(dismissed.length > 0 ? { dismissedFindings: [...kept, ...dismissed].slice(-DISMISSED_LIMIT) } : {}),
  });
}
