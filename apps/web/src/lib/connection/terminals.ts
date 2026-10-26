import {
  resolveTaskProject,
  resolveTaskTerminalPlace,
  type Task,
  type TerminalInfo,
  type TerminalPlace,
  type TerminalsSnapshot,
} from '@shinsa/core';
import { useSyncExternalStore } from 'react';
import { requestWithToast } from '@/lib/connection/commands.ts';
import { requestJson } from '@/lib/connection/http.ts';
import { connection } from '@/lib/connection/socket.ts';
import { resolveTerminalPath } from '@/lib/terminal/tabs.ts';
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

export function openTaskTerminal(task: Task, command?: string) {
  return requestWithToast(async () => {
    const state = connection.snapshot().state;
    const projectId = state ? resolveTaskProject(state, task) : null;
    const project = projectId ? state?.projects[projectId] : undefined;
    const place = state ? resolveTaskTerminalPlace(state, task) : null;
    if (!(project && place)) throw new Error('This task has no project folder to open a terminal in.');
    const terminal = await requestTerminalCreate(project.id, place, command);
    navigate(resolveTerminalPath(project.key, terminal.id));
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
