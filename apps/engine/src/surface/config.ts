import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
  COVERAGE_FORMATS,
  COVERAGE_MODES,
  type CoverageFormat,
  type CoverageSetting,
  DomainError,
  HOUR_MS,
  HUMAN_ONLY_SETTINGS,
  type OnboardingStatus,
  PROJECT_COLORS,
  type ProjectInput,
  SETTINGS_KEYS,
  type Settings,
  type UserCommand,
  WORKSPACE_MODES,
  type WorkspaceMode,
} from '@shinsa/core';
import { Clock, DateTime, Effect, Option, Schema } from 'effect';
import { describeError } from '../log/index.ts';
import { resolveProjectFolder } from '../projects/folders.ts';
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
import { SurfaceCallFailed, type SurfaceClient } from './schema.ts';
import { defineAction, defineCommand, defineRead, readValue, type SurfaceSpec } from './spec.ts';
import { findTeamId } from './teams.ts';

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

const TEAM_FIELD: FieldSpec = {
  name: 'team',
  kind: 'text',
  required: true,
  description: 'The team’s name or id, from `shinsa teams list`.',
};

const PATH_FIELD: FieldSpec = {
  name: 'path',
  kind: 'text',
  positional: 'one',
  required: true,
  description: 'A full path, or one starting with ~/.',
};

const decodeSettingJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

function readSettingValue(raw: unknown) {
  if (typeof raw !== 'string') return raw;
  return Option.getOrElse(decodeSettingJson(raw), () => raw);
}

function formatSettings({ settings }: { settings: Settings }, values: Values) {
  const key = readValue(values, 'key');
  const entries = Object.entries(settings).filter(([name]) => !key || name === key);
  if (key && entries.length === 0) return `${key} is not set; it uses its default.`;
  return entries.map(([name, value]) => `${name} = ${JSON.stringify(value)}`).join('\n');
}

const assertSettingKey = Effect.fn('Surface.assertSettingKey')(function* (key: string) {
  if (!(SETTINGS_KEYS as readonly string[]).includes(key)) {
    return yield* new DomainError({
      code: 'setting_unknown',
      message: `No setting ${key}. The settings are ${SETTINGS_KEYS.join(', ')}.`,
    });
  }
});

function buildCoverage(values: Values): CoverageSetting | null {
  const mode = readValue(values, 'coverage');
  if (!mode) return null;
  if (mode !== 'custom') return { mode: mode as 'auto' | 'off' };
  const format = readValue(values, 'coverageFormat');
  return {
    mode,
    command: readValue(values, 'coverageCommand'),
    report: readValue(values, 'coverageReport'),
    format: format ? (format as CoverageFormat) : null,
  };
}

const buildRepoPatch = Effect.fn('Surface.buildRepoPatch')(function* (client: SurfaceClient, values: Values) {
  const project = readValue(values, 'project');
  const projectId = yield* resolveOptionalProjectId(client, project === 'none' ? '' : project);
  const coverage = buildCoverage(values);
  const patch: RepoPatch = {
    ...(values.name ? { name: readValue(values, 'name') } : {}),
    ...(values.defaultBranch ? { defaultBranch: readValue(values, 'defaultBranch') } : {}),
    ...(values.project === undefined ? {} : { projectId }),
    ...(values.checks === undefined ? {} : { checkCommands: values.checks as string[] }),
    ...(values.workspace ? { workspace: readValue(values, 'workspace') as WorkspaceMode } : {}),
    ...(coverage ? { coverage } : {}),
  };
  return patch;
});

function resolveFolderPath(path: string) {
  return path.startsWith('~') ? path : resolve(path);
}

function resolveNewColor(projects: readonly ProjectView[]) {
  const used = new Set(projects.map((project) => project.color));
  return PROJECT_COLORS.find((color) => !used.has(color)) ?? PROJECT_COLORS[0];
}

const buildProjectInput = Effect.fn('Surface.buildProjectInput')(function* (
  client: SurfaceClient,
  values: Values
) {
  const { projects } = yield* client.api.state.projects();
  const ref = readValue(values, 'id');
  const existing = ref ? selectProject(projects, ref) : null;
  if (ref && !existing) {
    return yield* new DomainError({
      code: 'project_not_found',
      message: `No project ${ref}. \`shinsa projects list\` lists them.`,
    });
  }
  const name = readValue(values, 'name') || existing?.name;
  if (!name) {
    return yield* new DomainError({
      code: 'arguments_invalid',
      message: 'Name the new project with --name.',
    });
  }
  const folders = values.folders as string[] | undefined;
  const resolvedFolders =
    folders === undefined
      ? undefined
      : yield* Effect.try({
          try: () => folders.map((folder) => resolveProjectFolder(resolveFolderPath(folder), homedir())),
          catch: (error) =>
            error instanceof DomainError ? error : new SurfaceCallFailed({ message: describeError(error) }),
        });
  const input: ProjectInput = {
    ...(existing ? { id: existing.id } : {}),
    name,
    color: readValue(values, 'color') || existing?.color || resolveNewColor(projects),
    ...(values.key || existing ? { key: readValue(values, 'key') || existing?.key } : {}),
    ...(values.description === undefined
      ? existing
        ? { description: existing.description }
        : {}
      : { description: readValue(values, 'description') }),
    ...(resolvedFolders === undefined
      ? existing
        ? { folders: existing.folders }
        : {}
      : { folders: resolvedFolders }),
  };
  return input;
});

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
    const request = { params: { projectId }, payload: { path } };
    return kind === 'repos' ? client.api.projects.addRepo(request) : client.api.projects.addFolder(request);
  }
  if (kind === 'repos') return client.projects.upsertRepo(projectId, path);
  return client.projects.upsertFolder(projectId, path);
}

