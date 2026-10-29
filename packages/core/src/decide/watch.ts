import type {
  CiRun,
  PullRequest,
  PullRequestCi,
  PullRequestRemark,
  PullRequestWatch,
  PullRequestWatchChange,
  RepoCi,
  Task,
} from '../domain/index.ts';
import { MINUTE_MS } from '../domain/time.ts';

export const PULL_REQUEST_WATCH_WAKE_LIMIT = 10;

export const PULL_REQUEST_READ_FAILURE_LIMIT = 8;

const LISTED_WATCH_ITEMS = 10;

const SNIPPET_LENGTH = 200;

const WATCH_EPOCH = '1970-01-01T00:00:00.000Z';

export const CI_GRACE_MS = 1.5 * MINUTE_MS;

export interface PullRequestWatchReport {
  changes: PullRequestWatchChange[];
  next: PullRequestWatch;
  exhausted: boolean;
}

export function createPullRequestWatch(startedAt: number): PullRequestWatch {
  return {
    startedAt,
    headSha: null,
    failedChecks: [],
    passed: false,
    passedChecks: [],
    remarksThrough: WATCH_EPOCH,
    remarkIds: [],
    conflicting: false,
    wakes: 0,
    stopped: null,
    ciAbsent: false,
  };
}

export function resolvePullRequestCi(
  task: Task,
  watch: PullRequestWatch,
  repo: RepoCi,
  now: number
): PullRequestCi {
  return { repo, since: task.pushedAt ?? watch.startedAt, now };
}

function isCiAbsent(ci: PullRequestCi | null) {
  if (!ci || ci.repo === 'required') return false;
  return ci.repo === 'none' || ci.now - ci.since >= CI_GRACE_MS;
}

function isFailedCheck(check: CiRun) {
  return check.status === 'failure' || check.status === 'cancelled' || check.status === 'action_required';
}

function resolveRemarkTime(remark: PullRequestRemark) {
  return remark.editedAt ?? remark.createdAt;
}

function evaluateChecks(watch: PullRequestWatch, checks: CiRun[], headMoved: boolean) {
  const changes: PullRequestWatchChange[] = [];
  let failedChecks = headMoved ? [] : watch.failedChecks;
  let passed = headMoved ? false : watch.passed;
  let passedChecks = headMoved ? [] : watch.passedChecks;
  if (checks.length > 0) {
    const failed = checks.filter(isFailedCheck);
    const newlyFailed = failed.filter((check) => !failedChecks.includes(check.name));
    if (newlyFailed.length > 0) changes.push({ kind: 'checks_failed', failed: newlyFailed });
    failedChecks = failed.map((check) => check.name);

    const required = checks.filter((check) => check.required === true);
    const gate = required.length > 0 ? required : checks;
    const passedNow = gate.every((check) => check.status !== 'pending' && !isFailedCheck(check));
    const gateNames = gate.map((check) => check.name);
    const told = passed && passedChecks.length === 0 ? gateNames : passedChecks;
    const gateGrew = required.length > 0 && gateNames.some((name) => !told.includes(name));
    if (passedNow && (!passed || gateGrew)) {
      changes.push({ kind: 'checks_passed', count: gate.length, required: required.length > 0 });
    }
    passed = passedNow;
    passedChecks = passedNow ? gateNames : [];
  }
  return { changes, failedChecks, passed, passedChecks };
}

function evaluateRemarks(
  watch: PullRequestWatch,
  remarks: PullRequestRemark[] | null,
  viewer: string | null
) {
  const own = viewer?.toLowerCase();
  const through = Date.parse(watch.remarksThrough);
  const fresh = (remarks ?? []).filter((remark) => {
    const at = Date.parse(resolveRemarkTime(remark));
    return (
      (at > through || (at === through && !watch.remarkIds.includes(remark.id))) &&
      remark.author?.toLowerCase() !== own
    );
  });
  const latest = Math.max(through, ...fresh.map((remark) => Date.parse(resolveRemarkTime(remark))));
  const atLatest = fresh.filter((remark) => Date.parse(resolveRemarkTime(remark)) === latest);
  const first = atLatest[0];
  const remarksThrough = latest === through || !first ? watch.remarksThrough : resolveRemarkTime(first);
  const remarkIds = [...(latest === through ? watch.remarkIds : []), ...atLatest.map((remark) => remark.id)];
  return { fresh, remarksThrough, remarkIds };
}

