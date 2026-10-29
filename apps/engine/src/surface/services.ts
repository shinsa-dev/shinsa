import {
  DomainError,
  isServiceActive,
  listProjectServices,
  listServiceTaskRuns,
  type ServiceState,
  type ServiceView,
  type TerminalInfo,
  type TerminalsSnapshot,
} from '@shinsa/core';
import { type Display, describeMark, describeTable, PLAIN_DISPLAY, type Tone } from '../terminal/index.ts';
import type { SurfaceClient } from './client.ts';
import type { FieldSpec, Values } from './fields.ts';
import { type ProjectsRead, resolveOptionalTaskId, selectProject } from './resolve.ts';
import { defineAction, encode, readValue, type SurfaceSpec } from './spec.ts';

const PROJECT_FIELD: FieldSpec = {
  name: 'project',
  kind: 'text',
  description: 'Only this project’s services (id, key or name).',
};

const SERVICE_FIELDS: FieldSpec[] = [
  {
    name: 'service',
    kind: 'text',
    positional: 'one',
    required: true,
    description: 'The service, by its name.',
  },
  { ...PROJECT_FIELD, description: 'The project the service belongs to, when two have one by that name.' },
];

const TASK_RUN_FIELD: FieldSpec = {
  name: 'task',
  kind: 'text',
  description: 'Run it for this task, in its worktree: its handle (SW-142), id or exact title.',
};

const STATE_TONES: Record<ServiceState, Tone> = {
  stopped: 'dim',
  starting: 'accent',
  running: 'success',
  exited: 'dim',
  failed: 'danger',
};

interface ServicesRead {
  projects: ProjectsRead['projects'];
  views: ServiceView[];
  taskRuns: Map<string, ServiceView[]>;
}

async function readServices(client: SurfaceClient, projectRef: string): Promise<ServicesRead> {
  const [snapshot, { projects }] = await Promise.all([
    client.read<TerminalsSnapshot>('/api/terminals'),
    client.read<ProjectsRead>('/api/projects'),
  ]);
  const project = projectRef ? selectProject(projects, projectRef) : null;
  if (projectRef && !project)
    throw new DomainError(
      'project_not_found',
      `No project ${projectRef}. \`shinsa projects list\` lists them.`
    );
  const now = Date.now();
  const views = projects
    .filter((each) => !project || each.id === project.id)
    .flatMap((each) => listProjectServices(snapshot, each.id, now));
  const taskRuns = new Map(
    views.map((view) => [view.service.id, listServiceTaskRuns(snapshot, view.service.id, now)])
  );
  return { projects, views, taskRuns };
}

function describeState(view: ServiceView) {
  return view.state === 'failed' && view.exitCode !== null ? `failed (code ${view.exitCode})` : view.state;
}

function describeTaskRuns(runs: ServiceView[]) {
  const active = runs.filter(isServiceActive).length;
  return active === 0 ? '' : `${active} running`;
}

function formatServices({ projects, views, taskRuns }: ServicesRead, display: Display) {
  if (views.length === 0) return 'No services. Add one from Services at the top of Shinsa.';
  const names = new Map(projects.map((project) => [project.id, project.name]));
  const rows = views.map((view) => [
    { text: view.service.name, tone: 'bold' as const },
    names.get(view.service.projectId) ?? '',
    { text: describeState(view), tone: STATE_TONES[view.state] },
    describeTaskRuns(taskRuns.get(view.service.id) ?? []),
    isServiceActive(view) ? (view.url ?? '') : '',
    { text: view.service.command, tone: 'dim' as const },
  ]);
  return describeTable(display, {
    headers: ['Service', 'Project', 'State', 'Tasks', 'Preview', 'Command'],
    rows,
  }).join('\n');
}

async function findServiceView(client: SurfaceClient, values: Values) {
  const reference = readValue(values, 'service');
  const { views } = await readServices(client, readValue(values, 'project'));
  const wanted = reference.toLowerCase();
  const matches = views.filter(
    (each) => each.service.id === reference || each.service.name.toLowerCase() === wanted
  );
  if (matches.length > 1)
    throw new DomainError(
      'service_ambiguous',
      `More than one project has a service called ${reference}. Name the project with --project.`
    );
  const [view] = matches;
  if (!view)
    throw new DomainError(
      'service_not_found',
      `No service ${reference}. \`shinsa services list\` lists them.`
    );
  return view;
}

function defineServiceAction(action: 'start' | 'stop' | 'restart', summary: string, done: string) {
  return defineAction({
    path: ['services', action],
    summary,
    humanOnly: true,
    fields: [...SERVICE_FIELDS, TASK_RUN_FIELD],
    act: async (client, values, display) => {
      const { service } = await findServiceView(client, values);
      const taskRef = readValue(values, 'task');
      const taskId = await resolveOptionalTaskId(client, taskRef);
      const data = await client.post<TerminalsSnapshot & { terminal?: TerminalInfo }>(
        `/api/services/${encode(service.id)}/${action}`,
        taskId ? { taskId } : {}
      );
      const scope = taskId ? ` for ${taskRef}` : '';
      return {
        data,
        text: describeMark(display.style, 'success', 'check', `${done} ${service.name}${scope}.`),
      };
    },
  });
}

export const SERVICE_SPECS: SurfaceSpec[] = [
  {
    path: ['services', 'list'],
    summary:
      'List your services in Shinsa: what each runs, in which project, whether it is running and its preview URL.',
    access: 'read',
    humanOnly: true,
    fields: [PROJECT_FIELD],
    run: async (client, values, display = PLAIN_DISPLAY) => {
      const read = await readServices(client, readValue(values, 'project'));
      return { data: { services: read.views }, text: formatServices(read, display) };
    },
  },
  defineServiceAction('start', 'Start a service in its terminal, as Start does in Shinsa.', 'Started'),
  defineServiceAction(
    'stop',
    'Stop a service: its programs get a hang-up, as closing a terminal does.',
    'Stopped'
  ),
  defineServiceAction('restart', 'Stop a service and start it again.', 'Restarted'),
];
