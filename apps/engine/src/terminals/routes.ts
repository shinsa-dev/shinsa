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
  TERMINAL_LIMITS,
  type TerminalPlace,
  type TerminalPlaceKind,
} from '@shinsa/core';
import type { ServerWebSocket } from 'bun';
import { type JsonObject, readJsonObject } from '../http/body.ts';
import type { Engine } from '../runtime/engine.ts';
import { listServiceSuggestions } from './detect.ts';
import type { ServiceInput, ServiceRun, TerminalStart, Terminals, TerminalViewer } from './index.ts';
import type { ServiceRefiner } from './refine.ts';

export interface TerminalRoute {
  method: 'GET' | 'POST';
  pattern: RegExp;
  respond: (match: RegExpExecArray, request: Request) => Promise<Response>;
}

export interface TerminalSocketData {
  kind: 'terminal';
  terminalId: string;
  viewer: TerminalViewer | null;
}

const SOCKET_PATH = /^\/ws\/terminals\/([A-Za-z0-9-]{1,64})$/;

const CLOSED = 4404;

const BROWSER_ONLY = 'Only Shinsa’s own page opens and types into your terminals.';

function readText(body: JsonObject, field: string, limit: number) {
  const value = body[field];
  if (typeof value !== 'string' || value.length === 0 || value.length > limit)
    throw new DomainError('body_invalid', `Send “${field}” as text of at most ${limit} characters.`);
  return value;
}

function readOptionalText(body: JsonObject, field: string, limit: number) {
  return body[field] === undefined || body[field] === null ? null : readText(body, field, limit);
}

async function readTaskId(request: Request) {
  if (!request.body) return null;
  return readOptionalText(await readJsonObject(request), 'taskId', 200);
}

function isFolder(path: string) {
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
    throw new DomainError('terminal_place_invalid', 'Open a terminal in one of the project’s folders.');
  if (!isFolder(path))
    throw new DomainError('terminal_place_missing', `The folder ${path} is not there anymore.`);
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
    throw new DomainError('body_invalid', 'Send “env” as an object of names and values.');
  const entries = Object.entries(value);
  if (entries.length > SERVICE_LIMITS.envKeys)
    throw new DomainError('body_invalid', `A service takes ${SERVICE_LIMITS.envKeys} variables at most.`);
  const env: Record<string, string> = {};
  for (const [key, each] of entries) {
    if (!isServiceEnvKey(key))
      throw new DomainError(
        'service_env_invalid',
        `“${key}” is not a variable name: use letters, digits and _, not starting with a digit.`
      );
    if (typeof each !== 'string' || each.length > SERVICE_LIMITS.envValue)
      throw new DomainError(
        'service_env_invalid',
        `Give “${key}” a value of at most ${SERVICE_LIMITS.envValue} characters.`
      );
    env[key] = each;
  }
  return env;
}

function readPreviewUrl(body: JsonObject) {
  const url = readOptionalText(body, 'previewUrl', SERVICE_LIMITS.previewUrl)?.trim() || null;
  if (url !== null && !isServicePreviewUrl(url))
    throw new DomainError(
      'service_preview_invalid',
      'Give the preview as an http or https URL, with {port} where the run’s port goes.'
    );
  return url;
}

function readPortVariable(body: JsonObject) {
  const name = readOptionalText(body, 'portVariable', 200)?.trim() || SERVICE_PORT_VARIABLE;
  if (!isServiceEnvKey(name))
    throw new DomainError(
      'service_env_invalid',
      `“${name}” is not a variable name: use letters, digits and _, not starting with a digit.`
    );
  return name;
}

export function readServiceInput(
  body: JsonObject,
  others: ServiceDefinition[],
  places: TerminalPlace[],
  home: string
): ServiceInput {
  const name = readText(body, 'name', SERVICE_LIMITS.name).trim();
  if (!name) throw new DomainError('body_invalid', 'Give the service a name.');
  if (others.some((service) => service.name.toLowerCase() === name.toLowerCase()))
    throw new DomainError('service_name_taken', `This project already has a service called “${name}”.`);
  const cwd = readText(body, 'path', 4096);
  if (!resolveServicePlace(places, cwd, home))
    throw new DomainError('service_place_invalid', 'Run a service in one of the project’s folders.');
  if (!isFolder(cwd))
    throw new DomainError('terminal_place_missing', `The folder ${cwd} is not there anymore.`);
  const command = readText(body, 'command', SERVICE_LIMITS.command).trim();
  if (!command) throw new DomainError('body_invalid', 'Give the service a command to run.');
  return {
    name,
    cwd,
    command,
    env: readEnv(body),
    previewUrl: readPreviewUrl(body),
    portVariable: readPortVariable(body),
  };
}

