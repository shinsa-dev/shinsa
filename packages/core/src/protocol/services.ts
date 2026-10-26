import type { TerminalInfo, TerminalsSnapshot } from './terminals.ts';

export interface ServiceDefinition {
  id: string;
  projectId: string;
  name: string;
  cwd: string;
  command: string;
  env: Record<string, string>;
}

export type ServiceSource = 'package' | 'procfile' | 'compose';

export interface ServiceSuggestion {
  name: string;
  cwd: string;
  command: string;
  source: ServiceSource;
}

export type ServiceState = 'stopped' | 'starting' | 'running' | 'exited' | 'failed';

export interface ServiceView {
  service: ServiceDefinition;
  terminal: TerminalInfo | null;
  state: ServiceState;
  exitCode: number | null;
  since: number | null;
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
  now: number
): ServiceView {
  const state = resolveServiceState(terminal, now);
  const since = terminal ? (terminal.status === 'running' ? terminal.startedAt : terminal.endedAt) : null;
  return { service, terminal, state, exitCode: terminal?.exitCode ?? null, since };
}

export function listProjectServices(
  snapshot: TerminalsSnapshot | null,
  projectId: string | null,
  now: number
): ServiceView[] {
  if (!snapshot || !projectId) return [];
  return snapshot.services
    .filter((service) => service.projectId === projectId)
    .map((service) =>
      resolveServiceView(
        service,
        snapshot.terminals.find((terminal) => terminal.serviceId === service.id) ?? null,
        now
      )
    );
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
