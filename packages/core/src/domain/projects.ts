import { isLaterRound } from './rounds.ts';
import type { Project, Task } from './types.ts';

export const PROJECT_COLORS = ['blue', 'purple', 'green', 'orange', 'pink', 'sky', 'amber', 'red'] as const;

export const PROJECT_LIMITS = { name: 80, description: 1000, folders: 20, folder: 1000 } as const;

export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,5}$/;

export const NO_PROJECT_KEY = 'T';

const HANDLE_PATTERN = /^([A-Za-z][A-Za-z0-9]{0,5})-(\d{1,9})$/;

export function isProjectKey(key: string) {
  return PROJECT_KEY_PATTERN.test(key);
}

function listKeyCandidates(name: string) {
  const words = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => /^[A-Za-z]/.test(word));
  const initials = words.map((word) => word.charAt(0)).join('');
  const first = words[0] ?? 'P';
  const candidates = words.length > 1 ? [initials.slice(0, 4)] : [];
  candidates.push(first.slice(0, 3), first.slice(0, 2));
  return candidates.map((candidate) => candidate.toUpperCase()).filter(isProjectKey);
}

export function resolveProjectKey(name: string, taken: Iterable<string>) {
  const used = new Set(taken);
  const candidates = listKeyCandidates(name);
  const free = candidates.find((candidate) => !used.has(candidate));
  if (free) return free;
  const base = (candidates[0] ?? 'PR').slice(0, 4);
  for (let suffix = 2; ; suffix += 1) {
    const key = `${base.slice(0, 6 - String(suffix).length)}${suffix}`;
    if (!used.has(key)) return key;
  }
}

export function formatTaskHandle(key: string, number: number) {
  return `${key}-${number}`;
}

export function parseTaskHandle(text: string) {
  const match = HANDLE_PATTERN.exec(text.trim());
  if (!match?.[1] || !match[2]) return null;
  return `${match[1].toUpperCase()}-${Number(match[2])}`;
}

function isPathInside(folder: string, path: string) {
  const root = folder.replace(/\/+$/, '');
  return root.length > 0 && (path === root || path.startsWith(`${root}/`));
}

export function selectFolderProject(projects: Iterable<Project>, path: string) {
  let best: Project | null = null;
  let length = 0;
  for (const project of projects) {
    for (const folder of project.folders) {
      if (isPathInside(folder, path) && folder.length > length) {
        best = project;
        length = folder.length;
      }
    }
  }
  return best;
}

export function selectProjectByReference<T extends Pick<Project, 'id' | 'key' | 'name'>>(
  projects: Iterable<T>,
  reference: string
) {
  const lower = reference.trim().toLowerCase();
  for (const project of projects) {
    if (
      project.id === reference ||
      project.key.toLowerCase() === lower ||
      project.name.toLowerCase() === lower
    ) {
      return project;
    }
  }
  return null;
}

export function isProjectFixed(task: Task) {
  return Boolean(task.projectId) && (!task.auto.project || isLaterRound(task));
}

export function resolveRepoMove(task: Task, repo: { projectId?: string | null } | null) {
  if (!repo?.projectId || repo.projectId === task.projectId || isProjectFixed(task)) return null;
  return repo.projectId;
}

function resolveWords(text: string) {
  return ` ${text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;
}

export function isRepoNamed(text: string, name: string) {
  const words = resolveWords(name);
  return words.trim() !== '' && resolveWords(text).includes(words);
}