function readServiceBatch(
  body: JsonObject,
  others: ServiceDefinition[],
  places: TerminalPlace[],
  home: string
): ServiceInput[] {
  const list = body.services;
  if (!Array.isArray(list) || list.length === 0 || list.length > SERVICE_LIMITS.services)
    throw new DomainError(
      'body_invalid',
      `Send “services” as a list of 1 to ${SERVICE_LIMITS.services} services.`
    );
  const inputs: ServiceInput[] = [];
  for (const each of list) {
    if (!each || typeof each !== 'object' || Array.isArray(each))
      throw new DomainError('body_invalid', 'Send each service as an object.');
    const taken = [...others, ...inputs.map((input) => ({ ...input, id: '', projectId: '' }))];
    inputs.push(readServiceInput(each as JsonObject, taken, places, home));
  }
  return inputs;
}

function readServiceIds(body: JsonObject) {
  const ids = body.ids;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > SERVICE_LIMITS.services ||
    ids.some((id) => typeof id !== 'string')
  )
    throw new DomainError(
      'body_invalid',
      `Send “ids” as a list of 1 to ${SERVICE_LIMITS.services} service ids.`
    );
  return [...new Set(ids as string[])];
}

function listNewServiceSuggestions(suggestions: ServiceSuggestion[], services: ServiceDefinition[]) {
  return suggestions.filter(
    (suggestion) =>
      !services.some(
        (service) =>
          service.name.toLowerCase() === suggestion.name.toLowerCase() ||
          (service.cwd === suggestion.cwd && service.command === suggestion.command)
      )
  );
}

function listNewSuggestions(places: TerminalPlace[], services: ServiceDefinition[]): ServiceSuggestion[] {
  const roots = places.filter((place) => place.kind !== 'worktree').map((place) => place.path);
  return listNewServiceSuggestions(listServiceSuggestions(roots), services);
}

function resolveBrowserRefusal(request: Request) {
  return request.headers.get('origin') === null ? BROWSER_ONLY : null;
}

function resolveServicePlaceIn(state: ShinsaState, service: ServiceDefinition, home: string) {
  return resolveServicePlace(listTerminalPlaces(state, service.projectId), service.cwd, home);
}

export function resolveServiceRunIn(
  state: ShinsaState,
  service: ServiceDefinition,
  taskId: string | null,
  home: string
): ServiceRun | null {
  if (taskId === null) {
    const place = resolveServicePlaceIn(state, service, home);
    return place ? { cwd: service.cwd, place, taskId: null } : null;
  }
  const task = state.tasks[taskId];
  const cwd = task ? resolveTaskServiceCwd(state, service, task) : null;
  return cwd === null ? null : { cwd, place: 'worktree', taskId };
}

export function readTerminalSocketId(pathname: string) {
  return SOCKET_PATH.exec(pathname)?.[1] ?? null;
}

