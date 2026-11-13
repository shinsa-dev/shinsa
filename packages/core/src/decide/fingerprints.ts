import { Option } from 'effect';
import { hashText } from '../domain/hash.ts';
import { type FixFingerprint, type FixReason, listBlockingChecks, type Task } from '../domain/index.ts';

function listFailingChecks(task: Task) {
  return listBlockingChecks(task)
    .map((check) => check.id)
    .sort();
}

function listBlockingFindings(task: Task) {
  return task.findings
    .filter((finding) => finding.severity === 'blocking' && finding.verdict !== 'dismiss')
    .map((finding) => `${finding.file ?? ''}:${finding.line ?? ''}`)
    .sort();
}

export function resolveRecoveryFingerprint(task: Task) {
  const pullRequest = task.pullRequest;
  const durable = {
    stage: task.stage,
    plan: task.plan?.version ?? 0,
    phases: task.phaseReports.map((report) => report.index).sort((a, b) => a - b),
    tree: task.treeHash ?? null,
    checks: listFailingChecks(task),
    findings: listBlockingFindings(task),
    pullRequest: pullRequest
      ? [
          pullRequest.checks,
          pullRequest.unresolvedComments,
          pullRequest.mergeable,
          pullRequest.headSha ?? null,
        ]
      : null,
  };
  return `recovery:${hashText(JSON.stringify(durable)).toString(16).padStart(8, '0')}`;
}

function isSameTree(fingerprint: FixFingerprint, tree: string | null) {
  return tree !== null && fingerprint.treeHash === tree;
}

export function countFixRepeats(task: Task, reason: FixReason, signature: string | null) {
  const fingerprints = task.fixFingerprints ?? [];
  const tree = task.treeHash ?? null;
  return fingerprints.filter(
    (fingerprint) =>
      fingerprint.reason === reason &&
      ((signature !== null && fingerprint.signature === signature) || isSameTree(fingerprint, tree))
  ).length;
}

export function isUnchangedFix(task: Task, reason: FixReason, signature: string | null) {
  const last = (task.fixFingerprints ?? []).at(-1);
  return (
    last !== undefined &&
    last.reason === reason &&
    signature !== null &&
    last.signature === signature &&
    isSameTree(last, task.treeHash ?? null)
  );
}

export function countUnchangedRounds(task: Task, reason: FixReason) {
  const tree = task.treeHash ?? null;
  return (task.fixFingerprints ?? []).filter(
    (fingerprint) => fingerprint.reason === reason && isSameTree(fingerprint, tree)
  ).length;
}

export function countReviewRounds(task: Task) {
  return (task.fixFingerprints ?? []).filter((fingerprint) => fingerprint.reason === 'review').length;
}

export function resolveReviewInputFingerprint(
  task: Task,
  evidenceIds: readonly string[]
): Option.Option<string> {
  const tree = task.treeHash ?? null;
  if (tree === null) return Option.none();
  const input = {
    tree,
    plan: task.plan?.version ?? 0,
    reports: [...task.phaseReports]
      .sort((a, b) => a.index - b.index)
      .map((report) => ({
        index: report.index,
        summary: report.summary,
        spots: report.spots,
        judgementCalls: report.judgementCalls,
        walkthrough: report.walkthrough ?? null,
        files: report.files ?? [],
      })),
    evidence: [...evidenceIds].sort(),
  };
  return Option.some(`review:${hashText(JSON.stringify(input)).toString(16).padStart(8, '0')}`);
}
