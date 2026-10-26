import {
  isServiceEnvKey,
  listProjectServices,
  type Project,
  resolveFocusProject,
  resolveServicesSummary,
  SERVICE_LIMITS,
  type ServiceDefinition,
  type ServiceState,
  type ServiceSuggestion,
  type ServiceView,
  type ShinsaState,
  type TerminalsSnapshot,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { formatDuration } from '@/lib/format/time.ts';
import type { Tone } from '@/lib/format/tone.ts';
import { listProjects } from '@/lib/projects.ts';

export const SERVICE_GLYPHS: Record<ServiceState, { icon: IconName; tone: Tone }> = {
  stopped: { icon: 'IconStop', tone: 'neutral' },
  starting: { icon: 'IconHourglass', tone: 'blue' },
  running: { icon: 'IconPlay', tone: 'green' },
  exited: { icon: 'IconStop', tone: 'neutral' },
  failed: { icon: 'IconExclamationCircle', tone: 'red' },
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

export interface ServiceGroup {
  project: Project;
  views: ServiceView[];
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

export function resolveServicesProjects(state: ShinsaState, current: string | null, now: number) {
  const projects = listProjects(state);
  const pinned = current ?? resolveFocusProject(state, now);
  const project = pinned ? projects.find((each) => each.id === pinned) : undefined;
  return project ? [project] : projects;
}

export function listServiceGroups(
  snapshot: TerminalsSnapshot | null,
  projects: Project[],
  now: number
): ServiceGroup[] {
  return projects.flatMap((project) => {
    const views = listProjectServices(snapshot, project.id, now);
    return views.length > 0 || projects.length === 1 ? [{ project, views }] : [];
  });
}

export interface ServiceDraft {
  name: string;
  path: string;
  command: string;
  env: string;
}

export type ServiceField = keyof ServiceDraft;

export type ServiceInput = Omit<ServiceDefinition, 'id' | 'projectId'>;

export function serializeServiceEnv(env: Record<string, string>) {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

export function createServiceDraft(
  from: ServiceDefinition | ServiceSuggestion | null,
  path: string | null
): ServiceDraft {
  if (!from) return { name: '', path: path ?? '', command: '', env: '' };
  return {
    name: from.name,
    path: from.cwd,
    command: from.command,
    env: 'env' in from ? serializeServiceEnv(from.env) : '',
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
  if (Object.keys(errors).length > 0 || 'error' in parsed) return { ok: false, errors };
  return { ok: true, input: { name, cwd: path, command, env: parsed.env } };
}

export function describeSuggestionSource(suggestion: ServiceSuggestion, root: string | null) {
  const where = root && suggestion.cwd.startsWith(`${root}/`) ? suggestion.cwd.slice(root.length + 1) : null;
  return where ? `${suggestion.command} in ${where}` : suggestion.command;
}

export type ServiceDialogMode = 'add' | 'edit';

export function resolveServiceDialog(mode: ServiceDialogMode, name: string) {
  if (mode === 'edit')
    return {
      title: `Edit ${name || 'the service'}`,
      description: 'A change takes effect the next time it starts.',
      action: 'Save',
      done: 'Saved. Restart it to run the new command.',
    };
  return {
    title: 'Add a service',
    description:
      'A service is a command you keep running for a project, such as its dev server. It runs in a terminal of its own, in your login shell.',
    action: 'Add service',
    done: `Added ${name}.`,
  };
}

export const SERVICE_FIELDS: Record<
  ServiceField,
  { label: string; placeholder: string; note: string | null }
> = {
  name: { label: 'Name', placeholder: 'api', note: null },
  path: {
    label: 'Folder',
    placeholder: '/Users/you/Developer/shop/apps/api',
    note: 'One of the project’s folders, or a folder inside one.',
  },
  command: { label: 'Command', placeholder: 'bun run dev', note: null },
  env: {
    label: 'Environment',
    placeholder: 'PORT=4000',
    note: 'One NAME=value a line, added to your shell’s environment.',
  },
};

export function describeServiceRemove(service: ServiceDefinition) {
  return `Shinsa stops “${service.name}” if it runs and forgets it. Its terminal closes.`;
}

export function describeServiceClose(service: ServiceDefinition) {
  return `“${service.name}” stops and its terminal closes. Start it again from Services whenever you need it.`;
}
