import { existsSync } from 'node:fs';
import { DomainError, type RefCommit, type Repo, type Task, type TaskRefs } from '@shinsa/core';
import { decodeText, readGit } from './read.ts';

const MAX_COMMITS = 100;

const FIELD = '\u001f';

async function resolveCommit(cwd: string, ref: string, signal?: AbortSignal) {
  const read = await readGit(
    ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`],
    cwd,
    {
      signal,
    }
  );
  return read.ok ? decodeText(read.bytes).trim() : null;
}

async function resolveFirstCommit(cwd: string, refs: (string | null | undefined)[], signal?: AbortSignal) {
  for (const ref of refs) {
    if (!ref) continue;
    const sha = await resolveCommit(cwd, ref, signal);
    if (sha) return sha;
  }
  return null;
}

function listDefaultRefs(repo: Repo) {
  return [`refs/remotes/origin/${repo.defaultBranch}`, `refs/heads/${repo.defaultBranch}`];
}

async function resolveMergeBase(cwd: string, a: string, b: string, signal?: AbortSignal) {
  const read = await readGit(['merge-base', a, b], cwd, { signal });
  return read.ok ? decodeText(read.bytes).trim() : null;
}

async function resolveMergedBase(cwd: string, head: string, target: string, signal?: AbortSignal) {
  const read = await readGit(
    ['rev-list', '--first-parent', '--ancestry-path', '--reverse', `${head}..${target}`],
    cwd,
    { signal }
  );
  const merge = decodeText(read.bytes).split('\n')[0]?.trim();
  if (!read.ok || !merge) return head;
  const before = await resolveCommit(cwd, `${merge}^1`, signal);
  return (before && (await resolveMergeBase(cwd, head, before, signal))) ?? head;
}

async function resolveBase(
  repo: Repo,
  task: Task,
  head: string,
  baseBranch: string | null,
  signal?: AbortSignal
) {
  if (!task.branch) return null;
  const stacked = baseBranch ? [`refs/heads/${baseBranch}`, `refs/remotes/origin/${baseBranch}`] : [];
  const target = await resolveFirstCommit(repo.path, [...stacked, ...listDefaultRefs(repo)], signal);
  if (!target) return null;
  const base = await resolveMergeBase(repo.path, head, target, signal);
  if (base !== head) return base;
  return resolveMergedBase(repo.path, head, target, signal);
}

async function listCommits(cwd: string, base: string | null, head: string, signal?: AbortSignal) {
  if (!base || base === head) return [];
  const read = await readGit(
    [
      'log',
      '-z',
      '--reverse',
      `--max-count=${MAX_COMMITS}`,
      `--format=%H${FIELD}%ct${FIELD}%s`,
      `${base}..${head}`,
    ],
    cwd,
    { signal }
  );
  return decodeText(read.bytes)
    .split('\0')
    .filter(Boolean)
    .map((record): RefCommit => {
      const [sha = '', at = '0', subject = ''] = record.split(FIELD);
      return { sha, at: Number(at) * 1000, subject };
    });
}

async function isDirty(worktree: string | null, signal?: AbortSignal) {
  if (!worktree) return false;
  const read = await readGit(['status', '--porcelain', '-z'], worktree, { signal });
  return read.ok && read.bytes.length > 0;
}

function resolveHead(repo: Repo, task: Task, worktree: string | null, signal?: AbortSignal) {
  if (worktree) return resolveCommit(worktree, 'HEAD', signal);
  const refs = task.branch
    ? [
        `refs/heads/${task.branch}`,
        task.pullRequest?.headSha,
        task.pushedSha,
        `refs/remotes/origin/${task.branch}`,
      ]
    : [...listDefaultRefs(repo), 'HEAD'];
  return resolveFirstCommit(repo.path, refs, signal);
}

export function resolveTaskCheckout(task: Pick<Task, 'workspace' | 'worktreePath'>) {
  if (task.workspace === 'gitbutler' || !task.worktreePath) return null;
  return existsSync(task.worktreePath) ? task.worktreePath : null;
}

export async function resolveTaskRefs(
  repo: Repo,
  task: Task,
  baseBranch: string | null,
  signal?: AbortSignal
): Promise<TaskRefs> {
  const worktree = resolveTaskCheckout(task);
  const head = await resolveHead(repo, task, worktree, signal);
  if (!head)
    throw new DomainError('code_unavailable', 'The code for this task is no longer in the repository.');
  const base = await resolveBase(repo, task, head, baseBranch, signal);
  const dirty = await isDirty(worktree, signal);
  return {
    head,
    base,
    branch: task.branch,
    defaultBranch: repo.defaultBranch,
    working: worktree !== null,
    dirty,
    commits: await listCommits(repo.path, base, head, signal),
  };
}
