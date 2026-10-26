import { statSync } from 'node:fs';
import {
  DomainError,
  listTerminalPlaces,
  parseTerminalClientFrame,
  TERMINAL_LIMITS,
  type TerminalPlace,
  type TerminalPlaceKind,
} from '@shinsa/core';
import type { ServerWebSocket } from 'bun';
import { type JsonObject, readJsonObject } from '../http/body.ts';
import type { Engine } from '../runtime/engine.ts';
import type { TerminalStart, Terminals, TerminalViewer } from './index.ts';

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

function resolveBrowserRefusal(request: Request) {
  return request.headers.get('origin') === null ? BROWSER_ONLY : null;
}

export function readTerminalSocketId(pathname: string) {
  return SOCKET_PATH.exec(pathname)?.[1] ?? null;
}

export function createTerminalRoutes(engine: Engine, terminals: Terminals): TerminalRoute[] {
  const { home } = terminals;
  const respond = (body: unknown) => Response.json(body);
  const guarded =
    (handler: (match: RegExpExecArray, body: JsonObject) => unknown) =>
    async (match: RegExpExecArray, request: Request) => {
      const refusal = resolveBrowserRefusal(request);
      if (refusal) throw new DomainError('browser_only', refusal);
      return respond((await handler(match, await readJsonObject(request))) ?? terminals.snapshot());
    };
  const id = (match: RegExpExecArray) => decodeURIComponent(match[1] ?? '');
  return [
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
