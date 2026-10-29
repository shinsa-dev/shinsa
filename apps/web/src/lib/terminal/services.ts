import {
  isServiceActive,
  isServiceEnvKey,
  isServicePreviewUrl,
  listProjectServices,
  listServiceTaskRuns,
  type Project,
  resolveFocusProject,
  resolveServicesSummary,
  SERVICE_LIMITS,
  SERVICE_PORT_VARIABLE,
  type ServiceDefinition,
  type ServiceState,
  type ServiceSuggestion,
  type ServiceView,
  type ShinsaState,
  type Task,
  type TerminalInfo,
  type TerminalPlace,
  type TerminalsSnapshot,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { formatCount } from '@/lib/format/count.ts';
import { formatDuration } from '@/lib/format/time.ts';
import type { Tone } from '@/lib/format/tone.ts';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';
import { listProjects } from '@/lib/projects.ts';

export const SERVICE_GLYPHS: Record<ServiceState, { icon: IconName; activeIcon: IconName; tone: Tone }> = {
  stopped: { icon: 'IconCircleDashed', activeIcon: 'IconCircleDashedFilled', tone: 'neutral' },
  starting: { icon: 'IconHourglass', activeIcon: 'IconHourglassFilled', tone: 'blue' },
  running: { icon: 'IconPlay', activeIcon: 'IconPlayFilled', tone: 'green' },
  exited: { icon: 'IconCircleDashed', activeIcon: 'IconCircleDashedFilled', tone: 'neutral' },
  failed: { icon: 'IconExclamationCircle', activeIcon: 'IconExclamationCircleFilled', tone: 'red' },
};

const SERVICE_STATE_LABELS: Record<ServiceState, string> = {
  stopped: 'Stopped',
  starting: 'Starting',
  running: 'Running',
  exited: 'Exited',
  failed: 'Failed',
};

export const SERVICES_ICON: IconName = 'IconServer';

export const SERVICES_ACTIVE_ICON: IconName = 'IconServerFilled';

export interface TaskServiceRun {
  view: ServiceView;
  label: string;
}

export interface ServiceGroup {
  project: Project;
  views: ServiceView[];
  runs?: Record<string, TaskServiceRun[]>;
}

export function describeTaskRunLabel(task: Pick<Task, 'handle' | 'title'> | undefined) {
  if (!task) return 'A finished task';
  return task.handle ? `${task.handle} ${task.title}` : task.title;
}

export function listTaskServiceRuns(
  snapshot: TerminalsSnapshot | null,
  serviceId: string,
  tasks: Record<string, Task>,
  now: number
): TaskServiceRun[] {
  return listServiceTaskRuns(snapshot, serviceId, now)
    .filter((view) => isServiceActive(view) || view.state === 'failed')
    .map((view) => ({ view, label: describeTaskRunLabel(tasks[view.taskId ?? '']) }));
}

export function describeTaskServices(task: Pick<Task, 'handle'>) {
  return {
    title: task.handle ? `Services for ${task.handle}` : 'Services for this task',
    description: 'Each runs in this task’s worktree, beside your own run.',
  };
}

export function listProjectServiceRuns(snapshot: TerminalsSnapshot | null, projectId: string, now: number) {
  const main = listProjectServices(snapshot, projectId, now);
  return [...main, ...main.flatMap((view) => listServiceTaskRuns(snapshot, view.service.id, now))];
}

export function describeServiceState(view: ServiceView, now: number) {
  const label = SERVICE_STATE_LABELS[view.state];
  if (view.state === 'failed' && view.exitCode !== null) return `Failed with code ${view.exitCode}`;
  if (view.state === 'running' && view.since !== null)
    return `Running for ${formatDuration(now - view.since)}`;
  return label;
}

export function describeServicesTrigger(views: ServiceView[]): { label: string; tone: Tone } {
  const { running, starting, failed } = resolveServicesSummary(views);
  if (failed > 0) return { label: `${failed} failed`, tone: 'red' };
  if (starting > 0) return { label: `${starting} starting`, tone: 'blue' };
  if (running > 0) return { label: `${running} running`, tone: 'neutral' };
  return { label: 'Services', tone: 'neutral' };
}

export function describeTaskServicesFact(views: ServiceView[]): { label: string; tone: Tone } {
  const { running, starting, failed } = resolveServicesSummary(views);
  if (failed > 0) return { label: `${formatCount(failed, 'service', 'services')} failed`, tone: 'red' };
  if (starting > 0)
    return { label: `${formatCount(starting, 'service', 'services')} starting`, tone: 'blue' };
  if (running > 0)
    return { label: `${formatCount(running, 'service', 'services')} running`, tone: 'neutral' };
  return { label: 'Services', tone: 'neutral' };
}

export function describeServiceGroup(views: ServiceView[]): { label: string; tone: Tone }[] {
  const { running, starting, failed } = resolveServicesSummary(views);
  const parts: { label: string; tone: Tone }[] = [];
  if (failed > 0) parts.push({ label: `${failed} failed`, tone: 'red' });
  if (starting > 0) parts.push({ label: `${starting} starting`, tone: 'blue' });
  if (running > 0) parts.push({ label: `${running} running`, tone: 'neutral' });
  if (parts.length === 0 && views.length > 0)
    parts.push({ label: `${views.length} stopped`, tone: 'neutral' });
  return parts;
}

export function resolveServiceGroupId(projectId: string) {
  return createDisclosureId('services', 'project', projectId);
}

export function listStoppedServices(views: ServiceView[]) {
  return views.filter((view) => !isServiceActive(view));
}

export function canStartAll(views: ServiceView[]) {
  return listStoppedServices(views).length > 1;
}

export function describeStartAll(project: Project) {
  return `Start all services in ${project.name}`;
}

export function resolveActiveService(services: ServiceView[], active: TerminalInfo | null) {
  if (!active) return null;
  return services.find((view) => view.terminal?.id === active.id) ?? null;
}

export function describeServicesEmpty(project: Project | null) {
  return {
    title: project ? `No services in ${project.name} yet` : 'No services yet',
    description: 'A service is a command you keep running for a project, like its dev server.',
  };
}

export function resolveServicesProjects(state: ShinsaState, current: string | null, now: number) {
  const projects = listProjects(state);
  const pinned = current ?? resolveFocusProject(state, now);
  const project = pinned ? projects.find((each) => each.id === pinned) : undefined;
  return project ? [project] : projects;
}

export function listServiceGroups(
  snapshot: TerminalsSnapshot | null,
  projects: Project[],
  now: number,
  tasks: Record<string, Task> = {}
): ServiceGroup[] {
  return projects.flatMap((project) => {
    const views = listProjectServices(snapshot, project.id, now);
    const runs = Object.fromEntries(
      views.map((view) => [view.service.id, listTaskServiceRuns(snapshot, view.service.id, tasks, now)])
    );
    return views.length > 0 || projects.length === 1 ? [{ project, views, runs }] : [];
  });
}

export function resolveServicesAddTarget(scope: Project[], groups: ServiceGroup[]) {
  if (scope.length === 1) return scope[0] ?? null;
  if (groups.length === 1) return groups[0]?.project ?? null;
  return scope[0] ?? null;
}

export interface ServiceDraft {
  name: string;
  path: string;
  command: string;
  env: string;
  previewUrl: string;
  portVariable: string;
}

export type ServiceField = keyof ServiceDraft;

export type ServiceInput = Omit<ServiceDefinition, 'id' | 'projectId'>;

export function serializeServiceEnv(env: Record<string, string>) {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

export function createServiceDraft(from: ServiceDefinition | null): ServiceDraft {
  if (!from) return { name: '', path: '', command: '', env: '', previewUrl: '', portVariable: '' };
  return {
    name: from.name,
    path: from.cwd,
    command: from.command,
    env: serializeServiceEnv(from.env),
    previewUrl: from.previewUrl ?? '',
    portVariable: from.portVariable === SERVICE_PORT_VARIABLE ? '' : from.portVariable,
  };
}

export function parseServiceEnv(text: string): { env: Record<string, string> } | { error: string } {
  const env: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const split = line.indexOf('=');
    const key = (split < 0 ? line : line.slice(0, split)).replace(/^export\s+/, '').trim();
    if (split < 0 || !isServiceEnvKey(key))
      return { error: `Write each variable as NAME=value on a line of its own. “${line}” is not.` };
    env[key] = line
      .slice(split + 1)
      .trim()
      .replace(/^(["'])(.*)\1$/, '$2');
  }
  if (Object.keys(env).length > SERVICE_LIMITS.envKeys)
    return { error: `A service takes ${SERVICE_LIMITS.envKeys} variables at most.` };
  return { env };
}

export function validateServiceDraft(
  draft: ServiceDraft
): { ok: true; input: ServiceInput } | { ok: false; errors: Partial<Record<ServiceField, string>> } {
  const errors: Partial<Record<ServiceField, string>> = {};
  const name = draft.name.trim();
  const command = draft.command.trim();
  const path = draft.path.trim();
  if (!name) errors.name = 'Give the service a name.';
  else if (name.length > SERVICE_LIMITS.name)
    errors.name = `Keep the name to ${SERVICE_LIMITS.name} characters.`;
  if (!path) errors.path = 'Choose the folder it runs in.';
  if (!command) errors.command = 'Give the command that starts it.';
  const parsed = parseServiceEnv(draft.env);
  if ('error' in parsed) errors.env = parsed.error;
  const previewUrl = draft.previewUrl.trim() || null;
  if (previewUrl && (previewUrl.length > SERVICE_LIMITS.previewUrl || !isServicePreviewUrl(previewUrl)))
    errors.previewUrl = 'Give an http or https address, with {port} where the run’s port goes.';
  const portVariable = draft.portVariable.trim() || SERVICE_PORT_VARIABLE;
  if (!isServiceEnvKey(portVariable))
    errors.portVariable = 'Use letters, digits and _, not starting with a digit.';
  if (Object.keys(errors).length > 0 || 'error' in parsed) return { ok: false, errors };
  return { ok: true, input: { name, cwd: path, command, env: parsed.env, previewUrl, portVariable } };
}

export interface ServiceFolder {
  value: string;
  label: string;
}

export function listServicePlaces(places: TerminalPlace[]) {
  return places.filter((place) => place.kind !== 'worktree');
}

export function describeServiceFolder(path: string, places: TerminalPlace[]) {
  const place = places.find((each) => path === each.path || path.startsWith(`${each.path}/`));
  if (!place) return path;
  return path === place.path ? place.label : `${place.label}/${path.slice(place.path.length + 1)}`;
}

export function listServiceFolders(
  places: TerminalPlace[],
  suggestions: ServiceSuggestion[],
  home: string | null,
  current: string | null
): ServiceFolder[] {
  const paths = places.map((place) => place.path);
  if (paths.length === 0 && home) paths.push(home);
  for (const suggestion of suggestions) paths.push(suggestion.cwd);
  if (current) paths.push(current);
  return [...new Set(paths)].map((path) => ({
    value: path,
    label: path === home && places.length === 0 ? 'Home folder' : describeServiceFolder(path, places),
  }));
}

export function resolveSuggestionKey(suggestion: ServiceSuggestion) {
  return `${suggestion.cwd}\n${suggestion.command}`;
}

export function listRecommendedPicks(suggestions: ServiceSuggestion[]) {
  return suggestions.filter((each) => each.recommended).map(resolveSuggestionKey);
}

export function togglePick(picked: string[], key: string) {
  return picked.includes(key) ? picked.filter((each) => each !== key) : [...picked, key];
}

export function listPickedInputs(suggestions: ServiceSuggestion[], picked: string[]): ServiceInput[] {
  return suggestions
    .filter((each) => picked.includes(resolveSuggestionKey(each)))
    .map((each) => ({
      name: each.name,
      cwd: each.cwd,
      command: each.command,
      env: {},
      previewUrl: null,
      portVariable: SERVICE_PORT_VARIABLE,
    }));
}

export function listAllPicks(suggestions: ServiceSuggestion[], picked: string[]) {
  const keys = suggestions.map(resolveSuggestionKey);
  const all = keys.every((key) => picked.includes(key));
  return { label: all ? 'Deselect all' : 'Select all', picks: all ? [] : keys };
}

export function describeAddServices(count: number) {
  if (count === 0) return 'Add services';
  return count === 1 ? 'Add 1 service' : `Add ${count} services`;
}

export function describeServicesAdded(names: string[]) {
  if (names.length <= 2) return `Added ${names.join(' and ')}.`;
  return `Added ${names.length} services.`;
}

export function describeNoSuggestions(projectName: string) {
  return `No services found in ${projectName}. Name the command that starts one and the folder it runs in.`;
}

export type ServiceFormMode = 'add' | 'custom' | 'edit';

export function resolveServiceForm(mode: ServiceFormMode, name: string) {
  if (mode === 'edit')
    return {
      title: `Edit ${name || 'the service'}`,
      description: 'A change takes effect the next time it starts.',
      action: 'Save',
      done: 'Saved. Restart it to run the new command.',
    };
  return {
    title: mode === 'custom' ? 'Add a service' : 'Add services',
    description:
      mode === 'custom'
        ? 'Name the command that starts it and the folder it runs in.'
        : 'Each runs in a terminal of its own.',
    action: 'Add service',
    done: `Added ${name}.`,
  };
}

export type ServiceErrors = Partial<Record<ServiceField, string>>;

export function resolveShownErrors(errors: ServiceErrors, left: ServiceField[], submitted: boolean) {
  if (submitted) return errors;
  return Object.fromEntries(
    Object.entries(errors).filter(([field]) => left.includes(field as ServiceField))
  ) as ServiceErrors;
}

export const SERVICE_FIELDS: Record<
  ServiceField,
  { label: string; placeholder: string; note: string | null }
> = {
  name: { label: 'Name', placeholder: 'api', note: null },
  path: { label: 'Folder', placeholder: '', note: null },
  command: { label: 'Command', placeholder: 'bun run dev', note: null },
  env: {
    label: 'Environment',
    placeholder: 'PORT=4000',
    note: 'One NAME=value a line, added to your shell’s environment.',
  },
  previewUrl: {
    label: 'Preview',
    placeholder: 'http://localhost:{port}',
    note: 'Where Open takes you. Shinsa puts the run’s port where {port} is.',
  },
  portVariable: {
    label: 'Port variable',
    placeholder: SERVICE_PORT_VARIABLE,
    note: 'Each task’s run gets a free port in it, so the command must listen on it.',
  },
};

export function describeServicesRemove(services: ServiceDefinition[]) {
  const [only] = services;
  if (only && services.length === 1)
    return {
      question: `Remove ${only.name}?`,
      note: 'It stops and its terminal closes.',
      done: `Removed ${only.name}.`,
    };
  return {
    question: `Remove ${services.length} services?`,
    note: 'They stop and their terminals close.',
    done:
      services.length === 2
        ? `Removed ${services.map((service) => service.name).join(' and ')}.`
        : `Removed ${services.length} services.`,
  };
}

export function describeRemoveServices(count: number) {
  if (count === 0) return 'Remove services';
  return count === 1 ? 'Remove 1 service' : `Remove ${count} services`;
}

export function describeServiceClose(service: ServiceDefinition) {
  return `“${service.name}” stops and its terminal closes. Start it again from Services whenever you need it.`;
}
