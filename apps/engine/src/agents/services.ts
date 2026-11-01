import { existsSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';
import {
  isServiceActive,
  listTaskServices,
  listTerminalPlaces,
  resolveServiceUrl,
  resolveTaskProject,
  type ServiceDefinition,
  type ServiceView,
  type ShinsaState,
  type Task,
  type TaskServiceView,
  type TerminalInfo,
  type TerminalsSnapshot,
} from '@shinsa/core';
import type { ServiceInput, ServiceRun } from '../terminals/index.ts';
import { readServiceInput, resolveServiceRunIn } from '../terminals/routes.ts';
import { readString } from './handover.ts';

export const SERVICE_OUTPUT_LINES = 60;

const SERVICE_ACTIONS = ['start', 'stop', 'restart'] as const;

type ServiceAction = (typeof SERVICE_ACTIONS)[number];

export interface TaskServiceRunner {
  readonly home: string;
  readonly dataDir: string;
  snapshot(): TerminalsSnapshot;
  startService(id: string, run: ServiceRun): TerminalInfo;
  stopService(id: string, taskId: string | null): Promise<void>;
  restartService(id: string, run: ServiceRun): Promise<TerminalInfo>;
  readServiceOutput(id: string, taskId: string | null, lines: number): Promise<string[]>;
  addService(projectId: string, input: ServiceInput): ServiceDefinition;
}

export type ServiceToolName = 'list_services' | 'run_service' | 'add_service';

interface ServiceToolContext {
  state: ShinsaState;
  task: Task;
  runner: TaskServiceRunner;
  now: number;
}

function describeNone(snapshot: TerminalsSnapshot, task: Task, state: ShinsaState) {
  const project = resolveTaskProject(state, task);
  const any = snapshot.services.some((service) => service.projectId === project);
  if (!any) return 'The project has no services. Add the one you need with add_service.';
  return 'None of the project’s services can run for this task: their folders are outside this task’s repository, or the task has no worktree of its own.';
}

function describePreview(view: Pick<ServiceView, 'url' | 'state'>) {
  return view.url && isServiceActive(view) ? `, preview at ${view.url}` : '';
}

function describeView(view: TaskServiceView) {
  const exit = view.state === 'failed' && view.exitCode !== null ? ` with code ${view.exitCode}` : '';
  return `- ${view.service.name} (${view.state}${exit}): \`${view.service.command}\` in ${view.cwd}${describePreview(view)}`;
}

function findView(views: TaskServiceView[], reference: string) {
  const wanted = reference.toLowerCase();
  const view =
    views.find((each) => each.service.id === reference) ??
    views.find((each) => each.service.name.toLowerCase() === wanted);
  if (!view) throw new Error(`No service ${reference} for this task. Call list_services to see them.`);
  return view;
}

function readAction(input: Record<string, unknown>): ServiceAction {
  const action = readString(input, 'action');
  if (!SERVICE_ACTIONS.includes(action as ServiceAction))
    throw new Error('action must be start, stop or restart.');
  return action as ServiceAction;
}

function resolveRun(context: ServiceToolContext, view: TaskServiceView) {
  const run = resolveServiceRunIn(context.state, view.service, context.task.id, context.runner);
  if (!run) throw new Error(`${view.service.name} cannot run for this task.`);
  if (!existsSync(run.cwd)) throw new Error(`The folder ${run.cwd} is not in the worktree.`);
  return run;
}

async function listServices(input: Record<string, unknown>, context: ServiceToolContext) {
  const { state, task, runner, now } = context;
  const snapshot = runner.snapshot();
  const views = listTaskServices(state, snapshot, task, now);
  if (views.length === 0) return describeNone(snapshot, task, state);
  const reference = readString(input, 'service');
  if (!reference)
    return ['The project’s services, as they run for this task:', ...views.map(describeView)].join('\n');
  const view = findView(views, reference);
  const output = await runner.readServiceOutput(view.service.id, task.id, SERVICE_OUTPUT_LINES);
  if (output.length === 0) return `${describeView(view)}\nNo output yet.`;
  return `${describeView(view)}\nIts last ${output.length} lines:\n\`\`\`text\n${output.join('\n')}\n\`\`\``;
}

function applyRun(runner: TaskServiceRunner, action: 'start' | 'restart', id: string, run: ServiceRun) {
  if (action === 'start') return runner.startService(id, run);
  return runner.restartService(id, run);
}

async function runService(input: Record<string, unknown>, context: ServiceToolContext) {
  const { state, task, runner, now } = context;
  const action = readAction(input);
  const reference = readString(input, 'service');
  if (!reference) throw new Error('service is required.');
  const view = findView(listTaskServices(state, runner.snapshot(), task, now), reference);
  const { name } = view.service;
  if (action === 'stop') {
    await runner.stopService(view.service.id, task.id);
    return `Stopped ${name} for this task.`;
  }
  if (action === 'start' && isServiceActive(view))
    return `${name} already runs for this task in ${view.cwd}${describePreview(view)}.`;
  const run = resolveRun(context, view);
  const terminal = await applyRun(runner, action, view.service.id, run);
  const url = resolveServiceUrl(view.service, terminal);
  const preview = url ? ` Its preview is at ${url} once it is up.` : '';
  return `${action === 'start' ? 'Started' : 'Restarted'} ${name} for this task in ${run.cwd}.${preview} Read its output with list_services and the service’s name.`;
}

function resolveServiceFolder(repoPath: string, input: Record<string, unknown>) {
  const path = readString(input, 'path')?.trim() ?? '.';
  const relative = normalize(path).replace(/\/+$/, '');
  if (isAbsolute(relative) || relative === '..' || relative.startsWith('../'))
    throw new Error('path must be a folder inside this task’s repository, relative to its root.');
  return {
    relative: relative === '.' ? '' : relative,
    cwd: relative === '.' ? repoPath : join(repoPath, relative),
  };
}

function describeFolder(relative: string) {
  return relative ? `\`${relative}\`` : 'the repository’s root';
}

function readEnvInput(input: Record<string, unknown>) {
  return input.env === undefined || input.env === null ? {} : input.env;
}

function addService(input: Record<string, unknown>, context: ServiceToolContext) {
  const { state, task, runner } = context;
  const repo = task.repoId ? state.repos[task.repoId] : undefined;
  const projectId = resolveTaskProject(state, task);
  if (!(repo && projectId)) throw new Error('add_service needs a task that works in a project’s repository.');
  const { relative, cwd } = resolveServiceFolder(repo.path, input);
  if (!existsSync(cwd))
    throw new Error(
      `${describeFolder(relative)} is not in the repository’s own checkout yet. A service runs from a folder on the default branch.`
    );
  const others = runner.snapshot().services.filter((each) => each.projectId === projectId);
  const added = runner.addService(
    projectId,
    readServiceInput(
      {
        name: input.name ?? '',
        path: cwd,
        command: input.command ?? '',
        env: readEnvInput(input),
        previewUrl: input.preview_url ?? null,
        portVariable: input.port_variable ?? null,
      },
      others,
      listTerminalPlaces(state, projectId),
      runner.home
    )
  );
  return `Added ${added.name} to the project: \`${added.command}\` in ${describeFolder(relative)}. The human sees it under Services. Start it for this task with run_service.`;
}

export async function handleServiceTool(
  name: ServiceToolName,
  input: Record<string, unknown>,
  context: ServiceToolContext
) {
  if (name === 'add_service') return addService(input, context);
  if (name === 'list_services') return await listServices(input, context);
  return await runService(input, context);
}