export function createTerminalRoutes(
  engine: Engine,
  terminals: Terminals,
  refiner: ServiceRefiner | null = null
): TerminalRoute[] {
  const { home } = terminals;
  const respond = (body: unknown) => Response.json(body);
  const guarded =
    (handler: (match: RegExpExecArray, body: JsonObject) => unknown) =>
    async (match: RegExpExecArray, request: Request) => {
      const refusal = resolveBrowserRefusal(request);
      if (refusal) throw new DomainError('browser_only', refusal);
      return respond((await handler(match, await readJsonObject(request))) ?? terminals.snapshot());
    };
  const withTask =
    (handler: (match: RegExpExecArray, taskId: string | null) => unknown) =>
    async (match: RegExpExecArray, request: Request) => {
      const taskId = await readTaskId(request);
      return respond((await handler(match, taskId)) ?? terminals.snapshot());
    };
  const id = (match: RegExpExecArray) => decodeURIComponent(match[1] ?? '');
  const projectOf = (projectId: string) => {
    if (!engine.state.projects[projectId])
      throw new DomainError('project_not_found', 'That project is not there anymore.');
    return listTerminalPlaces(engine.state, projectId);
  };
  const others = (projectId: string, except: string | null) =>
    terminals.snapshot().services.filter((each) => each.projectId === projectId && each.id !== except);
  const placeOf = (service: ServiceDefinition) => resolveServicePlaceIn(engine.state, service, home);
  const serviceRun = (serviceId: string, taskId: string | null): ServiceRun => {
    const service = terminals.findService(serviceId);
    if (taskId !== null && !engine.state.tasks[taskId])
      throw new DomainError('task_not_found', 'That task is not there anymore.');
    const run = resolveServiceRunIn(engine.state, service, taskId, home);
    if (!run)
      throw new DomainError(
        'service_place_invalid',
        taskId === null
          ? 'This service’s folder is no longer in its project. Edit it to run it somewhere else.'
          : `${service.name} cannot run for this task: its folder is not in the task’s repository, or the task has no worktree of its own.`
      );
    if (!isFolder(run.cwd))
      throw new DomainError('terminal_place_missing', `The folder ${run.cwd} is not there anymore.`);
    return run;
  };
  return [
    {
      method: 'GET',
      pattern: /^\/api\/terminals\/([^/]+)\/foreground$/,
      respond: async (match) => respond(await terminals.readForeground(id(match))),
    },
    {
      method: 'GET',
      pattern: /^\/api\/services\/suggestions$/,
      respond: async (_match, request) => {
        const params = new URL(request.url).searchParams;
        const projectId = params.get('projectId') ?? '';
        const suggestions = listNewSuggestions(projectOf(projectId), others(projectId, null));
        if (!(refiner && params.get('refine') === '1')) return respond({ suggestions, refined: false });
        const answer = await refiner.refine(projectId, suggestions);
        return respond({
          suggestions: listNewServiceSuggestions(answer.suggestions, others(projectId, null)),
          refined: answer.refined,
        });
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/services$/,
      respond: guarded((_match, body) => {
        const projectId = readText(body, 'projectId', 200);
        const places = projectOf(projectId);
        const service = terminals.addService(
          projectId,
          readServiceInput(body, others(projectId, null), places, home)
        );
        return { service, ...terminals.snapshot() };
      }),
    },
    {
      method: 'POST',
      pattern: /^\/api\/services\/batch$/,
      respond: guarded((_match, body) => {
        const projectId = readText(body, 'projectId', 200);
        const places = projectOf(projectId);
        const inputs = readServiceBatch(body, others(projectId, null), places, home);
        if (terminals.snapshot().services.length + inputs.length > SERVICE_LIMITS.services)
          throw new DomainError(
            'service_limit',
            `Shinsa keeps ${SERVICE_LIMITS.services} services at most. Remove some to add these.`
          );
        const added = inputs.map((input) => terminals.addService(projectId, input));
        return { added, ...terminals.snapshot() };
      }),
    },
    {
      method: 'POST',
      pattern: /^\/api\/services\/remove$/,
      respond: guarded((_match, body) => {
        terminals.removeServices(readServiceIds(body));
      }),
    },
    {
      method: 'POST',
      pattern: /^\/api\/services\/start-all$/,
      respond: async (_match, request) => {
        const projectId = readText(await readJsonObject(request), 'projectId', 200);
        projectOf(projectId);
        for (const service of others(projectId, null)) {
          const place = placeOf(service);
          if (place) terminals.startService(service.id, { cwd: service.cwd, place, taskId: null });
        }
        return respond(terminals.snapshot());
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/services\/([^/]+)\/update$/,
      respond: guarded((match, body) => {
        const service = terminals.findService(id(match));
        terminals.updateService(
          service.id,
          readServiceInput(body, others(service.projectId, service.id), projectOf(service.projectId), home)
        );
      }),
    },
    {
      method: 'POST',
      pattern: /^\/api\/services\/([^/]+)\/start$/,
      respond: withTask((match, taskId) => ({
        terminal: terminals.startService(id(match), serviceRun(id(match), taskId)),
        ...terminals.snapshot(),
      })),
    },
    {
      method: 'POST',
      pattern: /^\/api\/services\/([^/]+)\/stop$/,
      respond: withTask(async (match, taskId) => {
        await terminals.stopService(id(match), taskId);
      }),
    },
    {
      method: 'POST',
      pattern: /^\/api\/services\/([^/]+)\/restart$/,
      respond: withTask(async (match, taskId) => ({
        terminal: await terminals.restartService(id(match), serviceRun(id(match), taskId)),
        ...terminals.snapshot(),
      })),
    },
    {
      method: 'GET',
      pattern: /^\/api\/terminals$/,
      respond: () => Promise.resolve(respond(terminals.snapshot())),
    },
    {
      method: 'POST',
      pattern: /^\/api\/terminals$/,
      respond: guarded((_match, body) => {
        const projectId = readText(body, 'projectId', 200);
        if (!engine.state.projects[projectId])
          throw new DomainError('project_not_found', 'That project is not there anymore.');
        const path = readText(body, 'path', 4096);
        const command = readOptionalText(body, 'command', TERMINAL_LIMITS.command);
        const start = resolveTerminalStart(
          listTerminalPlaces(engine.state, projectId),
          projectId,
          path,
          home
        );
        const terminal = terminals.create(start);
        if (command) terminals.run(terminal.id, command);
        return { terminal, ...terminals.snapshot() };
      }),
    },
    {
      method: 'POST',
      pattern: /^\/api\/terminals\/order$/,
      respond: guarded((_match, body) => {
        const ids = Array.isArray(body.ids) ? body.ids.filter((each) => typeof each === 'string') : [];
        terminals.reorder(readText(body, 'projectId', 200), ids);
      }),
    },
    {
      method: 'POST',
      pattern: /^\/api\/terminals\/([^/]+)\/rename$/,
      respond: guarded((match, body) => {
        terminals.rename(id(match), readOptionalText(body, 'name', TERMINAL_LIMITS.name));
      }),
    },
    {
      method: 'POST',
      pattern: /^\/api\/terminals\/([^/]+)\/restart$/,
      respond: guarded((match) => {
        terminals.restart(id(match));
      }),
    },
    {
      method: 'POST',
      pattern: /^\/api\/terminals\/([^/]+)\/close$/,
      respond: guarded((match) => {
        terminals.close(id(match));
      }),
    },
  ];
}

type TerminalSocket = ServerWebSocket<TerminalSocketData>;

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
      const frame = parseTerminalClientFrame(raw);
      if (frame?.type === 'resize') session.resize(frame.cols, frame.rows);
      if (frame?.type === 'colors') session.replaceColors(frame.colors);
      if (frame?.type === 'clear') session.clear();
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
