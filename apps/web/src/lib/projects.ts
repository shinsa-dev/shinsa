import {
  lowerFirst,
  PROJECT_COLORS,
  PROJECT_KEY_PATTERN,
  PROJECT_LIMITS,
  type Project,
  type ProjectInput,
  type Repo,
  resolveTaskProject,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import { toast } from '@shinsa/ui/components/sonner';
import { describeFailure, requestWithToast, sendCommandWithToast } from '@/lib/connection/commands.ts';
import {
  type LocalRepo,
  requestAddProjectFolder,
  requestAddProjectRepo,
  requestLocalRepos,
} from '@/lib/connection/projects.ts';
import { sendCommand } from '@/lib/connection/socket.ts';
import { formatCount } from '@/lib/format/count.ts';

export type ProjectField = 'name' | 'key' | 'description';

export type ProjectDialogMode = 'create' | ProjectField;

export interface ProjectDraft {
  name: string;
  key: string;
  description: string;
}

interface ProjectDialogCopy {
  title: string;
  description: string;
  action: string;
  done: string;
  fields: ProjectField[];
}

export const PROJECT_DIALOG: Record<ProjectDialogMode, ProjectDialogCopy> = {
  create: {
    title: 'New project',
    description:
      'A project holds the repositories and folders you work on together. Its key starts each task’s handle, like SW-142.',
    action: 'Create project',
    done: 'Project created. Add its repositories or folders.',
    fields: ['name', 'key', 'description'],
  },
  name: {
    title: 'Rename project',
    description: 'The name shows in the focus menu, on tasks and in what agents read.',
    action: 'Rename',
    done: 'Project renamed.',
    fields: ['name'],
  },
  key: {
    title: 'Change key',
    description:
      'New tasks in this project get handles with the new key. Tasks you already have keep theirs.',
    action: 'Change key',
    done: 'Key changed.',
    fields: ['key'],
  },
  description: {
    title: 'Edit description',
    description: 'Agents read it before they start work in this project.',
    action: 'Save description',
    done: 'Description saved.',
    fields: ['description'],
  },
};

export const PROJECT_FIELD: Record<ProjectField, { label: string; placeholder: string }> = {
  name: { label: 'Name', placeholder: 'Superwall' },
  key: { label: 'Key', placeholder: 'SW' },
  description: {
    label: 'Description',
    placeholder: 'What the project is and how its repositories fit together',
  },
};

export const OPTIONAL_KEY_PLACEHOLDER = 'Made from the name';

export const KEY_RULE = '2 to 6 letters or digits, starting with a letter.';

export const FOLDER_HINT = 'Folder: every repository in it belongs to the project';

export const NO_PLACES = 'No repositories or folders yet.';

export function resolveFolderName(path: string) {
  return path.replace(/\/+$/, '').split('/').at(-1) || path;
}

export function describeProjectKey(key: string) {
  return `Tasks in this project are named ${key}-1, ${key}-2…`;
}

interface RepoChoice {
  path: string;
  name: string;
  detail: string;
}

export interface RepoChoiceGroup {
  title: string;
  repos: RepoChoice[];
}

function byName<T extends { name: string }>(a: T, b: T) {
  return a.name.localeCompare(b.name);
}

export function listProjects(state: ShinsaState) {
  return Object.values(state.projects).sort(byName);
}

export function selectProject(state: ShinsaState, projectId: string | null) {
  return projectId ? (state.projects[projectId] ?? null) : null;
}

export function selectTaskProject(state: ShinsaState, task: Task) {
  return selectProject(state, resolveTaskProject(state, task));
}

export function listProjectRepoRows(state: ShinsaState, projectId: string) {
  return Object.values(state.repos)
    .filter((repo) => repo.projectId === projectId)
    .sort(byName);
}

export function listLooseRepos(state: ShinsaState) {
  return Object.values(state.repos)
    .filter((repo) => selectProject(state, repo.projectId) === null)
    .sort(byName);
}

function resolveProjectColor(state: ShinsaState) {
  const used = new Set(Object.values(state.projects).map((project) => project.color));
  return PROJECT_COLORS.find((color) => !used.has(color)) ?? 'blue';
}

export function resolveProjectInput(project: Project, patch: Partial<ProjectInput> = {}): ProjectInput {
  return {
    id: project.id,
    name: project.name,
    color: project.color,
    key: project.key,
    description: project.description,
    folders: project.folders,
    ...patch,
  };
}

export function createProjectDraft(project: Project | null): ProjectDraft {
  return {
    name: project?.name ?? '',
    key: project?.key ?? '',
    description: project?.description ?? '',
  };
}

function describeKeyProblem(state: ShinsaState, key: string, projectId: string | null) {
  if (!PROJECT_KEY_PATTERN.test(key)) return `Use ${lowerFirst(KEY_RULE)}`;
  const owner = Object.values(state.projects).find(
    (project) => project.key === key && project.id !== projectId
  );
  return owner ? `${owner.name} already uses ${key}.` : null;
}

export function validateProjectDraft(
  state: ShinsaState,
  mode: ProjectDialogMode,
  draft: ProjectDraft,
  projectId: string | null
) {
  const errors: Partial<Record<ProjectField, string>> = {};
  const fields = PROJECT_DIALOG[mode].fields;
  const name = draft.name.trim();
  const key = draft.key.trim().toUpperCase();
  if (fields.includes('name') && !name) errors.name = 'Give the project a name.';
  if (fields.includes('name') && name.length > PROJECT_LIMITS.name) {
    errors.name = `Use ${PROJECT_LIMITS.name} characters or fewer.`;
  }
  if (mode === 'key' && !key) errors.key = 'Type a key, like SW.';
  const keyProblem = fields.includes('key') && key ? describeKeyProblem(state, key, projectId) : null;
  if (keyProblem) errors.key = keyProblem;
  if (fields.includes('description') && draft.description.trim().length > PROJECT_LIMITS.description) {
    errors.description = `Use ${PROJECT_LIMITS.description.toLocaleString('en-US')} characters or fewer.`;
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

export function resolveDraftInput(
  state: ShinsaState,
  draft: ProjectDraft,
  project: Project | null
): ProjectInput {
  const key = draft.key.trim().toUpperCase();
  const values = { name: draft.name.trim(), description: draft.description.trim() };
  if (project) return resolveProjectInput(project, { ...values, key: key || project.key });
  return { ...values, color: resolveProjectColor(state), ...(key ? { key } : {}) };
}

export function validateFolderPath(path: string) {
  const trimmed = path.trim();
  if (!trimmed) return 'Type the folder’s path.';
  if (!trimmed.startsWith('/') && !trimmed.startsWith('~/'))
    return 'Use the full path, starting with / or ~/.';
  return null;
}

export function listRepoChoiceGroups(
  state: ShinsaState,
  local: LocalRepo[],
  projectId: string
): RepoChoiceGroup[] {
  const outside = local.filter((repo) => repo.projectId !== projectId).sort(byName);
  const owner = (repo: LocalRepo) => selectProject(state, repo.projectId);
  const groups: RepoChoiceGroup[] = [
    {
      title: 'In your folders',
      repos: outside
        .filter((repo) => owner(repo) === null)
        .map((repo) => ({ path: repo.path, name: repo.name, detail: repo.path })),
    },
    {
      title: 'In other projects',
      repos: outside.flatMap((repo) => {
        const project = owner(repo);
        return project ? [{ path: repo.path, name: repo.name, detail: project.name }] : [];
      }),
    },
  ];
  return groups.filter((group) => group.repos.length > 0);
}

export function describeProjectRemoval(project: Project, repoCount: number) {
  const repos = formatCount(repoCount, 'repository', 'repositories');
  return {
    title: `Remove ${project.name}?`,
    body:
      repoCount > 0
        ? `Its ${repos} stay registered, without a project. Tasks keep their handles.`
        : 'Tasks keep their handles. Nothing on disk changes.',
    done: repoCount > 0 ? 'Project removed. Its repositories have no project now.' : 'Project removed.',
  };
}

export interface ProjectActions {
  write: (input: ProjectInput, done?: string) => Promise<boolean>;
  save: (input: ProjectInput, done: string) => Promise<string | null>;
  remove: (project: Project, done: string) => Promise<boolean>;
  listLocalRepos: () => Promise<LocalRepo[]>;
  addRepo: (project: Project, path: string) => Promise<boolean>;
  removeRepo: (repo: Repo) => Promise<boolean>;
  addFolder: (project: Project, path: string) => Promise<string | null>;
  removeFolder: (project: Project, folder: string) => Promise<boolean>;
}

async function saveProject(input: ProjectInput, done: string) {
  try {
    await sendCommand({ type: 'project.write', project: input });
  } catch (error) {
    return describeFailure(error);
  }
  toast.success(done);
  return null;
}

async function addFolder(project: Project, path: string) {
  try {
    await requestAddProjectFolder(project.id, path.trim());
  } catch (error) {
    return describeFailure(error);
  }
  toast.success('Folder added. Its repositories belong to the project.');
  return null;
}

export const PROJECT_ACTIONS: ProjectActions = {
  write: (input, done) => sendCommandWithToast({ type: 'project.write', project: input }, done),
  save: saveProject,
  remove: (project, done) => sendCommandWithToast({ type: 'project.remove', projectId: project.id }, done),
  listLocalRepos: requestLocalRepos,
  addRepo: (project, path) =>
    requestWithToast(() => requestAddProjectRepo(project.id, path), `Repository added to ${project.name}.`),
  removeRepo: (repo) =>
    sendCommandWithToast(
      { type: 'repo.update', repoId: repo.id, patch: { projectId: null } },
      'Repository removed from the project.'
    ),
  addFolder,
  removeFolder: (project, folder) =>
    sendCommandWithToast(
      {
        type: 'project.write',
        project: resolveProjectInput(project, {
          folders: project.folders.filter((entry) => entry !== folder),
        }),
      },
      'Folder removed.'
    ),
};