const upsertProjectPath = Effect.fn('Surface.upsertProjectPath')(function* (
  client: SurfaceClient,
  values: Values,
  kind: 'repos' | 'folders'
) {
  const project = yield* findProject(client, readValue(values, 'project'));
  const data: unknown = yield* requestProjectChange(
    client,
    project.id,
    kind,
    resolveFolderPath(readValue(values, 'path'))
  );
  const noun = kind === 'repos' ? 'repository' : 'folder';
  return { data, text: `Added the ${noun} to ${project.name}.` };
});

const saveFolders = Effect.fn('Surface.saveFolders')(function* (
  client: SurfaceClient,
  change: (roots: string[]) => string[]
) {
  const status = yield* client.api.onboarding.status();
  const roots = change(status.roots.configured);
  const data = yield* client.api.onboarding.setup({ payload: { roots } });
  return { data, text: formatFolders(data) };
});

function formatFolders(status: OnboardingStatus) {
  return [
    `Folders Shinsa looks in (${status.roots.source}):`,
    ...status.roots.effective.map((root) => `  ${root}`),
  ].join('\n');
}

export const CONFIG_SPECS: SurfaceSpec[] = [
  defineRead({
    path: ['settings', 'get'],
    summary: 'Show every setting, or one.',
    fields: [
      { name: 'key', kind: 'text', positional: 'one', description: `One of ${SETTINGS_KEYS.join(', ')}.` },
    ],
    read: (_values, client) => client.api.state.settings(),
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
    build: Effect.fn('Surface.settingsSet')(function* (values) {
      const key = readValue(values, 'key');
      yield* assertSettingKey(key);
      return {
        type: 'settings.change' as const,
        patch: { [key]: readSettingValue(values.value) } as Partial<Settings>,
      };
    }),
    done: (values) => `Set ${readValue(values, 'key')}.`,
  }),
  defineRead({
    path: ['projects', 'list'],
    summary: 'List the projects, each with its key and repositories.',
    fields: [],
    read: (_values, client) => client.api.state.projects(),
    format: ({ projects }) =>
      projects.length === 0 ? 'No projects.' : projects.map(describeProjectLine).join('\n'),
  }),
  defineRead({
    path: ['projects', 'show'],
    summary: 'Show a project: its description, repositories and folders.',
    fields: [PROJECT_FIELD],
    read: (_values, client) => client.api.state.projects(),
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
    build: Effect.fn('Surface.projectWrite')(function* (values, client) {
      return { type: 'project.write' as const, project: yield* buildProjectInput(client, values) };
    }),
    done: () => 'Saved the project.',
  }),
  defineCommand({
    path: ['projects', 'remove'],
    summary: 'Remove a project. Its repositories and tasks keep working without one.',
    command: 'project.remove',
    fields: [PROJECT_FIELD],
    build: Effect.fn('Surface.projectRemove')(function* (values, client) {
      return {
        type: 'project.remove' as const,
        projectId: yield* findProjectId(client, readValue(values, 'project')),
      };
    }),
    done: () => 'Removed the project.',
  }),
  defineCommand({
    path: ['projects', 'add-to-team'],
    summary: 'Show every task of a project to a team, read-only and without its chat.',
    command: 'project.add_to_team',
    humanOnly: true,
    fields: [PROJECT_FIELD, TEAM_FIELD],
    build: Effect.fn('Surface.projectAddToTeam')(function* (values, client) {
      return {
        type: 'project.add_to_team' as const,
        projectId: yield* findProjectId(client, readValue(values, 'project')),
        teamId: yield* findTeamId(client, readValue(values, 'team')),
      };
    }),
    done: () => 'The team sees its tasks now.',
  }),
  defineCommand({
    path: ['projects', 'remove-from-team'],
    summary: 'Stop showing a project’s tasks to a team.',
    command: 'project.remove_from_team',
    humanOnly: true,
    fields: [PROJECT_FIELD, TEAM_FIELD],
    build: Effect.fn('Surface.projectRemoveFromTeam')(function* (values, client) {
      return {
        type: 'project.remove_from_team' as const,
        projectId: yield* findProjectId(client, readValue(values, 'project')),
        teamId: yield* findTeamId(client, readValue(values, 'team')),
      };
    }),
    done: () => 'The team no longer sees its tasks.',
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
  defineRead({
    path: ['focus', 'show'],
    summary: 'Show the project you are focused on.',
    fields: [],
    read: (_values, client) => client.api.state.projects(),
    format: ({ projects, focus }) => {
      const project = projects.find((candidate) => candidate.id === focus.projectId);
      if (!project) return 'No focus: everything shows.';
      const until = focus.until ? ` until ${DateTime.formatIso(DateTime.makeUnsafe(focus.until))}` : '';
      return `Focused on ${project.name}${until}.`;
    },
  }),
  defineCommand({
    path: ['focus', 'set'],
    summary: 'Focus on one project: Shinsa shows only its work.',
    command: 'focus.change',
    fields: [PROJECT_FIELD, { name: 'hours', kind: 'number', description: 'Only for this many hours.' }],
    build: Effect.fn('Surface.focusSet')(function* (values, client) {
      const projectId = yield* findProjectId(client, readValue(values, 'project'));
      const now = yield* Clock.currentTimeMillis;
      return {
        type: 'focus.change' as const,
        projectId,
        until: typeof values.hours === 'number' ? now + values.hours * HOUR_MS : null,
      };
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
  defineRead({
    path: ['repos', 'list'],
    summary: 'List the repositories agents have worked in.',
    fields: [],
    read: (_values, client) => client.api.state.repos(),
    format: ({ repos }) =>
      repos.length === 0
        ? 'No repositories yet. Shinsa registers one the first time it works there.'
        : repos.map((repo) => `${repo.id}  ${repo.name}  ${repo.path}  (${repo.defaultBranch})`).join('\n'),
  }),
  defineCommand({
    path: ['repos', 'update'],
    summary:
      "Change a repository's name, default branch, project, check commands, where agents work or how test coverage is measured.",
    command: 'repo.update',
    fields: [
      REPO_FIELD,
      { name: 'name', kind: 'text', description: 'Its name.' },
      { name: 'defaultBranch', kind: 'text', description: 'The branch pull requests target.' },
      { name: 'project', kind: 'text', description: 'Its project (key, name or id), or none.' },
      {
        name: 'checks',
        kind: 'list',
        description:
          'The commands every task runs before review, in order, on top of the checks its agent plans. Repeat the option for each. Only the human changes them.',
      },
      {
        name: 'workspace',
        kind: 'choice',
        choices: WORKSPACE_MODES,
        description:
          'Where agents work: worktrees (a worktree each) or main_checkout (one task at a time in the checkout). Only the human changes it.',
      },
      {
        name: 'coverage',
        kind: 'choice',
        choices: COVERAGE_MODES,
        description:
          'How Shinsa measures test coverage of the changed lines before review: auto (the test checks of the task, run once more with coverage), custom (yours, with --coverage-command and --coverage-report) or off. Only the human changes it.',
      },
      {
        name: 'coverageCommand',
        kind: 'text',
        description: 'With --coverage custom: the command that runs the tests with coverage.',
      },
      {
        name: 'coverageReport',
        kind: 'text',
        description: 'With --coverage custom: the report it writes, relative to the repository.',
      },
      {
        name: 'coverageFormat',
        kind: 'choice',
        choices: COVERAGE_FORMATS,
        description:
          'With --coverage custom: the report format, when its name does not tell (lcov, cobertura or go).',
      },
    ],
    build: Effect.fn('Surface.repoUpdate')(function* (values, client) {
      return {
        type: 'repo.update' as const,
        repoId: yield* findRepoId(client, readValue(values, 'repo')),
        patch: yield* buildRepoPatch(client, values),
      };
    }),
    done: () => 'Saved the repository.',
  }),
  defineCommand({
    path: ['repos', 'remove'],
    summary: 'Forget a repository. Nothing on disk changes.',
    command: 'repo.remove',
    fields: [REPO_FIELD],
    build: Effect.fn('Surface.repoRemove')(function* (values, client) {
      return { type: 'repo.remove' as const, repoId: yield* findRepoId(client, readValue(values, 'repo')) };
    }),
    done: () => 'Removed the repository.',
  }),
  defineRead({
    path: ['folders', 'list'],
    summary: 'List the folders Shinsa looks in for repositories.',
    fields: [],
    read: (_values, client) => client.api.onboarding.status(),
    format: formatFolders,
  }),
  defineRead({
    path: ['folders', 'suggest'],
    summary: 'Find the folders on this machine that hold git repositories.',
    fields: [{ name: 'refresh', kind: 'boolean', description: 'Scan again instead of using the last scan.' }],
    read: (values, client) => client.api.onboarding.roots({ query: values.refresh ? { refresh: '1' } : {} }),
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
