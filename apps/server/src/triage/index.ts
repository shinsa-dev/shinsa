import { isTaskSettled, type ShinsaState, type Task, type TaskSize } from '@shinsa/core';
import { type QuickJson, requestQuickJson } from '../agents/quick/index.ts';
import { slugify } from '../git/index.ts';
import { type LocalRepo, resolveContainingRepo } from '../repos/index.ts';

export interface TriageResult {
  title: string;
  repoPath: string;
  size: TaskSize;
  branch: string;
  dependsOn: Task[];
}

interface TriageAnswer {
  title?: unknown;
  repo?: unknown;
  size?: unknown;
  branch?: unknown;
  depends_on?: unknown;
}

const TRIAGE_SYSTEM = [
  'You route a coding request to a repository on the developer’s machine and size it.',
  'Return {"title": string, "repo": string, "size": "small" | "large", "branch": string, "depends_on": string[]}.',
  'title: what will be done, imperative, sentence case, at most 60 characters, no trailing period.',
  'repo: the exact name of the repository the work belongs in. Prefer repositories with recent Shinsa work.',
  'size: "large" when the work needs an agreed spec first: a new feature, a change across several areas, a UI flow, the data model, or anything ambiguous.',
  '"small" when it is a contained fix or change with an obvious approach.',
  'branch: <type>/<short-kebab-slug>, type one of feat, fix, chore, refactor, docs.',
  'depends_on: the ids of the open tasks that must be finished before this one can start, often none ([]).',
  'Name a task only when this request clearly needs its work to exist first: it extends, uses or changes what that task builds. Related but independent work is left out; it runs in parallel.',
].join('\n');

const LARGE_HINT =
  /\b(rework|redesign|rewrite|migrate|architecture|new feature|build out|overhaul|refactor the|spec)\b/i;

function resolveFallbackSize(task: Task): TaskSize {
  return task.specFirst || task.intent.length > 500 || LARGE_HINT.test(task.intent) ? 'large' : 'small';
}

function listCandidates(state: ShinsaState, local: LocalRepo[]) {
  const used = new Map<string, number>();
  for (const task of Object.values(state.tasks)) {
    const repo = task.repoId ? state.repos[task.repoId] : undefined;
    if (repo) used.set(repo.path, Math.max(used.get(repo.path) ?? 0, task.updatedAt));
  }
  const byPath = new Map(local.map((repo) => [repo.path, repo]));
  for (const repo of Object.values(state.repos)) {
    if (!byPath.has(repo.path)) byPath.set(repo.path, { path: repo.path, name: repo.name, touchedAt: 0 });
  }
  return [...byPath.values()].sort(
    (a, b) => (used.get(b.path) ?? 0) - (used.get(a.path) ?? 0) || b.touchedAt - a.touchedAt
  );
}

export type TriageResolver = (
  state: ShinsaState,
  task: Task,
  local: LocalRepo[]
) => Promise<TriageResult | null>;

export async function resolveTriage(
  state: ShinsaState,
  task: Task,
  local: LocalRepo[],
  ask: QuickJson = requestQuickJson
): Promise<TriageResult | null> {
  const pinned = task.repoId ? state.repos[task.repoId] : undefined;
  const origin = resolveContainingRepo(task.origin, local);
  const candidates = pinned
    ? [{ path: pinned.path, name: pinned.name, touchedAt: 0 }]
    : origin
      ? [origin]
      : listCandidates(state, local);
  const first = candidates[0];
  if (!first) return null;
  const size = resolveFallbackSize(task);
  const fallbackTitle = task.intent.split('\n')[0]?.slice(0, 60).trim() || 'Untitled task';
  const fallback: TriageResult = {
    title: fallbackTitle,
    repoPath: first.path,
    size,
    branch: `${size === 'large' ? 'feat' : 'fix'}/${slugify(fallbackTitle)}`,
    dependsOn: [],
  };
  const open = Object.values(state.tasks).filter(
    (candidate) => candidate.id !== task.id && !isTaskSettled(candidate)
  );
  const prompt = [
    'Open tasks (not finished yet):',
    ...open.map(
      (candidate) =>
        `- ${candidate.id}: ${candidate.title} (${state.repos[candidate.repoId ?? '']?.name ?? '?'})`
    ),
    open.length === 0 ? '(none)' : '',
    '',
    'Repositories, most recently worked on first:',
    ...candidates.map((candidate) => `- ${candidate.name}`),
    '',
    'Request:',
    task.intent,
  ].join('\n');
  const answer = await ask<TriageAnswer>(TRIAGE_SYSTEM, prompt);
  if (!answer) return fallback;
  const repo = candidates.find((candidate) => candidate.name === answer.repo) ?? first;
  const title =
    typeof answer.title === 'string' && answer.title.trim()
      ? answer.title.trim().slice(0, 80)
      : fallbackTitle;
  const branch =
    typeof answer.branch === 'string' && /^[a-z]+\/[a-z0-9-]+$/.test(answer.branch)
      ? answer.branch
      : fallback.branch;
  const named = new Set([answer.depends_on].flat().filter((id): id is string => typeof id === 'string'));
  const dependsOn = open.filter(
    (candidate) =>
      named.has(candidate.id) &&
      (candidate.repoId === null || state.repos[candidate.repoId]?.path === repo.path)
  );
  return {
    title,
    repoPath: repo.path,
    size: answer.size === 'large' || size === 'large' ? 'large' : 'small',
    branch,
    dependsOn,
  };
}
