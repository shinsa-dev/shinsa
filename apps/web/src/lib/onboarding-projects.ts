import { type OnboardingProjectChoice, type ProjectSuggestion, resolveDisplayPath } from '@shinsa/core';
import { formatCount } from '@/lib/format/count.ts';

export interface ProjectDraft {
  id: string;
  name: string;
  included: boolean;
  excluded: string[];
}

const PREVIEW_REPOS = 3;

export function createProjectDrafts(projects: ProjectSuggestion[]): ProjectDraft[] {
  return projects.map((project) => ({ id: project.id, name: project.name, included: true, excluded: [] }));
}

export function updateProjectDraft(drafts: ProjectDraft[], id: string, patch: Partial<ProjectDraft>) {
  return drafts.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft));
}

export function resolveToggledRepo(draft: ProjectDraft, path: string) {
  const excluded = draft.excluded.includes(path)
    ? draft.excluded.filter((entry) => entry !== path)
    : [...draft.excluded, path];
  return { excluded };
}

function listKeptRepos(project: ProjectSuggestion, draft: ProjectDraft) {
  return project.repos.filter((repo) => !draft.excluded.includes(repo.path));
}

function listKeptDrafts(projects: ProjectSuggestion[], drafts: ProjectDraft[]) {
  return projects.flatMap((project) => {
    const draft = drafts.find((entry) => entry.id === project.id);
    if (!draft?.included) return [];
    const repos = listKeptRepos(project, draft);
    return repos.length === 0 ? [] : [{ project, draft, repos }];
  });
}

export function resolveProjectChoices(
  projects: ProjectSuggestion[],
  drafts: ProjectDraft[]
): OnboardingProjectChoice[] {
  return listKeptDrafts(projects, drafts).map(({ draft, repos }) => ({
    id: draft.id,
    name: draft.name.trim(),
    repos: repos.map((repo) => repo.path),
  }));
}

export function isProjectsReady(projects: ProjectSuggestion[], drafts: ProjectDraft[]) {
  return listKeptDrafts(projects, drafts).every(({ draft }) => draft.name.trim().length > 0);
}

export function describeProjectsSubmit(projects: ProjectSuggestion[], drafts: ProjectDraft[]) {
  const count = listKeptDrafts(projects, drafts).length;
  if (count === 0) return 'Continue without projects';
  return count === 1 ? 'Create the project' : `Create ${count} projects`;
}

function describeRepoPreview(repos: { name: string }[]) {
  const names = repos.slice(0, PREVIEW_REPOS).map((repo) => repo.name);
  const rest = repos.length - names.length;
  if (rest === 0) return names.join(', ');
  return `${names.join(', ')} and ${rest} more`;
}

function describeProjectDetail(project: ProjectSuggestion, draft: ProjectDraft, userHome: string) {
  const kept = listKeptRepos(project, draft).length;
  const total = project.repos.length;
  const count =
    kept === total
      ? formatCount(total, 'repository', 'repositories')
      : `${kept} of ${formatCount(total, 'repository', 'repositories')}`;
  const [folder] = project.folders;
  if (!folder || kept !== total) return count;
  return `${count} · ${resolveDisplayPath(folder, userHome)}`;
}

export function describeProjectSummary(
  project: ProjectSuggestion,
  draft: ProjectDraft,
  userHome: string,
  withPreview: boolean
) {
  const detail = describeProjectDetail(project, draft, userHome);
  return withPreview ? `${detail} · ${describeRepoPreview(project.repos)}` : detail;
}

export function resolveProjectsSignature(projects: ProjectSuggestion[]) {
  return projects.map((project) => `${project.id}:${project.name}:${project.repos.length}`).join('|');
}

export function describeFiledSummary(project: ProjectSuggestion, userHome: string) {
  const [draft] = createProjectDrafts([project]);
  return describeProjectSummary(project, draft as ProjectDraft, userHome, true);
}
