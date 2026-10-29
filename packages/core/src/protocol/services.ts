import { isTaskSettled } from '../domain/stages.ts';
import type { Task } from '../domain/types.ts';
import type { ShinsaState } from '../state/project.ts';
import { resolveTaskProject } from '../state/queries.ts';
import type { TerminalInfo, TerminalsSnapshot } from './terminals.ts';

export interface ServiceDefinition {
  id: string;
  projectId: string;
  name: string;
  cwd: string;
  command: string;
  env: Record<string, string>;
}

export type ServiceSource =
  | 'package'
  | 'deno'
  | 'procfile'
  | 'script'
  | 'compose'
  | 'cargo'
  | 'go'
  | 'django'
  | 'make';

export interface ServiceSuggestion {
  name: string;
  cwd: string;
  command: string;
  source: ServiceSource;
  recommended: boolean;
}

export type ServiceState = 'stopped' | 'starting' | 'running' | 'exited' | 'failed';

export interface ServiceView {
  service: ServiceDefinition;
  taskId: string | null;
  terminal: TerminalInfo | null;
  state: ServiceState;
  exitCode: number | null;
  since: number | null;
}

export interface TaskServiceView extends ServiceView {
  taskId: string;
  cwd: string;
}

export interface ServicesSummary {
  total: number;
  running: number;
  starting: number;
  failed: number;
}

export const SERVICE_LIMITS = {
  services: 32,
  name: 40,
  command: 4000,
  envKeys: 50,
  envValue: 4000,
  startingMs: 3000,
} as const;

const STOPPED_BY_YOU = new Set([130, 143]);

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isServiceEnvKey(key: string) {
  return ENV_KEY.test(key);
}

export function resolveServiceState(terminal: TerminalInfo | null, now: number): ServiceView['state'] {
  if (!terminal) return 'stopped';
  if (terminal.status === 'running')
    return now - terminal.startedAt < SERVICE_LIMITS.startingMs ? 'starting' : 'running';
  if (terminal.status === 'stopped') return 'stopped';
  if (terminal.exitCode === 0) return 'exited';
  if (terminal.exitCode !== null && STOPPED_BY_YOU.has(terminal.exitCode)) return 'stopped';
  return 'failed';
}

export function resolveServiceView(
  service: ServiceDefinition,
  terminal: TerminalInfo | null,
  now: number,
  taskId: string | null = terminal?.taskId ?? null
): ServiceView {
  const state = resolveServiceState(terminal, now);
  const since = terminal ? (terminal.status === 'running' ? terminal.startedAt : terminal.endedAt) : null;
  return { service, taskId, terminal, state, exitCode: terminal?.exitCode ?? null, since };
}

export function selectServiceTerminal(snapshot: TerminalsSnapshot, serviceId: string, taskId: string | null) {
  return (
    snapshot.terminals.find((terminal) => terminal.serviceId === serviceId && terminal.taskId === taskId) ??
    null
  );
}

export function listProjectServices(
  snapshot: TerminalsSnapshot | null,
  projectId: string | null,
  now: number
): ServiceView[] {
  if (!snapshot || !projectId) return [];
  return (snapshot.services ?? [])
    .filter((service) => service.projectId === projectId)
    .map((service) => resolveServiceView(service, selectServiceTerminal(snapshot, service.id, null), now));
}

function isInside(path: string, folder: string) {
  const base = folder.replace(/\/+$/, '');
  return path === base || path.startsWith(`${base}/`);
}

export function resolveTaskServiceCwd(state: ShinsaState, service: ServiceDefinition, task: Task) {
  const repo = task.repoId ? state.repos[task.repoId] : undefined;
  if (!(repo && task.worktreePath) || isTaskSettled(task)) return null;
  if (resolveTaskProject(state, task) !== service.projectId) return null;
  const root = repo.path.replace(/\/+$/, '');
  const worktree = task.worktreePath.replace(/\/+$/, '');
  if (worktree === root || !isInside(service.cwd, root)) return null;
  return `${worktree}${service.cwd.slice(root.length).replace(/\/+$/, '')}`;
}

export function listTaskServices(
  state: ShinsaState,
  snapshot: TerminalsSnapshot | null,
  task: Task,
  now: number
): TaskServiceView[] {
  if (!snapshot) return [];
  return (snapshot.services ?? []).flatMap((service) => {
    const cwd = resolveTaskServiceCwd(state, service, task);
    if (cwd === null) return [];
    const terminal = selectServiceTerminal(snapshot, service.id, task.id);
    return [{ ...resolveServiceView(service, terminal, now, task.id), taskId: task.id, cwd }];
  });
}

export function listServiceTaskRuns(
  snapshot: TerminalsSnapshot | null,
  serviceId: string,
  now: number
): ServiceView[] {
  const service = snapshot?.services.find((each) => each.id === serviceId);
  if (!(snapshot && service)) return [];
  return snapshot.terminals
    .filter((terminal) => terminal.serviceId === serviceId && terminal.taskId !== null)
    .map((terminal) => resolveServiceView(service, terminal, now));
}

export function resolveServicesSummary(views: ServiceView[]): ServicesSummary {
  const count = (state: ServiceState) => views.filter((view) => view.state === state).length;
  return {
    total: views.length,
    running: count('running'),
    starting: count('starting'),
    failed: count('failed'),
  };
}

export function isServiceActive(view: Pick<ServiceView, 'state'>) {
  return view.state === 'running' || view.state === 'starting';
}

export function selectService(snapshot: TerminalsSnapshot, reference: string, projectId: string | null) {
  const wanted = reference.toLowerCase();
  const inProject = snapshot.services.filter(
    (service) => projectId === null || service.projectId === projectId
  );
  return (
    inProject.find((service) => service.id === reference) ??
    inProject.find((service) => service.name.toLowerCase() === wanted) ??
    null
  );
}
