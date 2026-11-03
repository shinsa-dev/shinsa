import {
  DomainError,
  ONBOARDING_REQUEST_LIMIT,
  type OnboardingProjectChoice,
  PROJECT_COLORS,
  PROJECT_LIMITS,
  type Project,
  type ProjectSuggestion,
  resolveProjectKey,
} from '@shinsa/core';
import { Effect, Option, Schema } from 'effect';
import {
  MAX_TURNS,
  REPLY_LIMIT,
  REVISE_SCHEMA,
  REVISE_SYSTEM,
  RevisionAnswer,
  type RevisionAsk,
} from './revise/schema.ts';
import type { ProjectRevision, RevisedProject } from './schema.ts';

function listAllRepos(suggestions: ProjectSuggestion[]) {
  return suggestions.flatMap((suggestion) => suggestion.repos);
}

function hasSameRepos(suggestion: ProjectSuggestion, repos: string[]) {
  if (suggestion.repos.length !== repos.length) return false;
  return suggestion.repos.every((repo) => repos.includes(repo.path));
}

export function applyRevision(
  suggestions: ProjectSuggestion[],
  revision: ProjectRevision | null,
  projects: Project[]
): ProjectSuggestion[] {
  if (!revision) return suggestions;
  const known = new Map(listAllRepos(suggestions).map((repo) => [repo.path, repo]));
  const existing = new Map(projects.map((project) => [project.name.toLowerCase(), project]));
  const kept = revision.projects.map((revised) =>
    suggestions.find((suggestion) => hasSameRepos(suggestion, revised.repos))
  );
  const taken = [
    ...projects.map((project) => project.key),
    ...kept.flatMap((suggestion) => (suggestion ? [suggestion.key] : [])),
  ];
  const changed = revision.projects.flatMap((revised, index) => {
    const repos = revised.repos.flatMap((path) => known.get(path) ?? []);
    if (repos.length === 0) return [];
    const same = kept[index];
    if (same) return [{ ...same, name: revised.name }];
    const project = existing.get(revised.name.toLowerCase()) ?? null;
    const key = project?.key ?? resolveProjectKey(revised.name, taken);
    taken.push(key);
    return [
      {
        id: `revised:${index}`,
        name: project?.name ?? revised.name,
        key,
        color: project?.color ?? (PROJECT_COLORS[index % PROJECT_COLORS.length] as string),
        projectId: project?.id ?? null,
        folders: [],
        repos,
      },
    ];
  });
  return [...changed, ...placeUnseen(suggestions, new Set(revision.seen), changed, taken)];
}

function placeUnseen(
  suggestions: ProjectSuggestion[],
  seen: Set<string>,
  changed: ProjectSuggestion[],
  taken: string[]
) {
  return suggestions.flatMap((suggestion) => {
    const repos = suggestion.repos.filter((repo) => !seen.has(repo.path));
    if (repos.length === 0) return [];
    const siblings = new Set(suggestion.repos.map((repo) => repo.path));
    const home = changed.find((project) => project.repos.some((repo) => siblings.has(repo.path)));
    if (home) {
      home.repos = [...home.repos, ...repos];
      home.folders = [];
      return [];
    }
    const key = taken.includes(suggestion.key) ? resolveProjectKey(suggestion.name, taken) : suggestion.key;
    taken.push(key);
    return [{ ...suggestion, key, repos, folders: [] }];
  });
}

function resolveBase(suggestions: ProjectSuggestion[], choices: OnboardingProjectChoice[] | undefined) {
  if (choices === undefined) {
    return suggestions.map((entry) => ({ name: entry.name, repos: entry.repos.map((repo) => repo.path) }));
  }
  return choices.flatMap((choice) => {
    const suggestion = suggestions.find((entry) => entry.id === choice.id);
    if (!suggestion) return [];
    const repos = suggestion.repos.flatMap((repo) => (choice.repos.includes(repo.path) ? [repo.path] : []));
    return [{ name: choice.name.trim() || suggestion.name, repos }];
  });
}

function serializePrompt(suggestions: ProjectSuggestion[], base: RevisedProject[], text: string) {
  const repos = listAllRepos(suggestions);
  const ids = new Map(repos.map((repo, index) => [repo.path, `r${index + 1}`]));
  return {
    ids,
    prompt: JSON.stringify({
      request: text,
      repositories: repos.map((repo) => ({ id: ids.get(repo.path), name: repo.name, path: repo.path })),
      projects: base.map((project) => ({
        name: project.name,
        repos: project.repos.map((path) => ids.get(path)),
      })),
    }),
  };
}

const decodeAnswer = Schema.decodeUnknownOption(RevisionAnswer);

function resolveRevisedProjects(answer: RevisionAnswer, ids: Map<string, string>) {
  const paths = new Map([...ids].map(([path, id]) => [id, path]));
  const used = new Set<string>();
  return answer.projects.flatMap((entry): RevisedProject[] => {
    const name = entry.name.trim().slice(0, PROJECT_LIMITS.name);
    const repos = entry.repos.flatMap((id) => {
      const path = typeof id === 'string' ? paths.get(id) : undefined;
      if (!path || used.has(path)) return [];
      used.add(path);
      return [path];
    });
    return name.length > 0 && repos.length > 0 ? [{ name, repos }] : [];
  });
}

export const requestRevision = Effect.fn('Onboarding.requestRevision')(function* (
  ask: RevisionAsk,
  suggestions: ProjectSuggestion[],
  revision: ProjectRevision | null,
  text: string,
  choices: OnboardingProjectChoice[] | undefined
) {
  const request = text.trim();
  if (request.length === 0) {
    return yield* new DomainError({
      code: 'request_empty',
      message: 'Say what to change about the projects.',
    });
  }
  if (request.length > ONBOARDING_REQUEST_LIMIT) {
    return yield* new DomainError({
      code: 'request_invalid',
      message: `Keep it to ${ONBOARDING_REQUEST_LIMIT} characters.`,
    });
  }
  const { ids, prompt } = serializePrompt(suggestions, resolveBase(suggestions, choices), request);
  const answer = decodeAnswer(yield* ask(REVISE_SYSTEM, prompt, REVISE_SCHEMA));
  if (Option.isNone(answer)) {
    return yield* new DomainError({ code: 'revision_failed', message: 'Couldn’t reach a model. Try again.' });
  }
  const reply = answer.value.reply.trim().slice(0, REPLY_LIMIT);
  const turns = [...(revision?.turns ?? []), { request, reply }].slice(-MAX_TURNS);
  const seen = new Set([...(revision?.seen ?? []), ...listAllRepos(suggestions).map((repo) => repo.path)]);
  const revised: ProjectRevision = {
    projects: resolveRevisedProjects(answer.value, ids),
    seen: [...seen],
    turns,
  };
  return revised;
});
