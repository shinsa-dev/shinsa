import {
  type AccountsSnapshot,
  DomainError,
  type Focus,
  type Gate,
  type MergeStepView,
  type Project,
  type Repo,
  type RunAccount,
  type Watchdog,
} from '@shinsa/core';
import type { resolveTaskView } from '../http/reads.ts';
import type { SurfaceClient } from './client.ts';
import { encode } from './spec.ts';

export type TaskView = ReturnType<typeof resolveTaskView>;

export interface ProjectView extends Project {
  repos: { id: string; name: string; path: string }[];
}

export interface ProjectsRead {
  projects: ProjectView[];
  focus: Focus;
}

export interface TaskDetail {
  task: TaskView;
  gates: Gate[];
  mergeSteps: MergeStepView[];
  watchdogs: Watchdog[];
  text: string;
  suggestions: { id: string; title: string; why: string; status: string; waitsOnThis: boolean }[];
}

export function readTask(client: SurfaceClient, ref: string) {
  return client.read<TaskDetail>(`/api/tasks/${encode(ref)}`);
}

export async function findTaskId(client: SurfaceClient, ref: string) {
  return (await readTask(client, ref)).task.id;
}

export function findTaskIds(client: SurfaceClient, refs: string[]) {
  return Promise.all(refs.map((ref) => findTaskId(client, ref)));
}

export async function findOpenGate(
  client: SurfaceClient,
  ref: string,
  describe: string,
  predicate: (gate: Gate) => boolean
) {
  const detail = await readTask(client, ref);
  const gate = detail.gates.find(predicate);
  if (!gate) {
    throw new DomainError('gate_not_found', `“${detail.task.title}” has no ${describe} waiting.`);
  }
  return gate;
}

export async function findMergeStep(client: SurfaceClient, ref: string, step: string) {
  const detail = await readTask(client, ref);
  const steps = detail.mergeSteps;
  const wanted = step.trim().toLowerCase();
  const found =
    steps[Number(wanted) - 1] ??
    steps.find((candidate) => candidate.key === step || candidate.title.toLowerCase() === wanted);
  if (found) return { taskId: detail.task.id, step: found };
  throw new DomainError(
    'merge_step_not_found',
    steps.length === 0
      ? `“${detail.task.title}” has no steps around the merge.`
      : `“${detail.task.title}” has no step ${step}. \`shinsa tasks show\` lists its steps, numbered from 1.`
  );
}

export async function findWatchdog(client: SurfaceClient, ref: string, watchdog: string) {
  const detail = await readTask(client, ref);
  const watchdogs = detail.watchdogs;
  const wanted = watchdog.trim().toLowerCase();
  const found =
    watchdogs[Number(wanted) - 1] ??
    watchdogs.find((candidate) => candidate.id === watchdog || candidate.title.toLowerCase() === wanted);
  if (found) return { taskId: detail.task.id, watchdog: found };
  throw new DomainError(
    'watchdog_not_found',
    watchdogs.length === 0
      ? `“${detail.task.title}” has no watchdogs.`
      : `“${detail.task.title}” has no watchdog ${watchdog}. \`shinsa tasks show\` lists them, numbered from 1.`
  );
}

export async function findAccount(client: SurfaceClient, ref: string): Promise<RunAccount> {
  const snapshot = await client.read<AccountsSnapshot>('/api/accounts');
  const lower = ref.toLowerCase();
  const account = snapshot.accounts.find(
    (candidate) => candidate.id === ref || candidate.email?.toLowerCase() === lower
  );
  if (!account) {
    throw new DomainError('account_not_found', `No account ${ref}. \`shinsa accounts list\` lists them.`);
  }
  return { id: account.id, email: account.email };
}

export async function findRepoId(client: SurfaceClient, ref: string) {
  const { repos } = await client.read<{ repos: Repo[] }>('/api/repos');
  const repo = repos.find((candidate) => candidate.id === ref || candidate.name === ref);
  if (!repo)
    throw new DomainError('repo_not_found', `No repository ${ref}. \`shinsa repos list\` lists them.`);
  return repo.id;
}

export function selectProject(projects: ProjectView[], ref: string) {
  const lower = ref.trim().toLowerCase();
  return (
    projects.find(
      (candidate) =>
        candidate.id === ref ||
        candidate.key.toLowerCase() === lower ||
        candidate.name.toLowerCase() === lower
    ) ?? null
  );
}

export async function findProject(client: SurfaceClient, ref: string) {
  const { projects } = await client.read<ProjectsRead>('/api/projects');
  const project = selectProject(projects, ref);
  if (!project) {
    throw new DomainError('project_not_found', `No project ${ref}. \`shinsa projects list\` lists them.`);
  }
  return project;
}

export async function findProjectId(client: SurfaceClient, ref: string) {
  return (await findProject(client, ref)).id;
}

export async function resolveOptionalAccount(client: SurfaceClient, ref: string) {
  if (!ref) return null;
  return await findAccount(client, ref);
}

export async function resolveOptionalRepoId(client: SurfaceClient, ref: string) {
  if (!ref) return null;
  return await findRepoId(client, ref);
}

export async function resolveOptionalProjectId(client: SurfaceClient, ref: string) {
  if (!ref) return null;
  return await findProjectId(client, ref);
}