export function evaluatePullRequestWatch(
  watch: PullRequestWatch,
  pullRequest: PullRequest,
  remarks: PullRequestRemark[] | null,
  viewer: string | null,
  ci: PullRequestCi | null = null
): PullRequestWatchReport {
  const headSha = pullRequest.headSha ?? null;
  const headMoved = headSha !== watch.headSha;
  const checks = evaluateChecks(watch, pullRequest.checkRuns ?? [], headMoved);
  const read = evaluateRemarks(watch, remarks, viewer);
  const changes = [...checks.changes];
  if (read.fresh.length > 0) changes.push({ kind: 'remarks', remarks: read.fresh });
  if (pullRequest.mergeable === false && !watch.conflicting) changes.push({ kind: 'conflicting' });
  const conflicting = pullRequest.mergeable === null ? watch.conflicting : pullRequest.mergeable === false;
  const ciAbsent = pullRequest.checks === 'none' && ((!headMoved && watch.ciAbsent) || isCiAbsent(ci));

  const commentsOnly = changes.length > 0 && changes.every((change) => change.kind === 'remarks');
  const progress = headMoved || (changes.length > 0 && !commentsOnly);
  const wakes = (progress ? 0 : watch.wakes) + (commentsOnly ? 1 : 0);
  return {
    changes,
    next: {
      startedAt: watch.startedAt,
      headSha,
      failedChecks: checks.failedChecks,
      passed: checks.passed,
      passedChecks: checks.passedChecks,
      remarksThrough: read.remarksThrough,
      remarkIds: read.remarkIds,
      conflicting,
      wakes,
      stopped: watch.stopped,
      ciAbsent,
    },
    exhausted: commentsOnly && wakes >= PULL_REQUEST_WATCH_WAKE_LIMIT,
  };
}

function joinList(values: string[]) {
  return values.join('\n');
}

export function isSamePullRequestWatch(left: PullRequestWatch, right: PullRequestWatch) {
  return (
    left.startedAt === right.startedAt &&
    left.headSha === right.headSha &&
    joinList(left.failedChecks) === joinList(right.failedChecks) &&
    left.passed === right.passed &&
    joinList(left.passedChecks) === joinList(right.passedChecks) &&
    left.remarksThrough === right.remarksThrough &&
    joinList(left.remarkIds) === joinList(right.remarkIds) &&
    left.conflicting === right.conflicting &&
    left.wakes === right.wakes &&
    left.stopped === right.stopped &&
    left.ciAbsent === right.ciAbsent
  );
}

function resolveSnippet(body: string) {
  const text = body
    .replaceAll(/<!--[\s\S]*?-->/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
  return text.length <= SNIPPET_LENGTH ? text : `${text.slice(0, SNIPPET_LENGTH - 3)}...`;
}

export function trimWatchChanges(changes: PullRequestWatchChange[]): PullRequestWatchChange[] {
  return changes.map((change) => {
    if (change.kind === 'checks_failed') {
      return {
        kind: 'checks_failed',
        failed: change.failed.slice(0, LISTED_WATCH_ITEMS),
        total: change.failed.length,
      };
    }
    if (change.kind !== 'remarks') return change;
    return {
      kind: 'remarks',
      remarks: change.remarks
        .slice(0, LISTED_WATCH_ITEMS)
        .map((remark) => ({ ...remark, body: resolveSnippet(remark.body) })),
      total: change.remarks.length,
    };
  });
}

export function hasFixableChange(changes: PullRequestWatchChange[]) {
  return changes.some((change) => change.kind !== 'checks_passed');
}

function isUnnamed(pullRequest: PullRequest) {
  const checksUnnamed = !pullRequest.checkRuns && pullRequest.checks === 'failing';
  const threadsUnnamed = !pullRequest.unresolvedThreads && pullRequest.unresolvedComments > 0;
  return checksUnnamed || threadsUnnamed;
}

function resolveSignatureParts(pullRequest: PullRequest, watch: PullRequestWatch) {
  const checks = (pullRequest.checkRuns ?? []).filter(isFailedCheck).map((check) => `check:${check.name}`);
  const threads = (pullRequest.unresolvedThreads ?? []).map((id) => `thread:${id}`);
  const conflict = watch.conflicting || pullRequest.mergeable === false ? 'conflict' : '';
  return [...checks, ...threads, conflict].filter(Boolean);
}

export function resolvePullRequestSignature(pullRequest: PullRequest, watch: PullRequestWatch) {
  if (isUnnamed(pullRequest)) return null;
  const parts = resolveSignatureParts(pullRequest, watch);
  if (parts.length === 0) return null;
  return [...new Set(parts)].sort().join('\n');
}

function resolvePullRequestShape(pullRequest: PullRequest) {
  return JSON.stringify([
    pullRequest.number,
    pullRequest.url,
    pullRequest.base ?? null,
    pullRequest.state,
    pullRequest.checks,
    pullRequest.unresolvedComments,
    pullRequest.mergeable,
    pullRequest.headSha ?? null,
    pullRequest.checkRuns ?? null,
    pullRequest.unresolvedThreads ?? null,
    pullRequest.mergeQueue ?? null,
    pullRequest.queueRemoval ?? null,
  ]);
}

export function isSamePullRequest(left: PullRequest | null, right: PullRequest) {
  return left !== null && resolvePullRequestShape(left) === resolvePullRequestShape(right);
}
