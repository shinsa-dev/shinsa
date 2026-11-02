import {
  type CiRun,
  type CiState,
  type MergeQueueEntry,
  type MergeQueueState,
  type PullRequest,
  type PullRequestChanges,
  type PullRequestCheckStatus,
  type PullRequestRemark,
  resolveCurrentRound,
  type Task,
} from '@shinsa/core';
import { resolveCommitType, serializeConventionalSubject } from '../../git/conventional.ts';
import {
  CHECK_STATUS,
  type CheckEntry,
  type CommentNode,
  type ContextNode,
  FAILED,
  type Login,
  MEANINGFUL_REVIEWS,
  PENDING,
  type PullRequestDetails,
  type PullRequestDetailsPull,
  type PullRequestView,
  QUEUE_STATES,
  type ReviewNode,
} from './schema.ts';

export function resolveChecks(entries: readonly CheckEntry[] | null): CiState {
  if (!entries || entries.length === 0) return 'none';
  const outcomes = entries.map((entry) => entry.conclusion || entry.state || entry.status || '');
  if (outcomes.some((outcome) => FAILED.has(outcome))) return 'failing';
  if (entries.some((entry) => PENDING.has(entry.status ?? '') || PENDING.has(entry.state ?? '')))
    return 'pending';
  return 'passing';
}

function resolveCheckStatus(node: ContextNode): PullRequestCheckStatus {
  if (node.__typename === 'CheckRun') {
    if (node.status !== 'COMPLETED') return 'pending';
    return CHECK_STATUS[node.conclusion ?? ''] ?? 'neutral';
  }
  return CHECK_STATUS[node.state ?? ''] ?? 'pending';
}

export function resolveCheckRuns(nodes: readonly ContextNode[]): CiRun[] {
  return nodes.map((node) => ({
    name: node.name ?? node.context ?? 'check',
    status: resolveCheckStatus(node),
    required: node.isRequired ?? null,
    url: node.detailsUrl ?? node.targetUrl ?? null,
  }));
}

export function resolveCheckRunsState(checks: readonly CiRun[]): CiState {
  if (checks.length === 0) return 'none';
  if (checks.some((check) => ['failure', 'cancelled', 'action_required'].includes(check.status)))
    return 'failing';
  const required = checks.filter((check) => check.required === true);
  const gate = required.length > 0 ? required : checks;
  return gate.some((check) => check.status === 'pending') ? 'pending' : 'passing';
}

function isBot(author: Login | null) {
  return author?.__typename === 'Bot';
}

function serializeComment(node: CommentNode, path: string | null): PullRequestRemark {
  return {
    id: node.id,
    author: node.author?.login ?? null,
    bot: isBot(node.author),
    createdAt: node.createdAt,
    editedAt: node.lastEditedAt,
    body: node.body,
    path,
    url: node.url,
    reviewState: null,
  };
}

function listReviewRemarks(reviews: readonly ReviewNode[]): PullRequestRemark[] {
  return reviews.flatMap((review) => {
    if (!review.submittedAt || (!review.body.trim() && !MEANINGFUL_REVIEWS.has(review.state))) return [];
    return [
      {
        id: review.id,
        author: review.author?.login ?? null,
        bot: isBot(review.author),
        createdAt: review.submittedAt,
        editedAt: review.lastEditedAt,
        body: review.body,
        path: null,
        url: review.url,
        reviewState: review.state.toLowerCase().replaceAll('_', ' '),
      },
    ];
  });
}

function isCompleteRead(pull: PullRequestDetailsPull) {
  return (
    pull.comments.totalCount <= pull.comments.nodes.length &&
    pull.reviews.totalCount <= pull.reviews.nodes.length &&
    pull.reviewThreads.totalCount <= pull.reviewThreads.nodes.length &&
    pull.reviewThreads.nodes.every((thread) => thread.comments.totalCount <= thread.comments.nodes.length)
  );
}

export function resolveRemarks(details: PullRequestDetails): PullRequestRemark[] | null {
  const pull = details.repository.pullRequest;
  if (!isCompleteRead(pull)) return null;
  const remarks = [
    ...pull.comments.nodes.map((node) => serializeComment(node, null)),
    ...listReviewRemarks(pull.reviews.nodes),
    ...pull.reviewThreads.nodes.flatMap((thread) =>
      thread.comments.nodes.map((node) => serializeComment(node, thread.path))
    ),
  ];
  return remarks.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function resolveMergeQueue(pull: PullRequestDetailsPull): MergeQueueEntry | null {
  const entry = pull.mergeQueueEntry;
  const state = entry?.state.toLowerCase() as MergeQueueState | undefined;
  if (entry && state && QUEUE_STATES.has(state)) return { state, position: entry.position };
  if (pull.autoMergeRequest) return { state: 'auto_merge', position: null };
  return null;
}

function resolveQueueRemoval(pull: PullRequestDetailsPull) {
  const reason = pull.timelineItems.nodes.at(-1)?.reason?.trim();
  if (!reason) return null;
  return /^[A-Z_]+$/.test(reason) ? reason.toLowerCase().replaceAll('_', ' ') : reason;
}

function resolvePullRequestChanges(view: PullRequestView): PullRequestChanges | null {
  const { additions, deletions, changedFiles } = view;
  if (additions === undefined || deletions === undefined || changedFiles === undefined) return null;
  return { additions, deletions, changedFiles };
}

export function serializePullRequest(
  view: PullRequestView,
  details: PullRequestDetails | null,
  now: number
): PullRequest {
  const pull = details?.repository.pullRequest ?? null;
  const threads = (pull?.reviewThreads.nodes ?? []).filter(
    (thread) => !thread.isResolved && !thread.isOutdated
  );
  const unresolved = threads.length;
  const contexts = pull?.commits.nodes.at(-1)?.commit.statusCheckRollup?.contexts.nodes ?? null;
  const checkRuns = contexts ? resolveCheckRuns(contexts) : null;
  return {
    number: view.number,
    url: view.url,
    base: view.baseRefName,
    state: view.state === 'MERGED' ? 'merged' : view.state === 'CLOSED' ? 'closed' : 'open',
    checks: checkRuns ? resolveCheckRunsState(checkRuns) : resolveChecks(view.statusCheckRollup),
    unresolvedComments:
      unresolved + (view.reviewDecision === 'CHANGES_REQUESTED' && unresolved === 0 ? 1 : 0),
    mergeable: view.mergeable === 'MERGEABLE' ? true : view.mergeable === 'CONFLICTING' ? false : null,
    headSha: view.headRefOid ?? null,
    mergeCommit: view.mergeCommit?.oid ?? null,
    changes: resolvePullRequestChanges(view),
    updatedAt: now,
    ...(checkRuns ? { checkRuns } : {}),
    ...(pull
      ? {
          unresolvedThreads: threads.map((thread) => thread.id),
          mergeQueue: resolveMergeQueue(pull),
          queueRemoval: resolveQueueRemoval(pull),
        }
      : {}),
  };
}

export function serializePullRequestTitle(task: Task) {
  return serializeConventionalSubject(resolveCommitType(task.branch), resolveCurrentRound(task).title, null);
}
