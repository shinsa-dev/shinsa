import {
  DomainError,
  type OnboardingProjectChoice,
  PROJECT_LIMITS,
  type ProjectSuggestion,
  resolveProjectSuggestions,
  type SuggestionRepo,
} from '@shinsa/core';
import type { ProjectChanges } from '../projects/routes.ts';
import { type LoginResolver, listLocalRepos, readOriginRemote } from '../repos/index.ts';
import type { Engine } from '../runtime/engine.ts';

export interface ProjectSetup {
  engine: Engine;
  resolveLogin: LoginResolver;
  changes: ProjectChanges;
}

const MAX_SUGGESTED_REPOS = 400;

function isInside(path: string, roots: string[]) {
  return roots.some((root) => path.startsWith(`${root.replace(/\/+$/, '')}/`));
}

function listSuggestionRepos(engine: Engine, roots: string[]): SuggestionRepo[] {
  const registered = new Map(Object.values(engine.state.repos).map((repo) => [repo.path, repo]));
  const repos = new Map<string, SuggestionRepo>();
  for (const local of listLocalRepos(roots, MAX_SUGGESTED_REPOS)) {
    const repo = registered.get(local.path);
    repos.set(local.path, {
      path: local.path,
      name: local.name,
      remote: repo?.remote ?? readOriginRemote(local.path),
      projectId: repo?.projectId ?? null,
    });
  }
  for (const repo of registered.values()) {
    if (repos.has(repo.path) || !isInside(repo.path, roots)) continue;
    repos.set(repo.path, {
      path: repo.path,
      name: repo.name,
      remote: repo.remote,
      projectId: repo.projectId,
    });
  }
  return [...repos.values()];
}

export async function listProjectSuggestions(setup: ProjectSetup, roots: string[]) {
  const { engine } = setup;
  return resolveProjectSuggestions({
    roots,
    repos: listSuggestionRepos(engine, roots),
    login: await setup.resolveLogin(),
    projects: Object.values(engine.state.projects),
  });
}

function resolveChoices(suggestions: ProjectSuggestion[], choices: OnboardingProjectChoice[] | undefined) {
  if (choices === undefined) {
    return suggestions.map((suggestion) => ({ suggestion, name: suggestion.name, repos: suggestion.repos }));
  }
  return choices.map((choice) => {
    const suggestion = suggestions.find((entry) => entry.id === choice.id);
    if (!suggestion) {
      throw new DomainError('projects_stale', 'The suggested projects changed. Look them over again.');
    }
    const name = choice.name.trim();
    if (name.length === 0) throw new DomainError('project_name_required', 'Name every project you keep.');
    if (name.length > PROJECT_LIMITS.name) {
      throw new DomainError(
        'project_invalid',
        `A project name is at most ${PROJECT_LIMITS.name} characters.`
      );
    }
    const repos = suggestion.repos.filter((repo) => choice.repos.includes(repo.path));
    if (repos.length === 0) {
      throw new DomainError('projects_invalid', `Keep at least one repository in ${name}, or leave it out.`);
    }
    return { suggestion, name, repos };
  });
}

async function writeProject(
  setup: ProjectSetup,
  suggestion: ProjectSuggestion,
  name: string,
  folders: string[],
  commandId: string
) {
  const { engine } = setup;
  const existing = suggestion.projectId ? engine.state.projects[suggestion.projectId] : undefined;
  const project = existing
    ? { ...existing, folders: [...existing.folders, ...folders] }
    : { name, color: suggestion.color, key: suggestion.key, folders };
  await engine.dispatch({ type: 'project.write', project }, { id: `${commandId}:project:${suggestion.id}` });
  const written = Object.values(engine.state.projects).find((entry) => entry.key === project.key);
  if (!written) throw new Error(`Could not save the project ${name}.`);
  return written.id;
}

export async function createChosenProjects(
  setup: ProjectSetup,
  roots: string[],
  choices: OnboardingProjectChoice[] | undefined,
  commandId: string
) {
  const suggestions = await listProjectSuggestions(setup, roots);
  const chosen = resolveChoices(suggestions, choices);
  for (const { suggestion, name, repos } of chosen) {
    const complete = repos.length === suggestion.repos.length;
    const folders = complete ? suggestion.folders : [];
    const projectId = await writeProject(setup, suggestion, name, folders, commandId);
    for (const repo of repos) {
      await setup.changes.upsertRepo(projectId, repo.path, { id: `${commandId}:repo:${repo.path}` });
    }
  }
}
