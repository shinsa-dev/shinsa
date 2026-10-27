import {
  resolveTaskProject,
  resolveTaskTerminalPlace,
  type ServiceDefinition,
  type ServiceSuggestion,
  type ShinsaState,
  type Task,
  type TerminalForeground,
  type TerminalInfo,
  type TerminalPlace,
  type TerminalsSnapshot,
} from '@shinsa/core';
import { useSyncExternalStore } from 'react';
import { requestWithToast } from '@/lib/connection/commands.ts';
import { requestJson } from '@/lib/connection/http.ts';
import { connection } from '@/lib/connection/socket.ts';
import type { ServiceInput } from '@/lib/terminal/services.ts';
import { resolveTerminalPath } from '@/lib/terminal/tabs.ts';
import { selectTerminalView } from '@/lib/terminal/view.ts';
import { navigate } from '@/router.ts';

export function useTerminals() {
  return useSyncExternalStore(connection.subscribeTerminals, connection.selectTerminals);
}

async function requestTerminals(path: string, body: unknown) {
  const answer = await requestJson<TerminalsSnapshot>(path, body);
  connection.replaceTerminals(answer);
  return answer;
}

function terminalPath(id: string, action: string) {
  return `/api/terminals/${encodeURIComponent(id)}/${action}`;
}

export async function requestTerminalCreate(projectId: string, place: TerminalPlace, command?: string) {
  const answer = await requestJson<TerminalsSnapshot & { terminal: TerminalInfo }>('/api/terminals', {
    projectId,
    path: place.path,
    ...(command ? { command } : {}),
  });
  const { terminal, ...snapshot } = answer;
  connection.replaceTerminals(snapshot);
  return terminal;
}

export function openTerminal(projectKey: string, projectId: string, place: TerminalPlace, command?: string) {
  return requestWithToast(async () => {
    const terminal = await requestTerminalCreate(projectId, place, command);
    navigate(resolveTerminalPath(projectKey, terminal.id));
  });
}

export function selectTaskTerminal(state: ShinsaState | null, task: Task) {
  const projectId = state ? resolveTaskProject(state, task) : null;
  const project = projectId ? state?.projects[projectId] : undefined;
  const place = state ? resolveTaskTerminalPlace(state, task) : null;
  return project && place ? { project, place } : null;
}

export function openTaskTerminal(task: Task, command?: string) {
  return requestWithToast(async () => {
    const terminal = selectTaskTerminal(connection.snapshot().state, task);
    if (!terminal) throw new Error('This task has no project folder to open a terminal in.');
    const { project, place } = terminal;
    const created = await requestTerminalCreate(project.id, place, command);
    navigate(resolveTerminalPath(project.key, created.id));
  });
}

export function renameTerminal(id: string, name: string | null) {
  return requestWithToast(() => requestTerminals(terminalPath(id, 'rename'), { name }));
}

export function restartTerminal(id: string) {
  return requestWithToast(() => requestTerminals(terminalPath(id, 'restart'), {}));
}

export function closeTerminal(id: string) {
  return requestWithToast(() => requestTerminals(terminalPath(id, 'close'), {}));
}

export function reorderTerminals(projectId: string, ids: string[]) {
  return requestWithToast(() => requestTerminals('/api/terminals/order', { projectId, ids }));
}

export function requestTerminalForeground(id: string) {
  return requestJson<TerminalForeground>(`/api/terminals/${encodeURIComponent(id)}/foreground`);
}

export async function requestServiceSuggestions(projectId: string) {
  const answer = await requestJson<{ suggestions: ServiceSuggestion[] }>(
    `/api/services/suggestions?projectId=${encodeURIComponent(projectId)}`
  );
  return answer.suggestions;
}

function servicePath(id: string, action: string) {
  return `/api/services/${encodeURIComponent(id)}/${action}`;
}

export async function requestServiceAdd(projectId: string, input: ServiceInput) {
  const { service, ...snapshot } = await requestJson<TerminalsSnapshot & { service: ServiceDefinition }>(
    '/api/services',
    { projectId, name: input.name, path: input.cwd, command: input.command, env: input.env }
  );
  connection.replaceTerminals(snapshot);
  return service;
}

export async function requestServicesAdd(projectId: string, inputs: ServiceInput[]) {
  const { added, ...snapshot } = await requestJson<TerminalsSnapshot & { added: ServiceDefinition[] }>(
    '/api/services/batch',
    {
      projectId,
      services: inputs.map((input) => ({
        name: input.name,
        path: input.cwd,
        command: input.command,
        env: input.env,
      })),
    }
  );
  connection.replaceTerminals(snapshot);
  return added;
}

export function requestServiceUpdate(id: string, input: ServiceInput) {
  return requestTerminals(servicePath(id, 'update'), {
    name: input.name,
    path: input.cwd,
    command: input.command,
    env: input.env,
  });
}

export function requestServicesRemove(ids: string[]) {
  return requestTerminals('/api/services/remove', { ids });
}

async function requestServiceRun(id: string, action: 'start' | 'restart') {
  const { terminal, ...snapshot } = await requestJson<TerminalsSnapshot & { terminal: TerminalInfo }>(
    servicePath(id, action),
    {}
  );
  connection.replaceTerminals(snapshot);
  return terminal;
}

export function startService(id: string) {
  return requestWithToast(() => requestServiceRun(id, 'start'));
}

export function restartService(id: string) {
  return requestWithToast(() => requestServiceRun(id, 'restart'));
}

export function stopService(id: string) {
  return requestWithToast(() => requestTerminals(servicePath(id, 'stop'), {}));
}

export function startAllServices(projectId: string) {
  return requestWithToast(() => requestTerminals('/api/services/start-all', { projectId }));
}

export function openServiceTerminal(projectKey: string, terminalId: string) {
  navigate(resolveTerminalPath(projectKey, terminalId));
  selectTerminalView(terminalId)?.focus();
}
