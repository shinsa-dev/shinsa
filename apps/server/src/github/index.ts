import type { ChecksState, PullRequest, Repo, Settings, Task } from '@shinsa/core';
import { assertRefName } from '../git/index.ts';
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
  statusCheckRollup: CheckEntry[] | null;
}

export const GITHUB_TIMEOUT_MS = 60_000;

const FAILED = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);

const PENDING = new Set(['PENDING', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED', 'EXPECTED']);

const MERGE_METHODS = new Set<Settings['mergeMethod']>(['squash', 'merge', 'rebase']);

const UNRESOLVED_THREADS_QUERY =
  'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved isOutdated}}}}}';

const PULL_REQUEST_FIELDS =
  'number,url,state,mergeable,reviewDecision,baseRefName,headRefOid,statusCheckRollup';

function runGh(args: string[], cwd: string, input?: string) {
  return runCommand(['gh', ...args], cwd, { input, timeoutMs: GITHUB_TIMEOUT_MS });
}

function runGhOrThrow(args: string[], cwd: string, input?: string) {
  return runCommandOrThrow(['gh', ...args], cwd, { input, timeoutMs: GITHUB_TIMEOUT_MS });
}

export function resolveChecks(entries: CheckEntry[] | null): ChecksState {
  if (!entries || entries.length === 0) return 'none';
  const outcomes = entries.map((entry) => entry.conclusion || entry.state || entry.status || '');
  if (outcomes.some((outcome) => FAILED.has(outcome))) return 'failing';
  if (entries.some((entry) => PENDING.has(entry.status ?? '') || PENDING.has(entry.state ?? '')))
    return 'pending';
  return 'passing';
}

export function resolveRepoSlug(repo: Repo) {
  const [owner, name] = repo.remote?.split('/').slice(-2) ?? [];
  if (!owner || !name) return null;
  return { owner, name };
}

async function countUnresolvedThreads(repo: Repo, number: number) {
  const slug = resolveRepoSlug(repo);
  if (!slug) return 0;
  const result = await runGh(
    [
      'api',
      'graphql',
      '-f',
      `query=${UNRESOLVED_THREADS_QUERY}`,
      '-f',
      `owner=${slug.owner}`,
      '-f',
      `name=${slug.name}`,
      '-F',
      `number=${number}`,
      '--jq',
      '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false and .isOutdated == false)] | length',
    ],
    repo.path
  );
  return result.ok ? Number(result.stdout) || 0 : 0;
}

export function serializePullRequest(view: PullRequestView, unresolved: number, now: number): PullRequest {
  return {
    number: view.number,
    url: view.url,
    base: view.baseRefName,
    state: view.state === 'MERGED' ? 'merged' : view.state === 'CLOSED' ? 'closed' : 'open',
    checks: resolveChecks(view.statusCheckRollup),
    unresolvedComments:
      unresolved + (view.reviewDecision === 'CHANGES_REQUESTED' && unresolved === 0 ? 1 : 0),
    mergeable: view.mergeable === 'MERGEABLE' ? true : view.mergeable === 'CONFLICTING' ? false : null,
    headSha: view.headRefOid ?? null,
    updatedAt: now,
  };
}

export async function selectPullRequest(repo: Repo, task: Task): Promise<PullRequest | null> {
  const target = task.pullRequest ? String(task.pullRequest.number) : task.branch;
  if (!target) return null;
  const result = await runGh(['pr', 'view', assertRefName(target), '--json', PULL_REQUEST_FIELDS], repo.path);
  if (!result.ok) return null;
  const view = JSON.parse(result.stdout) as PullRequestView;
  const unresolved = await countUnresolvedThreads(repo, view.number);
  return serializePullRequest(view, unresolved, Date.now());
}

export function serializePullRequestBody(task: Task) {
  return [
    task.summary ?? '',
    task.spec ? `\n<details><summary>Spec</summary>\n\n${task.spec.body}\n</details>` : '',
  ]
    .join('\n')
    .trim();
}

export async function createPullRequest(repo: Repo, task: Task, baseBranch: string | null) {
  if (!task.branch || !task.worktreePath)
    throw new Error('The task has no branch to open a pull request from.');
  const existing = await selectPullRequest(repo, task);
  if (existing?.state === 'open') return existing;
  await runGhOrThrow(
    [
      'pr',
      'create',
      '--head',
      assertRefName(task.branch),
      '--base',
      assertRefName(baseBranch ?? repo.defaultBranch),
      '--title',
      task.title,
      '--body-file',
      '-',
    ],
    task.worktreePath,
    serializePullRequestBody(task)
  );
  return selectPullRequest(repo, task);
}

export async function retargetPullRequest(repo: Repo, number: number, base: string) {
  await runGhOrThrow(['pr', 'edit', String(number), '--base', assertRefName(base)], repo.path);
}

export async function mergePullRequest(repo: Repo, number: number, method: Settings['mergeMethod']) {
  if (!MERGE_METHODS.has(method)) throw new Error(`"${method}" is not a merge method.`);
  await runGhOrThrow(['pr', 'merge', String(number), `--${method}`], repo.path);
}
