import { existsSync } from 'node:fs';
import {
  isServiceActive,
  listTaskServices,
  resolveServiceUrl,
  resolveTaskProject,
  type ServiceView,
  type ShinsaState,
  type Task,
  type TaskServiceView,
  type TerminalInfo,
  type TerminalsSnapshot,
} from '@shinsa/core';
import type { ServiceRun } from '../terminals/index.ts';
import { resolveServiceRunIn } from '../terminals/routes.ts';
import { readString } from './handover.ts';

export const SERVICE_OUTPUT_LINES = 60;

const SERVICE_ACTIONS = ['start', 'stop', 'restart'] as const;

type ServiceAction = (typeof SERVICE_ACTIONS)[number];

export interface TaskServiceRunner {
  readonly home: string;
  snapshot(): TerminalsSnapshot;
  startService(id: string, run: ServiceRun): TerminalInfo;
  stopService(id: string, taskId: string | null): Promise<void>;
  restartService(id: string, run: ServiceRun): Promise<TerminalInfo>;
  readServiceOutput(id: string, taskId: string | null, lines: number): Promise<string[]>;
}

interface ServiceToolContext {
  state: ShinsaState;
  task: Task;
  runner: TaskServiceRunner;
  now: number;
}

function describeNone(snapshot: TerminalsSnapshot, task: Task, state: ShinsaState) {
  const project = resolveTaskProject(state, task);
  const any = snapshot.services.some((service) => service.projectId === project);
  if (!any) return 'The project has no services. The human adds them in Shinsa under Services.';
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
  const run = resolveServiceRunIn(context.state, view.service, context.task.id, context.runner.home);
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

export function handleServiceTool(
  name: 'list_services' | 'run_service',
  input: Record<string, unknown>,
  context: ServiceToolContext
) {
  return name === 'list_services' ? listServices(input, context) : runService(input, context);
}
