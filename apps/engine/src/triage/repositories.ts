import {
  listProjectRepos,
  resolveTaskProject,
  type ShinsaState,
  selectFolderProject,
  type Task,
} from '@shinsa/core';
import { type LocalRepo, listLocalRepos } from '../repos/index.ts';
import { type CandidatePool, NO_REPOSITORY } from './schema.ts';

export function resolveRepoProperty(candidates: LocalRepo[], optional: boolean) {
  return {
    type: 'string',
    enum: [...candidates.map((candidate) => candidate.name), ...(optional ? [NO_REPOSITORY] : [])],
  };
}

export function describeRepoCandidates(candidates: LocalRepo[]) {
  return [
    'Repositories:',
    ...(candidates.length > 0
      ? candidates.map((candidate) => `- ${candidate.name}: ${candidate.path}`)
      : ['(none)']),
  ];
}

export function parseRepoAnswer(candidates: LocalRepo[], value: unknown, optional: boolean) {
  if (optional && value === NO_REPOSITORY) return null;
  return candidates.find((candidate) => candidate.name === value)?.path;
}

function listCandidates(state: ShinsaState, local: LocalRepo[], registered = Object.values(state.repos)) {
  const byPath = new Map(local.map((repo) => [repo.path, repo]));
  for (const repo of registered) {
    if (!byPath.has(repo.path)) byPath.set(repo.path, { path: repo.path, name: repo.name, touchedAt: 0 });
  }
  return [...byPath.values()].sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}

function resolveWords(text: string) {
  return ` ${text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;
}

function isRepoNamed(text: string, name: string) {
  const words = resolveWords(name);
  return words.trim() !== '' && resolveWords(text).includes(words);
}

export function resolveCandidatePool(
  state: ShinsaState,
  task: Task,
  local: LocalRepo[],
  text = task.request
): CandidatePool {
  const projectId = resolveTaskProject(state, task);
  const project = projectId ? (state.projects[projectId] ?? null) : null;
  const everywhere = listCandidates(state, local);
  if (!project) return { project: null, candidates: everywhere, named: [], empty: false, outside: [] };
  const candidates = listCandidates(
    state,
    listLocalRepos(project.folders),
    listProjectRepos(state, project.id)
  );
  if (candidates.length === 0) {
    return { project, candidates: everywhere, named: [], empty: true, outside: [] };
  }
  const inside = new Set(candidates.map((candidate) => candidate.path));
  const rest = everywhere.filter((candidate) => !inside.has(candidate.path));
  const named = rest.filter((candidate) => isRepoNamed(text, candidate.name));
  const outside = rest
    .filter((candidate) => !isRepoNamed(text, candidate.name))
    .map((candidate) => candidate.name);
  return { project, candidates, named, empty: false, outside: [...new Set(outside)] };
}

export function listOfferedRepos(pool: CandidatePool) {
  return [...pool.candidates, ...pool.named];
}

export function resolveRepoProject(state: ShinsaState, task: Task, path: string) {
  const folder = selectFolderProject(Object.values(state.projects), path);
  if (folder) return folder.id;
  const pool = resolveCandidatePool(state, task, []);
  return pool.project && pool.empty ? pool.project.id : null;
}

export function describeProject(pool: CandidatePool) {
  if (!pool.project) return [];
  return [
    'Project:',
    `- name: ${pool.project.name}`,
    `- key: ${pool.project.key}`,
    ...(pool.project.description ? [`- description: ${pool.project.description}`] : []),
    ...(pool.empty
      ? ['The project has no repository yet, so every repository on the machine is offered.']
      : []),
    ...(pool.named.length > 0
      ? [
          `Repositories outside this project, offered because the request names them: ${pool.named.map((candidate) => candidate.name).join(', ')}. Pick one only for the work the request names it for; the task stays in this project.`,
        ]
      : []),
    ...(pool.outside.length > 0
      ? [
          `Other repositories on the machine outside this project, never offered: ${pool.outside.join(', ')}. A request that names one of them gets "${NO_REPOSITORY}".`,
        ]
      : []),
    '',
  ];
}
