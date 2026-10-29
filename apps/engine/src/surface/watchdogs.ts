import type { FieldSpec } from './fields.ts';
import {
  findProject,
  findProjectId,
  findRepoId,
  findWatchdog,
  type ProjectsRead,
  selectProject,
} from './resolve.ts';
import { defineCommand, defineRead, readValue, type SurfaceSpec } from './spec.ts';

const TASK_FIELD: FieldSpec = {
  name: 'task',
  kind: 'text',
  positional: 'one',
  required: true,
  description: 'The task: its handle (SW-142), its id, the start of its id, or its exact title.',
};

const WATCHDOG_FIELD: FieldSpec = {
  name: 'watchdog',
  kind: 'text',
  positional: 'one',
  required: true,
  description: 'The watchdog: its number in `shinsa tasks show`, from 1, or its title.',
};

const PROJECT_FIELD: FieldSpec = {
  name: 'project',
  kind: 'text',
  positional: 'one',
  required: true,
  description: 'The project: its key, name or id.',
};

const SERVER_FIELD: FieldSpec = {
  name: 'server',
  kind: 'text',
  required: true,
  description: 'The MCP server that holds the data, by name, as Settings → Integrations lists it.',
};

export const WATCHDOG_SPECS: SurfaceSpec[] = [
  defineCommand({
    path: ['watchdogs', 'stop'],
    summary: 'Stop a watchdog that watches a merged change.',
    command: 'watchdog.stop',
    fields: [TASK_FIELD, WATCHDOG_FIELD],
    build: async (values, client) => {
      const found = await findWatchdog(client, readValue(values, 'task'), readValue(values, 'watchdog'));
      return { type: 'watchdog.stop', taskId: found.taskId, watchdogId: found.watchdog.id };
    },
    done: () => 'Stopped the watchdog.',
  }),
  defineCommand({
    path: ['watchdogs', 'connect'],
    summary:
      'Give a watchdog that waits for a data source its MCP server, and add the server to the project’s data sources.',
    command: 'watchdog.connect',
    fields: [
      TASK_FIELD,
      WATCHDOG_FIELD,
      SERVER_FIELD,
      {
        name: 'data',
        kind: 'text',
        required: true,
        description: 'What the server holds that the check reads.',
      },
    ],
    build: async (values, client) => {
      const found = await findWatchdog(client, readValue(values, 'task'), readValue(values, 'watchdog'));
      return {
        type: 'watchdog.connect',
        taskId: found.taskId,
        watchdogId: found.watchdog.id,
        server: readValue(values, 'server'),
        data: readValue(values, 'data'),
      };
    },
    done: () => 'Connected the source; the watchdog starts watching.',
  }),
  defineRead<ProjectsRead>({
    path: ['sources', 'list'],
    summary: 'List a project’s data sources: the MCP servers watchdogs read, and what each holds.',
    fields: [PROJECT_FIELD],
    request: () => '/api/projects',
    format: (data, values) => {
      const project = selectProject(data.projects, readValue(values, 'project'));
      if (!project) return `No project ${readValue(values, 'project')}.`;
      const sources = project.watchSources ?? [];
      if (sources.length === 0) return `${project.name} has no data sources yet.`;
      return sources
        .map((source) => {
          const repos = source.repoIds
            .map((id) => project.repos.find((repo) => repo.id === id)?.name ?? id)
            .join(', ');
          return `${source.server}: ${source.data} (${repos || 'every repository'})`;
        })
        .join('\n');
    },
  }),
  defineCommand({
    path: ['sources', 'write'],
    summary:
      'Add a data source to a project, or change one: an MCP server watchdogs read, and what it holds.',
    command: 'watch_source.write',
    fields: [
      PROJECT_FIELD,
      SERVER_FIELD,
      { name: 'data', kind: 'text', required: true, description: 'What the server holds.' },
      { name: 'repos', kind: 'list', description: 'The repositories it covers. Left out, every one.' },
    ],
    build: async (values, client) => {
      const project = await findProject(client, readValue(values, 'project'));
      const refs = (values.repos as string[] | undefined) ?? [];
      const repoIds = await Promise.all(refs.map((ref) => findRepoId(client, ref)));
      return {
        type: 'watch_source.write',
        projectId: project.id,
        server: readValue(values, 'server'),
        data: readValue(values, 'data'),
        repoIds,
      };
    },
    done: () => 'Saved the data source.',
  }),
  defineCommand({
    path: ['sources', 'remove'],
    summary: 'Remove a data source from a project.',
    command: 'watch_source.remove',
    fields: [PROJECT_FIELD, SERVER_FIELD],
    build: async (values, client) => ({
      type: 'watch_source.remove',
      projectId: await findProjectId(client, readValue(values, 'project')),
      server: readValue(values, 'server'),
    }),
    done: () => 'Removed the data source.',
  }),
];
