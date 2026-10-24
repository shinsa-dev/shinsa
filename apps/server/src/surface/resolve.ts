import {
  type AccountsSnapshot,
  DomainError,
  type Focus,
  type Gate,
  type Project,
  type Repo,
  type RunAccount,
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
