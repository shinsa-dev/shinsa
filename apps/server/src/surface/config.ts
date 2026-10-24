import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
  DomainError,
  HOUR_MS,
  HUMAN_ONLY_SETTINGS,
  type OnboardingStatus,
  PROJECT_COLORS,
  type ProjectInput,
  type Repo,
  type RootSuggestions,
  SETTINGS_KEYS,
  type Settings,
  type UserCommand,
  WORKSPACE_MODES,
  type WorkspaceMode,
} from '@shinsa/core';
import { resolveProjectFolder } from '../projects/folders.ts';
import type { SurfaceClient } from './client.ts';
import type { FieldSpec, Values } from './fields.ts';
import {
  findProject,
  findProjectId,
  findRepoId,
  type ProjectsRead,
  type ProjectView,
  resolveOptionalProjectId,
  selectProject,
} from './resolve.ts';
import { defineAction, defineCommand, defineRead, readValue, type SurfaceSpec } from './spec.ts';

type RepoPatch = Extract<UserCommand, { type: 'repo.update' }>['patch'];

const REPO_FIELD: FieldSpec = {
  name: 'repo',
  kind: 'text',
  positional: 'one',
  required: true,
  description: 'The repository (name or id).',
};

const PROJECT_FIELD: FieldSpec = {
  name: 'project',
  kind: 'text',
  positional: 'one',
  required: true,
  description: 'The project: its key, name or id.',
};

const PATH_FIELD: FieldSpec = {
  name: 'path',
  kind: 'text',
  positional: 'one',
  required: true,
  description: 'A full path, or one starting with ~/.',
};

