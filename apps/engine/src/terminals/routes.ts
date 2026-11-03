import { statSync } from 'node:fs';
import {
  DomainError,
  isServiceEnvKey,
  isServicePreviewUrl,
  listTerminalPlaces,
  parseTerminalClientFrame,
  resolveTaskServiceCwd,
  SERVICE_LIMITS,
  SERVICE_PORT_VARIABLE,
  type ServiceDefinition,
  type ServiceSuggestion,
  type ShinsaState,
  type TerminalPlace,
  TERMINAL_STREAM_CLOSE,
  type TerminalPlaceKind,
} from '@shinsa/core';
import type { ServerWebSocket } from 'bun';
import { resolveSharedCacheEnv } from '../checks/caches.ts';
import type { JsonObject } from '../http/schema.ts';
import { listServiceSuggestions } from './detect.ts';
import type { ServiceInput, ServiceRun, TerminalStart, Terminals, TerminalViewer } from './index.ts';
import type { TerminalSession } from './session.ts';

export interface TerminalSocketData {
  kind: 'terminal';
  terminalId: string;
  viewer: TerminalViewer | null;
}

const SOCKET_PATH = /^\/ws\/terminals\/([A-Za-z0-9-]{1,64})$/;

const CLOSED = TERMINAL_STREAM_CLOSE.gone;

export function readText(body: JsonObject, field: string, limit: number) {
  const value = body[field];
  if (typeof value !== 'string' || value.length === 0 || value.length > limit)
    throw new DomainError({
      code: 'body_invalid',
      message: `Send “${field}” as text of at most ${limit} characters.`,
    });
  return value;
}

export function readOptionalText(body: JsonObject, field: string, limit: number) {
  return body[field] === undefined || body[field] === null ? null : readText(body, field, limit);
}

export function isFolder(path: string) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function resolveTerminalStart(
  places: TerminalPlace[],
  projectId: string,
  path: string,
  home: string
): TerminalStart {
  const place = places.find((each) => each.path === path);
  const homePlace: TerminalPlaceKind | null = places.length === 0 && path === home ? 'folder' : null;
  if (!(place || homePlace))
    throw new DomainError({ code: 'terminal_place_invalid', message: 'Pick one of the project’s folders.' });
  if (!isFolder(path))
    throw new DomainError({ code: 'terminal_place_missing', message: 'That folder is not there anymore.' });
  return { projectId, cwd: path, place: place?.kind ?? 'folder', taskId: place?.taskId ?? null };
}

function isInside(path: string, folder: string) {
  const base = folder.replace(/\/+$/, '');
  return path === base || path === folder || path.startsWith(`${base}/`);
}

export function resolveServicePlace(
  places: TerminalPlace[],
  cwd: string,
  home: string
): TerminalPlaceKind | null {
  const own = places.filter((each) => each.kind !== 'worktree');
  const found = own.find((each) => isInside(cwd, each.path));
  if (found) return found.kind;
  return own.length === 0 && isInside(cwd, home) ? 'folder' : null;
}

function readEnv(body: JsonObject) {
  const value = body.env ?? {};
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new DomainError({ code: 'body_invalid', message: 'Send “env” as an object of names and values.' });
  const entries = Object.entries(value);
  if (entries.length > SERVICE_LIMITS.envKeys)
    throw new DomainError({
      code: 'body_invalid',
      message: `A service takes ${SERVICE_LIMITS.envKeys} variables at most.`,
    });
  const env: Record<string, string> = {};
  for (const [key, each] of entries) {
    if (!isServiceEnvKey(key))
      throw new DomainError({ code: 'service_env_invalid', message: `“${key}” is not a variable name.` });
    if (typeof each !== 'string' || each.length > SERVICE_LIMITS.envValue)
      throw new DomainError({ code: 'service_env_invalid', message: `The value of “${key}” is too long.` });
    env[key] = each;
  }
  return env;
}

function readPreviewUrl(body: JsonObject) {
  const url = readOptionalText(body, 'previewUrl', SERVICE_LIMITS.previewUrl)?.trim() || null;
  if (url !== null && !isServicePreviewUrl(url))
    throw new DomainError({
      code: 'service_preview_invalid',
      message: 'Put {port} in an http or https URL.',
    });
  return url;
}

function readPortVariable(body: JsonObject) {
  const name = readOptionalText(body, 'portVariable', 200)?.trim() || SERVICE_PORT_VARIABLE;
  if (!isServiceEnvKey(name))
    throw new DomainError({ code: 'service_env_invalid', message: `“${name}” is not a variable name.` });
  return name;
}

export function readServiceInput(
  body: JsonObject,
  others: ServiceDefinition[],
  places: TerminalPlace[],
  home: string
): ServiceInput {
  const name = readText(body, 'name', SERVICE_LIMITS.name).trim();
  if (!name) throw new DomainError({ code: 'body_invalid', message: 'Give the service a name.' });
  if (others.some((service) => service.name.toLowerCase() === name.toLowerCase()))
    throw new DomainError({ code: 'service_name_taken', message: 'Another service has that name.' });
  const cwd = readText(body, 'path', 4096);
  if (!resolveServicePlace(places, cwd, home))
    throw new DomainError({ code: 'service_place_invalid', message: 'Pick one of the project’s folders.' });
  if (!isFolder(cwd))
    throw new DomainError({ code: 'terminal_place_missing', message: 'That folder is not there anymore.' });
  const command = readText(body, 'command', SERVICE_LIMITS.command).trim();
  if (!command)
    throw new DomainError({ code: 'body_invalid', message: 'Give the service a command to run.' });
  return {
    name,
    cwd,
    command,
    env: readEnv(body),
    previewUrl: readPreviewUrl(body),
    portVariable: readPortVariable(body),
  };
}

