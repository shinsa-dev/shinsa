import {
  DomainError,
  type OnboardingProjectChoice,
  PROJECT_LIMITS,
  type ProjectSuggestion,
  resolveProjectSuggestions,
  type ShinsaState,
  type SuggestionRepo,
} from '@shinsa/core';
import { Effect } from 'effect';
import { MAX_SUGGESTED_REPOS, type ProjectSetup } from './projects/schema.ts';
import { applyRevision } from './revise.ts';
import type { ProjectRevision } from './schema.ts';

function isInside(path: string, roots: string[]) {
  return roots.some((root) => path.startsWith(`${root.replace(/\/+$/, '')}/`));
}

const listSuggestionRepos = Effect.fn('Onboarding.listSuggestionRepos')(function* (
  setup: ProjectSetup,
  state: ShinsaState,
  roots: string[]
) {
  const registered = new Map(Object.values(state.repos).map((repo) => [repo.path, repo]));
  const repos = new Map<string, SuggestionRepo>();
  for (const local of yield* setup.listLocal(roots, MAX_SUGGESTED_REPOS)) {
    const repo = registered.get(local.path);
    repos.set(local.path, {
      path: local.path,
      name: local.name,
      remote: repo?.remote ?? (yield* setup.readOrigin(local.path)),
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
});

export const listProjectSuggestions = Effect.fn('Onboarding.listProjectSuggestions')(function* (
  setup: ProjectSetup,
  roots: string[],
  revision: ProjectRevision | null
) {
  const state = yield* setup.state;
  const projects = Object.values(state.projects);
  const repos = yield* listSuggestionRepos(setup, state, roots);
  const suggestions = resolveProjectSuggestions({ roots, repos, login: yield* setup.login, projects });
  return applyRevision(suggestions, revision, projects);
});

export function listFiledProjects(state: ShinsaState, roots: string[]): ProjectSuggestion[] {
  const repos = Object.values(state.repos).filter((repo) => isInside(repo.path, roots));
  return Object.values(state.projects).flatMap((project) => {
    const filed = repos
      .filter((repo) => repo.projectId === project.id)
      .map((repo) => ({ path: repo.path, name: repo.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (filed.length === 0) return [];
    return [
      {
        id: project.id,
        name: project.name,
        key: project.key,
        color: project.color,
        projectId: project.id,
        folders: project.folders,
        repos: filed,
      },
    ];
  });
}

const resolveChoice = Effect.fn('Onboarding.resolveChoice')(function* (
  suggestions: ProjectSuggestion[],
  choice: OnboardingProjectChoice
) {
  const suggestion = suggestions.find((entry) => entry.id === choice.id);
  if (!suggestion) {
    return yield* new DomainError({
      code: 'projects_stale',
      message: 'The suggestions changed. Look again.',
    });
  }
  const name = choice.name.trim();
  if (name.length === 0) {
    return yield* new DomainError({ code: 'project_name_required', message: 'Name every project you keep.' });
  }
  if (name.length > PROJECT_LIMITS.name) {
    return yield* new DomainError({
      code: 'project_invalid',
      message: `Keep the name to ${PROJECT_LIMITS.name} characters.`,
    });
  }
  const repos = suggestion.repos.filter((repo) => choice.repos.includes(repo.path));
  if (repos.length === 0) {
    return yield* new DomainError({ code: 'projects_invalid', message: `Keep a repository in ${name}.` });
  }
  return { suggestion, name, repos };
});

const writeProject = Effect.fn('Onboarding.writeProject')(function* (
  setup: ProjectSetup,
  suggestion: ProjectSuggestion,
  name: string,
  folders: string[],
  commandId: string
) {
  const before = yield* setup.state;
  const existing = suggestion.projectId ? before.projects[suggestion.projectId] : undefined;
  const project = existing
    ? { ...existing, folders: [...existing.folders, ...folders] }
    : { name, color: suggestion.color, key: suggestion.key, folders };
  yield* setup.dispatch({ type: 'project.write', project }, `${commandId}:project:${suggestion.id}`);
  const after = yield* setup.state;
  const written = Object.values(after.projects).find((entry) => entry.key === project.key);
  if (!written) return yield* Effect.die(new Error(`Could not save the project ${name}.`));
  return written.id;
});

export const createChosenProjects = Effect.fn('Onboarding.createChosenProjects')(function* (
  setup: ProjectSetup,
  roots: string[],
  choices: OnboardingProjectChoice[] | undefined,
  commandId: string,
  revision: ProjectRevision | null
) {
  const suggestions = yield* listProjectSuggestions(setup, roots, revision);
  const chosen =
    choices === undefined
      ? suggestions.map((suggestion) => ({ suggestion, name: suggestion.name, repos: suggestion.repos }))
      : yield* Effect.forEach(choices, (choice) => resolveChoice(suggestions, choice));
  for (const { suggestion, name, repos } of chosen) {
    const complete = repos.length === suggestion.repos.length;
    const projectId = yield* writeProject(
      setup,
      suggestion,
      name,
      complete ? suggestion.folders : [],
      commandId
    );
    for (const repo of repos) {
      yield* setup.upsertRepo(projectId, repo.path, `${commandId}:repo:${repo.path}`);
    }
  }
});