function readSettingValue(raw: unknown) {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function formatSettings({ settings }: { settings: Settings }, values: Values) {
  const key = readValue(values, 'key');
  const entries = Object.entries(settings).filter(([name]) => !key || name === key);
  if (key && entries.length === 0) return `${key} is not set; it uses its default.`;
  return entries.map(([name, value]) => `${name} = ${JSON.stringify(value)}`).join('\n');
}

function assertSettingKey(key: string) {
  if (!(SETTINGS_KEYS as readonly string[]).includes(key)) {
    throw new DomainError(
      'setting_unknown',
      `No setting ${key}. The settings are ${SETTINGS_KEYS.join(', ')}.`
    );
  }
}

async function buildRepoPatch(client: SurfaceClient, values: Values): Promise<RepoPatch> {
  const project = readValue(values, 'project');
  const projectId = await resolveOptionalProjectId(client, project === 'none' ? '' : project);
  return {
    ...(values.name ? { name: readValue(values, 'name') } : {}),
    ...(values.defaultBranch ? { defaultBranch: readValue(values, 'defaultBranch') } : {}),
    ...(values.project === undefined ? {} : { projectId }),
    ...(values.checks === undefined ? {} : { checkCommands: values.checks as string[] }),
    ...(typeof values.waiveChecks === 'boolean' ? { checksWaived: values.waiveChecks } : {}),
    ...(values.workspace ? { workspace: readValue(values, 'workspace') as WorkspaceMode } : {}),
  };
}

function resolveFolderPath(path: string) {
  return path.startsWith('~') ? path : resolve(path);
}

function resolveNewColor(projects: ProjectView[]) {
  const used = new Set(projects.map((project) => project.color));
  return PROJECT_COLORS.find((color) => !used.has(color)) ?? PROJECT_COLORS[0];
}

async function buildProjectInput(client: SurfaceClient, values: Values): Promise<ProjectInput> {
  const { projects } = await client.read<ProjectsRead>('/api/projects');
  const ref = readValue(values, 'id');
  const existing = ref ? selectProject(projects, ref) : null;
  if (ref && !existing) {
    throw new DomainError('project_not_found', `No project ${ref}. \`shinsa projects list\` lists them.`);
  }
  const name = readValue(values, 'name') || existing?.name;
  if (!name) throw new DomainError('arguments_invalid', 'Name the new project with --name.');
  const folders = values.folders as string[] | undefined;
  return {
    ...(existing ? { id: existing.id } : {}),
    name,
    color: readValue(values, 'color') || existing?.color || resolveNewColor(projects),
    ...(values.key || existing ? { key: readValue(values, 'key') || existing?.key } : {}),
    ...(values.description === undefined
      ? existing
        ? { description: existing.description }
        : {}
      : { description: readValue(values, 'description') }),
    ...(folders === undefined
      ? existing
        ? { folders: existing.folders }
        : {}
      : { folders: folders.map((folder) => resolveProjectFolder(resolveFolderPath(folder), homedir())) }),
  };
}

function describeProjectLine(project: ProjectView) {
  const count = project.repos.length;
  const repos = `${count} ${count === 1 ? 'repository' : 'repositories'}`;
  return `${project.key.padEnd(6)} ${project.name}  (${repos})  ${project.id}`;
}

function describeProject(project: ProjectView, focus: ProjectsRead['focus']) {
  return [
    `${project.name} (${project.key})${focus.projectId === project.id ? ', in focus' : ''}`,
    project.description || 'No description.',
    '',
    project.repos.length === 0 ? 'No repositories yet.' : 'Repositories:',
    ...project.repos.map((repo) => `  ${repo.name}  ${repo.path}`),
    ...(project.folders.length === 0
      ? []
      : ['', 'Folders:', ...project.folders.map((folder) => `  ${folder}`)]),
  ].join('\n');
}

function requestProjectChange(
  client: SurfaceClient,
  projectId: string,
  kind: 'repos' | 'folders',
  path: string
) {
  if (!client.projects) {
    return client.post<unknown>(`/api/projects/${encodeURIComponent(projectId)}/${kind}`, { path });
  }
  if (kind === 'repos') return client.projects.upsertRepo(projectId, path);
  return client.projects.upsertFolder(projectId, path);
}

async function upsertProjectPath(client: SurfaceClient, values: Values, kind: 'repos' | 'folders') {
  const project = await findProject(client, readValue(values, 'project'));
  const data = await requestProjectChange(
    client,
    project.id,
    kind,
    resolveFolderPath(readValue(values, 'path'))
  );
  const noun = kind === 'repos' ? 'repository' : 'folder';
  return { data, text: `Added the ${noun} to ${project.name}.` };
}

async function saveFolders(client: SurfaceClient, change: (roots: string[]) => string[]) {
  const status = await client.read<OnboardingStatus>('/api/onboarding');
  const roots = change(status.roots.configured);
  const data = await client.post<OnboardingStatus>('/api/onboarding/setup', { roots });
  return { data, text: formatFolders(data) };
}

function formatFolders(status: OnboardingStatus) {
  return [
    `Folders Shinsa looks in (${status.roots.source}):`,
    ...status.roots.effective.map((root) => `  ${root}`),
  ].join('\n');
}

export const CONFIG_SPECS: SurfaceSpec[] = [
  defineRead<{ settings: Settings }>({
    path: ['settings', 'get'],
    summary: 'Show every setting, or one.',
    fields: [
      { name: 'key', kind: 'text', positional: 'one', description: `One of ${SETTINGS_KEYS.join(', ')}.` },
    ],
    request: () => '/api/settings',
    format: formatSettings,
  }),
  defineCommand({
    path: ['settings', 'set'],
    summary: 'Change a setting. The value is JSON (true, 3, null, {"agent":"codex"}) or plain text.',
    command: 'settings.change',
    fields: [
      {
        name: 'key',
        kind: 'text',
        positional: 'one',
        required: true,
        description: `One of ${SETTINGS_KEYS.join(', ')}. Only the human changes ${HUMAN_ONLY_SETTINGS.join(', ')}.`,
      },
      { name: 'value', kind: 'text', positional: 'rest', required: true, description: 'The new value.' },
    ],
    build: (values) => {
      const key = readValue(values, 'key');
      assertSettingKey(key);
      return {
        type: 'settings.change',
        patch: { [key]: readSettingValue(values.value) } as Partial<Settings>,
      };
    },
    done: (values) => `Set ${readValue(values, 'key')}.`,
  }),
  defineRead<ProjectsRead>({
    path: ['projects', 'list'],
    summary: 'List the projects, each with its key and repositories.',
    fields: [],
    request: () => '/api/projects',
    format: ({ projects }) =>
      projects.length === 0 ? 'No projects.' : projects.map(describeProjectLine).join('\n'),
  }),
  defineRead<ProjectsRead>({
    path: ['projects', 'show'],
    summary: 'Show a project: its description, repositories and folders.',
    fields: [PROJECT_FIELD],
    request: () => '/api/projects',
    format: (data, values) => {
      const ref = readValue(values, 'project');
      const project = selectProject(data.projects, ref);
      if (!project) return `No project ${ref}. \`shinsa projects list\` lists them.`;
      return describeProject(project, data.focus);
    },
  }),
  defineCommand({
    path: ['projects', 'write'],
    summary: 'Create a project, or change one with --id.',
    command: 'project.write',
    fields: [
      {
        name: 'id',
        kind: 'text',
        description: 'The project to change (key, name or id). Leave out to create one.',
      },
      { name: 'name', kind: 'text', description: 'Its name. Needed for a new project.' },
      {
        name: 'key',
        kind: 'text',
        description: 'The prefix of its task handles, such as SW. Derived from the name when left out.',
      },
      { name: 'color', kind: 'choice', choices: PROJECT_COLORS, description: 'Its colour.' },
      { name: 'description', kind: 'text', description: 'What the project is. Agents read it.' },
      {
        name: 'folders',
        kind: 'list',
        description:
          'Folders whose repositories all belong to it, replacing the ones it has. Repeat the option for each.',
      },
    ],
    build: async (values, client) => ({
      type: 'project.write',
      project: await buildProjectInput(client, values),
    }),
    done: () => 'Saved the project.',
  }),
  defineCommand({
    path: ['projects', 'remove'],
    summary: 'Remove a project. Its repositories and tasks keep working without one.',
    command: 'project.remove',
    fields: [PROJECT_FIELD],
    build: async (values, client) => ({
      type: 'project.remove',
      projectId: await findProjectId(client, readValue(values, 'project')),
    }),
    done: () => 'Removed the project.',
  }),
  defineAction({
    path: ['projects', 'add-repo'],
    summary: 'Put a repository in a project, registering it if no agent has worked there yet.',
    fields: [PROJECT_FIELD, PATH_FIELD],
    act: (client, values) => upsertProjectPath(client, values, 'repos'),
  }),
  defineAction({
    path: ['projects', 'add-folder'],
    summary: 'Add a folder to a project: every repository in it belongs to the project.',
    fields: [PROJECT_FIELD, PATH_FIELD],
    act: (client, values) => upsertProjectPath(client, values, 'folders'),
  }),
  defineRead<ProjectsRead>({
    path: ['focus', 'show'],
    summary: 'Show the project you are focused on.',
    fields: [],
    request: () => '/api/projects',
    format: ({ projects, focus }) => {
      const project = projects.find((candidate) => candidate.id === focus.projectId);
      if (!project) return 'No focus: everything shows.';
      const until = focus.until ? ` until ${new Date(focus.until).toISOString()}` : '';
      return `Focused on ${project.name}${until}.`;
    },
  }),
  defineCommand({
    path: ['focus', 'set'],
    summary: 'Focus on one project: Shinsa shows only its work.',
    command: 'focus.change',
    fields: [PROJECT_FIELD, { name: 'hours', kind: 'number', description: 'Only for this many hours.' }],
    build: async (values, client) => ({
      type: 'focus.change',
      projectId: await findProjectId(client, readValue(values, 'project')),
      until: typeof values.hours === 'number' ? Date.now() + values.hours * HOUR_MS : null,
    }),
    done: () => 'Focused.',
  }),
  defineCommand({
    path: ['focus', 'clear'],
    summary: 'Stop focusing on one project.',
    command: 'focus.change',
    fields: [],
    build: () => ({ type: 'focus.change', projectId: null, until: null }),
    done: () => 'Everything shows again.',
  }),
  defineRead<{ repos: Repo[] }>({
    path: ['repos', 'list'],
    summary: 'List the repositories agents have worked in.',
    fields: [],
    request: () => '/api/repos',
    format: ({ repos }) =>
      repos.length === 0
        ? 'No repositories yet. Shinsa registers one the first time it works there.'
        : repos.map((repo) => `${repo.id}  ${repo.name}  ${repo.path}  (${repo.defaultBranch})`).join('\n'),
  }),
  defineCommand({
    path: ['repos', 'update'],
    summary: "Change a repository's name, default branch, project, check commands or where agents work.",
    command: 'repo.update',
    fields: [
      REPO_FIELD,
      { name: 'name', kind: 'text', description: 'Its name.' },
      { name: 'defaultBranch', kind: 'text', description: 'The branch pull requests target.' },
      { name: 'project', kind: 'text', description: 'Its project (key, name or id), or none.' },
      {
        name: 'checks',
        kind: 'list',
        description: 'The check commands, in order. Repeat the option for each. Only the human changes them.',
      },
      {
        name: 'waiveChecks',
        kind: 'boolean',
        description: 'Work without checks. Only the human changes it.',
      },
      {
        name: 'workspace',
        kind: 'choice',
        choices: WORKSPACE_MODES,
        description:
          'Where agents work: worktrees, gitbutler (a branch each in the GitButler workspace) or main_checkout (one task at a time in the checkout). Only the human changes it.',
      },
    ],
    build: async (values, client) => ({
      type: 'repo.update',
      repoId: await findRepoId(client, readValue(values, 'repo')),
      patch: await buildRepoPatch(client, values),
    }),
    done: () => 'Saved the repository.',
  }),
  defineCommand({
    path: ['repos', 'remove'],
    summary: 'Forget a repository. Nothing on disk changes.',
    command: 'repo.remove',
    fields: [REPO_FIELD],
    build: async (values, client) => ({
      type: 'repo.remove',
      repoId: await findRepoId(client, readValue(values, 'repo')),
    }),
    done: () => 'Removed the repository.',
  }),
  defineRead<OnboardingStatus>({
    path: ['folders', 'list'],
    summary: 'List the folders Shinsa looks in for repositories.',
    fields: [],
    request: () => '/api/onboarding',
    format: formatFolders,
  }),
  defineRead<RootSuggestions>({
    path: ['folders', 'suggest'],
    summary: 'Find the folders on this machine that hold git repositories.',
    fields: [{ name: 'refresh', kind: 'boolean', description: 'Scan again instead of using the last scan.' }],
    request: (values) => (values.refresh ? '/api/onboarding/roots?refresh=1' : '/api/onboarding/roots'),
    format: ({ suggestions }) =>
      suggestions.length === 0
        ? 'No folders with repositories found.'
        : suggestions
            .map(
              (folder) => `${folder.chosen ? '*' : ' '} ${folder.path}  (${folder.repoCount} repositories)`
            )
            .join('\n'),
  }),
  defineAction({
    path: ['folders', 'add'],
    summary: 'Add a folder Shinsa looks in for repositories.',
    fields: [PATH_FIELD],
    act: (client, values) =>
      saveFolders(client, (roots) => [...roots, resolveFolderPath(readValue(values, 'path'))]),
  }),
  defineAction({
    path: ['folders', 'remove'],
    summary: 'Stop looking in a folder for repositories.',
    fields: [PATH_FIELD],
    act: (client, values) => {
      const path = resolveFolderPath(readValue(values, 'path'));
      return saveFolders(client, (roots) => roots.filter((root) => root !== path));
    },
  }),
];