export function readServiceBatch(
  body: JsonObject,
  others: ServiceDefinition[],
  places: TerminalPlace[],
  home: string
): ServiceInput[] {
  const list = body.services;
  if (!Array.isArray(list) || list.length === 0 || list.length > SERVICE_LIMITS.services)
    throw new DomainError({
      code: 'body_invalid',
      message: `Send “services” as a list of 1 to ${SERVICE_LIMITS.services} services.`,
    });
  const inputs: ServiceInput[] = [];
  for (const each of list) {
    if (!each || typeof each !== 'object' || Array.isArray(each))
      throw new DomainError({ code: 'body_invalid', message: 'Send each service as an object.' });
    const taken = [...others, ...inputs.map((input) => ({ ...input, id: '', projectId: '' }))];
    inputs.push(readServiceInput(each as JsonObject, taken, places, home));
  }
  return inputs;
}

export function readServiceIds(body: JsonObject) {
  const ids = body.ids;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > SERVICE_LIMITS.services ||
    ids.some((id) => typeof id !== 'string')
  )
    throw new DomainError({
      code: 'body_invalid',
      message: `Send “ids” as a list of 1 to ${SERVICE_LIMITS.services} service ids.`,
    });
  return [...new Set(ids as string[])];
}

export function listNewServiceSuggestions(suggestions: ServiceSuggestion[], services: ServiceDefinition[]) {
  return suggestions.filter(
    (suggestion) =>
      !services.some(
        (service) =>
          service.name.toLowerCase() === suggestion.name.toLowerCase() ||
          (service.cwd === suggestion.cwd && service.command === suggestion.command)
      )
  );
}

export function listNewSuggestions(
  places: TerminalPlace[],
  services: ServiceDefinition[]
): ServiceSuggestion[] {
  const roots = places.filter((place) => place.kind !== 'worktree').map((place) => place.path);
  return listNewServiceSuggestions(listServiceSuggestions(roots), services);
}

export function resolveServicePlaceIn(state: ShinsaState, service: ServiceDefinition, home: string) {
  return resolveServicePlace(listTerminalPlaces(state, service.projectId), service.cwd, home);
}

export interface ServiceMachine {
  home: string;
  dataDir: string;
}

export function resolveServiceRunIn(
  state: ShinsaState,
  service: ServiceDefinition,
  taskId: string | null,
  machine: ServiceMachine
): ServiceRun | null {
  if (taskId === null) {
    const place = resolveServicePlaceIn(state, service, machine.home);
    return place ? { cwd: service.cwd, place, taskId: null } : null;
  }
  const task = state.tasks[taskId];
  if (!(task?.worktreePath && task.repoId)) return null;
  const cwd = resolveTaskServiceCwd(state, service, task);
  if (cwd === null) return null;
  const env = resolveSharedCacheEnv(task.worktreePath, machine.dataDir, task.repoId);
  return { cwd, place: 'worktree', taskId, env };
}

export function readTerminalSocketId(pathname: string) {
  return SOCKET_PATH.exec(pathname)?.[1] ?? null;
}

type TerminalSocket = ServerWebSocket<TerminalSocketData>;

export function applyTerminalText(session: TerminalSession, raw: string) {
  const frame = parseTerminalClientFrame(raw);
  if (frame?.type === 'resize') session.resize(frame.cols, frame.rows);
  if (frame?.type === 'colors') session.replaceColors(frame.colors);
  if (frame?.type === 'clear') session.clear();
}

export function createTerminalSockets(terminals: Terminals) {
  return {
    open(socket: TerminalSocket) {
      const session = terminals.select(socket.data.terminalId);
      if (!session) {
        socket.close(CLOSED, 'That terminal is closed.');
        return;
      }
      const viewer: TerminalViewer = {
        send: (data) => socket.send(data),
        buffered: () => socket.getBufferedAmount(),
        end: () => socket.close(CLOSED, 'That terminal is closed.'),
      };
      socket.data.viewer = viewer;
      session.attach(viewer);
    },
    message(socket: TerminalSocket, raw: string | Buffer) {
      const session = terminals.select(socket.data.terminalId);
      if (!session) return;
      if (typeof raw !== 'string') {
        session.input(new Uint8Array(raw));
        return;
      }
      applyTerminalText(session, raw);
    },
    drain(socket: TerminalSocket) {
      const { viewer } = socket.data;
      if (viewer) terminals.select(socket.data.terminalId)?.drain(viewer);
    },
    close(socket: TerminalSocket) {
      const { viewer } = socket.data;
      if (viewer) terminals.select(socket.data.terminalId)?.detach(viewer);
      socket.data.viewer = null;
    },
  };
}
