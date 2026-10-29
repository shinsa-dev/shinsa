import {
  DomainError,
  ONBOARDING_REQUEST_LIMIT,
  type OnboardingProjectChoice,
  type OnboardingProjectTurn,
  PROJECT_COLORS,
  PROJECT_LIMITS,
  type Project,
  type ProjectSuggestion,
  resolveProjectKey,
} from '@shinsa/core';
import type { JsonSchema } from '../agents/providers/index.ts';
import type { QuickJson } from '../agents/quick/index.ts';

export interface RevisedProject {
  name: string;
  repos: string[];
}

export interface ProjectRevision {
  projects: RevisedProject[];
  seen: string[];
  turns: OnboardingProjectTurn[];
}

interface RevisionAnswer {
  reply: string;
  projects: RevisedProject[];
}

const MAX_TURNS = 10;

const REPLY_LIMIT = 300;

const REVISE_SYSTEM = [
  'You sort a person’s code repositories into projects while they set up Shinsa, a tool that runs coding agents.',
  'You get the projects as they stand, every repository by id, and what the person asks for.',
  'Return the whole new list of projects, each with a short name and the ids of its repositories.',
  'Change only what the request asks for and keep every other project and repository as it is.',
  'A repository belongs to at most one project. Leave one out only when the request says so.',
  'In reply, tell the person in one short sentence what you changed, or why you could not.',
].join('\n');

const REVISE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    projects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          repos: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'repos'],
      },
    },
  },
  required: ['reply', 'projects'],
};

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

function parseAnswer(value: unknown, ids: Map<string, string>): RevisionAnswer | null {
  const answer = value as { reply?: unknown; projects?: unknown } | null;
  if (!answer || typeof answer.reply !== 'string' || !Array.isArray(answer.projects)) return null;
  const paths = new Map([...ids].map(([path, id]) => [id, path]));
  const used = new Set<string>();
  const projects: RevisedProject[] = [];
  for (const entry of answer.projects as { name?: unknown; repos?: unknown }[]) {
    if (typeof entry?.name !== 'string' || !Array.isArray(entry.repos)) return null;
    const name = entry.name.trim().slice(0, PROJECT_LIMITS.name);
    const repos = entry.repos.flatMap((id) => {
      const path = typeof id === 'string' ? paths.get(id) : undefined;
      if (!path || used.has(path)) return [];
      used.add(path);
      return [path];
    });
    if (name.length > 0 && repos.length > 0) projects.push({ name, repos });
  }
  return { reply: answer.reply.trim().slice(0, REPLY_LIMIT), projects };
}

export async function requestRevision(
  ask: QuickJson,
  suggestions: ProjectSuggestion[],
  revision: ProjectRevision | null,
  text: string,
  choices: OnboardingProjectChoice[] | undefined
): Promise<ProjectRevision> {
  const request = text.trim();
  if (request.length === 0) throw new DomainError('request_empty', 'Say what to change about the projects.');
  if (request.length > ONBOARDING_REQUEST_LIMIT) {
    throw new DomainError(
      'request_invalid',
      `Keep the request to ${ONBOARDING_REQUEST_LIMIT} characters or fewer.`
    );
  }
  const { ids, prompt } = serializePrompt(suggestions, resolveBase(suggestions, choices), request);
  const answer = parseAnswer(await ask<unknown>(REVISE_SYSTEM, prompt, REVISE_SCHEMA), ids);
  if (!answer) {
    throw new DomainError(
      'revision_failed',
      'Shinsa could not reach a model to change the projects. Try again, or edit them by hand.'
    );
  }
  const turns = [...(revision?.turns ?? []), { request, reply: answer.reply }].slice(-MAX_TURNS);
  const seen = new Set([...(revision?.seen ?? []), ...listAllRepos(suggestions).map((repo) => repo.path)]);
  return { projects: answer.projects, seen: [...seen], turns };
}
