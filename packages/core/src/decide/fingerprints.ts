import type { FixFingerprint, FixReason, Task } from '../domain/index.ts';

const FNV_OFFSET = 0x811c9dc5;

const FNV_PRIME = 0x01000193;

function hashText(text: string) {
  let hash = FNV_OFFSET;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function listFailingChecks(task: Task) {
  return (task.checkResults ?? [])
    .filter((check) => check.outcome === 'fail')
    .map((check) => check.name)
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
  return `recovery:${hashText(JSON.stringify(durable))}`;
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

export function countUnchangedRounds(task: Task, reason: FixReason) {
  const tree = task.treeHash ?? null;
  return (task.fixFingerprints ?? []).filter(
    (fingerprint) => fingerprint.reason === reason && isSameTree(fingerprint, tree)
  ).length;
}

export function countReviewRounds(task: Task) {
  return (task.fixFingerprints ?? []).filter((fingerprint) => fingerprint.reason === 'review').length;
}
