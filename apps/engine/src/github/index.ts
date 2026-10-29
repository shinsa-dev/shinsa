import {
  assembleReport,
  type CiRun,
  type CiState,
  listMergeSteps,
  MERGE_METHODS,
  type MergeQueueEntry,
  type MergeQueueState,
  type PullRequest,
  type PullRequestCheckStatus,
  type PullRequestRemark,
  type Repo,
  resolveCurrentRound,
  type Settings,
  serializeMergeStepsMarkdown,
  serializeTestingMarkdown,
  type Task,
} from '@shinsa/core';
import { assertRefName, resolveCommitType, serializeConventionalSubject } from '../git/index.ts';
import { log } from '../log/index.ts';
import { runCommand, runCommandOrThrow } from '../shell/index.ts';

interface CheckEntry {
  status?: string;
  conclusion?: string;
  state?: string;
}

interface PullRequestView {
  number: number;
  url: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  reviewDecision: string | null;
  baseRefName: string;
  headRefOid?: string;
  mergeCommit?: { oid: string } | null;
  statusCheckRollup: CheckEntry[] | null;
}

interface Login {
  login: string;
}

interface CommentNode {
  id: string;
  author: Login | null;
  createdAt: string;
  lastEditedAt: string | null;
  body: string;
  url: string | null;
}

interface ReviewNode {
  id: string;
  author: Login | null;
  submittedAt: string | null;
  lastEditedAt: string | null;
  state: string;
  body: string;
  url: string | null;
}

interface ThreadNode {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string | null;
  comments: { totalCount: number; nodes: CommentNode[] };
}

interface ContextNode {
  __typename: string;
  name?: string;
  context?: string;
  status?: string;
  conclusion?: string | null;
  state?: string;
  detailsUrl?: string | null;
  targetUrl?: string | null;
  isRequired?: boolean;
}

export interface PullRequestDetails {
  viewer: Login | null;
  repository: {
    pullRequest: {
      author: Login | null;
      mergeQueueEntry: { state: string; position: number | null } | null;
      autoMergeRequest: { enabledAt: string } | null;
      commits: { nodes: { commit: { statusCheckRollup: { contexts: { nodes: ContextNode[] } } | null } }[] };
      comments: { totalCount: number; nodes: CommentNode[] };
      reviews: { totalCount: number; nodes: ReviewNode[] };
      reviewThreads: { totalCount: number; nodes: ThreadNode[] };
      timelineItems: { nodes: { reason?: string | null }[] };
    };
  };
}

export interface PullRequestRead {
  pullRequest: PullRequest;
  remarks: PullRequestRemark[] | null;
  viewer: string | null;
}

export const GITHUB_TIMEOUT_MS = 60_000;

const FAILED = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);

const PENDING = new Set(['PENDING', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED', 'EXPECTED']);

const CHECK_STATUS: Record<string, PullRequestCheckStatus> = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  ERROR: 'failure',
  TIMED_OUT: 'failure',
  STARTUP_FAILURE: 'failure',
  CANCELLED: 'cancelled',
  ACTION_REQUIRED: 'action_required',
  SKIPPED: 'skipped',
  NEUTRAL: 'neutral',
  STALE: 'neutral',
};

const QUEUE_STATES = new Set<MergeQueueState>([
  'queued',
  'awaiting_checks',
  'mergeable',
  'unmergeable',
  'locked',
]);

const MEANINGFUL_REVIEWS = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);

const COMMENT_FIELDS = 'totalCount nodes{id author{login} createdAt lastEditedAt body url}';

const DETAILS_QUERY = `query($owner:String!,$name:String!,$number:Int!){viewer{login} repository(owner:$owner,name:$name){pullRequest(number:$number){author{login} mergeQueueEntry{state position} autoMergeRequest{enabledAt} commits(last:1){nodes{commit{statusCheckRollup{contexts(first:100){nodes{__typename ... on CheckRun{name status conclusion detailsUrl isRequired(pullRequestNumber:$number)} ... on StatusContext{context state targetUrl isRequired(pullRequestNumber:$number)}}}}}}} comments(last:100){${COMMENT_FIELDS}} reviews(last:100){totalCount nodes{id author{login} submittedAt lastEditedAt state body url}} reviewThreads(first:100){totalCount nodes{id isResolved isOutdated path comments(last:50){${COMMENT_FIELDS}}}} timelineItems(last:1,itemTypes:[REMOVED_FROM_MERGE_QUEUE_EVENT]){nodes{... on RemovedFromMergeQueueEvent{reason}}}}}}`;

