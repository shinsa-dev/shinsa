import { DomainError, type Repo, type Task } from '@shinsa/core';
import { decodeText, readGit } from './read.ts';
import { resolveTaskCheckout, resolveTaskRefs } from './task-refs.ts';

function splitPaths(bytes: Uint8Array) {
  return decodeText(bytes).split('\0').filter(Boolean);
}

async function resolveCommittedRange(
  repo: Repo,
  task: Task,
  baseBranch: string | null,
  signal?: AbortSignal
) {
  try {
    return await resolveTaskRefs(repo, task, baseBranch, signal);
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    return null;
  }
}

async function listCommittedFiles(repo: Repo, task: Task, baseBranch: string | null, signal?: AbortSignal) {
  const refs = await resolveCommittedRange(repo, task, baseBranch, signal);
  if (!refs?.base || refs.base === refs.head) return [];
  const read = await readGit(
    ['diff', '--name-only', '-z', '--no-renames', refs.base, refs.head, '--'],
    repo.path,
    { signal }
  );
  if (!read.ok) throw new Error(read.stderr || 'git diff failed.');
  return splitPaths(read.bytes);
}

async function listUncommittedFiles(checkout: string | null, signal?: AbortSignal) {
  if (!checkout) return [];
  const read = await readGit(
    ['status', '--porcelain', '-z', '--untracked-files=all', '--no-renames'],
    checkout,
    { signal }
  );
  if (!read.ok) throw new Error(read.stderr || 'git status failed.');
  return splitPaths(read.bytes).map((entry) => entry.slice(3));
}

export async function listChangedFiles(
  repo: Repo,
  task: Task,
  baseBranch: string | null,
  signal?: AbortSignal
) {
  const committed = await listCommittedFiles(repo, task, baseBranch, signal);
  const uncommitted = await listUncommittedFiles(resolveTaskCheckout(task), signal);
  return [...new Set([...committed, ...uncommitted])].sort();
}