const PULL_REQUEST_FIELDS =
  'number,url,state,mergeable,reviewDecision,baseRefName,headRefOid,mergeCommit,statusCheckRollup';

const NO_PULL_REQUEST = /no pull requests found/i;

const COMMIT_SHA = /^[0-9a-f]{7,64}$/i;

function assertCommitSha(sha: string) {
  if (!COMMIT_SHA.test(sha)) throw new Error(`"${sha}" is not a commit.`);
  return sha;
}

interface GhOptions {
  input?: string;
  signal?: AbortSignal;
}

function runGh(args: string[], cwd: string, options: GhOptions = {}) {
  return runCommand(['gh', ...args], cwd, { ...options, timeoutMs: GITHUB_TIMEOUT_MS });
}

function runGhOrThrow(args: string[], cwd: string, options: GhOptions = {}) {
  return runCommandOrThrow(['gh', ...args], cwd, { ...options, timeoutMs: GITHUB_TIMEOUT_MS });
}

export function resolveChecks(entries: CheckEntry[] | null): CiState {
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

export function resolveCheckRuns(nodes: ContextNode[]): CiRun[] {
  return nodes.map((node) => ({
    name: node.name ?? node.context ?? 'check',
    status: resolveCheckStatus(node),
    required: node.isRequired ?? null,
    url: node.detailsUrl ?? node.targetUrl ?? null,
  }));
}

export function resolveCheckRunsState(checks: CiRun[]): CiState {
  if (checks.length === 0) return 'none';
  if (checks.some((check) => ['failure', 'cancelled', 'action_required'].includes(check.status)))
    return 'failing';
  const required = checks.filter((check) => check.required === true);
  const gate = required.length > 0 ? required : checks;
  return gate.some((check) => check.status === 'pending') ? 'pending' : 'passing';
}

export function resolveRepoSlug(repo: Repo) {
  const [owner, name] = repo.remote?.split('/').slice(-2) ?? [];
  if (!owner || !name) return null;
  return { owner, name };
}

function serializeComment(node: CommentNode, path: string | null): PullRequestRemark {
  return {
    id: node.id,
    author: node.author?.login ?? null,
    createdAt: node.createdAt,
    editedAt: node.lastEditedAt,
    body: node.body,
    path,
    url: node.url,
    reviewState: null,
  };
}

function listReviewRemarks(reviews: ReviewNode[]): PullRequestRemark[] {
  return reviews.flatMap((review) => {
    if (!review.submittedAt || (!review.body.trim() && !MEANINGFUL_REVIEWS.has(review.state))) return [];
    return [
      {
        id: review.id,
        author: review.author?.login ?? null,
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

function isCompleteRead(pull: PullRequestDetails['repository']['pullRequest']) {
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

function resolveMergeQueue(pull: PullRequestDetails['repository']['pullRequest']): MergeQueueEntry | null {
  const entry = pull.mergeQueueEntry;
  const state = entry?.state.toLowerCase() as MergeQueueState | undefined;
  if (entry && state && QUEUE_STATES.has(state)) return { state, position: entry.position };
  if (pull.autoMergeRequest) return { state: 'auto_merge', position: null };
  return null;
}

function resolveQueueRemoval(pull: PullRequestDetails['repository']['pullRequest']) {
  const reason = pull.timelineItems.nodes.at(-1)?.reason?.trim();
  if (!reason) return null;
  return /^[A-Z_]+$/.test(reason) ? reason.toLowerCase().replaceAll('_', ' ') : reason;
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

async function readDetails(
  repo: Repo,
  number: number,
  signal?: AbortSignal
): Promise<PullRequestDetails | null> {
  const slug = resolveRepoSlug(repo);
  if (!slug) {
    log.warn(
      '[GitHub] The repository has no GitHub remote, so the pull request is read without its checks and threads',
      {
        repo: repo.name,
        number,
      }
    );
    return null;
  }
  const output = await runGhOrThrow(
    [
      'api',
      'graphql',
      '-f',
      `query=${DETAILS_QUERY}`,
      '-f',
      `owner=${slug.owner}`,
      '-f',
      `name=${slug.name}`,
      '-F',
      `number=${number}`,
      '--jq',
      '.data',
    ],
    repo.path,
    { signal }
  );
  return JSON.parse(output) as PullRequestDetails;
}

async function readView(repo: Repo, target: string, signal?: AbortSignal): Promise<PullRequestView | null> {
  const result = await runGh(
    ['pr', 'view', assertRefName(target), '--json', PULL_REQUEST_FIELDS],
    repo.path,
    {
      signal,
    }
  );
  if (!result.ok && NO_PULL_REQUEST.test(result.stderr)) return null;
  if (!result.ok) throw new Error(`gh pr view failed: ${result.stderr || `exit ${result.code}`}`);
  return JSON.parse(result.stdout) as PullRequestView;
}

async function readTarget(repo: Repo, target: string, signal?: AbortSignal): Promise<PullRequestRead | null> {
  const view = await readView(repo, target, signal);
  if (!view) return null;
  const details = await readDetails(repo, view.number, signal);
  return {
    pullRequest: serializePullRequest(view, details, Date.now()),
    remarks: details ? resolveRemarks(details) : null,
    viewer: details?.viewer?.login ?? details?.repository.pullRequest.author?.login ?? null,
  };
}

export function readPullRequest(repo: Repo, task: Task, signal?: AbortSignal) {
  const target = task.pullRequest ? String(task.pullRequest.number) : task.branch;
  if (!target) return Promise.resolve(null);
  return readTarget(repo, target, signal);
}

export function readStackedPullRequest(repo: Repo, number: number, signal?: AbortSignal) {
  return readTarget(repo, String(number), signal);
}

export function serializePullRequestTitle(task: Task) {
  return serializeConventionalSubject(resolveCommitType(task.branch), resolveCurrentRound(task).title, null);
}

function serializeTaskReference(task: Task) {
  const link = `\`shinsa://task/${task.id}\``;
  return task.handle ? `Shinsa task: ${task.handle}, ${link}` : `Shinsa task: ${link}`;
}

export function serializePullRequestBody(task: Task) {
  const testing = serializeTestingMarkdown(assembleReport(task).walkthrough?.testing);
  const steps = serializeMergeStepsMarkdown(listMergeSteps(task));
  return [
    serializeTaskReference(task),
    task.summary?.trim() ?? '',
    testing,
    steps,
    task.plan ? `<details><summary>Plan</summary>\n\n${task.plan.body}\n</details>` : '',
  ]
    .filter((part) => part.length > 0)
    .join('\n\n');
}

export async function createPullRequest(
  repo: Repo,
  task: Task,
  baseBranch: string | null,
  signal?: AbortSignal
) {
  if (!task.branch || !task.worktreePath)
    throw new Error('The task has no branch to open a pull request from.');
  const existing = await readPullRequest(repo, task, signal);
  if (existing?.pullRequest.state === 'open') return existing;
  signal?.throwIfAborted();
  await runGhOrThrow(
    [
      'pr',
      'create',
      '--head',
      assertRefName(task.branch),
      '--base',
      assertRefName(baseBranch ?? repo.defaultBranch),
      '--title',
      serializePullRequestTitle(task),
      '--body-file',
      '-',
    ],
    task.worktreePath,
    { input: serializePullRequestBody(task), signal }
  );
  return readPullRequest(repo, task, signal);
}

export async function retargetPullRequest(repo: Repo, number: number, base: string, signal?: AbortSignal) {
  await runGhOrThrow(['pr', 'edit', String(number), '--base', assertRefName(base)], repo.path, { signal });
}

async function resolveMergeMessage(
  repo: Repo,
  number: number,
  method: Settings['mergeMethod'],
  signal?: AbortSignal
) {
  if (method === 'rebase') return [];
  const output = await runGhOrThrow(['pr', 'view', String(number), '--json', 'title'], repo.path, { signal });
  const title = (JSON.parse(output) as { title?: string }).title?.trim();
  return title ? ['--subject', `${title} (#${number})`, '--body', ''] : [];
}

export async function mergePullRequest(
  repo: Repo,
  number: number,
  method: Settings['mergeMethod'],
  headSha: string | null,
  signal?: AbortSignal
) {
  if (!MERGE_METHODS.has(method)) throw new Error(`"${method}" is not a merge method.`);
  const guard = headSha ? ['--match-head-commit', assertCommitSha(headSha)] : [];
  const message = await resolveMergeMessage(repo, number, method, signal);
  await runGhOrThrow(['pr', 'merge', String(number), `--${method}`, ...guard, ...message], repo.path, {
    signal,
  });
}
