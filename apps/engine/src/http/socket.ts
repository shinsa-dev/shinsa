import {
  type ChatEntry,
  type ClientMessage,
  DEVELOPMENT_VERSION,
  DomainError,
  isSurface,
  listSummarizedTasks,
  type RequestOrigin,
  resolveEngineInfo,
  resolveStatePatch,
  resolveTaskDetail,
  resolveViewPatch,
  type ServerMessage,
  type Surface,
  serializeViewState,
  type UserCommand,
} from '@shinsa/core';
import type { Accounts } from '../accounts/index.ts';
import type { Transcripts } from '../agents/transcripts/index.ts';
import { describeError, log } from '../log/index.ts';
import type { Remote } from '../remote/index.ts';
import type { TeamFeeds } from '../remote/team-feeds.ts';
import type { ResourceMonitor } from '../resources/index.ts';
import type { Engine } from '../runtime/engine.ts';
import type { Terminals } from '../terminals/index.ts';
import type { Classifier } from '../triage/message.ts';
import { dispatchUserCommand } from './routes.ts';

export interface SocketData {
  kind: 'hub';
  transcripts: Map<string, () => void>;
  surface: Surface | null;
  origin: RequestOrigin;
}

export interface HubSocket {
  data: SocketData;
  send: (payload: string) => unknown;
  close?: () => void;
}

type Socket = HubSocket;

const DROPPED = 0;

const NO_SUMMARIES: ReadonlySet<string> = new Set();

function deliver(socket: Socket, payload: string) {
  if (socket.send(payload) !== DROPPED) return;
  log.warn('[Socket] Dropped a message, closing the socket', { bytes: Buffer.byteLength(payload) });
  socket.close?.();
}

function send(socket: Socket, message: ServerMessage) {
  deliver(socket, JSON.stringify(message));
}

const MAX_ID = 200;

const TRANSCRIPT_PAGE = 500;

function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID;
}

function parseClientMessage(raw: string | Buffer): ClientMessage | null {
  let message: unknown;
  try {
    message = JSON.parse(String(raw));
  } catch {
    return null;
  }
  if (!message || typeof message !== 'object') return null;
  const fields = message as {
    type?: unknown;
    id?: unknown;
    runId?: unknown;
    command?: unknown;
    surface?: unknown;
    from?: unknown;
    taskId?: unknown;
  };
  if (fields.type === 'hello' && isSurface(fields.surface)) return { type: 'hello', surface: fields.surface };
  if (fields.type === 'state.sync') return { type: 'state.sync' };
  if (fields.type === 'task.detail' && isId(fields.taskId)) {
    return { type: 'task.detail', taskId: fields.taskId };
  }
  if (fields.type === 'command' && isId(fields.id)) {
    return { type: 'command', id: fields.id, command: fields.command as UserCommand };
  }
  if (fields.type === 'transcript.subscribe' && isId(fields.runId)) {
    return {
      type: 'transcript.subscribe',
      runId: fields.runId,
      from: isIndex(fields.from) ? fields.from : 0,
    };
  }
  if (fields.type === 'transcript.unsubscribe' && isId(fields.runId)) {
    return { type: 'transcript.unsubscribe', runId: fields.runId };
  }
  return null;
}

export function createSocketHub(
  engine: Engine,
  transcripts: Transcripts,
  accounts?: Accounts,
  classify: Classifier | null = null,
  terminals?: Terminals,
  remote?: Remote,
  teamFeeds?: Pick<TeamFeeds, 'subscribe' | 'snapshot'>,
  version = DEVELOPMENT_VERSION,
  resources?: Pick<ResourceMonitor, 'subscribe' | 'snapshot'>
) {
  const sockets = new Set<Socket>();
  const views = new WeakMap<SocketData, ReadonlySet<string>>();
  const engineInfo = resolveEngineInfo(version);
  let desktopConnected = false;
  let unsubscribeResources: (() => void) | null = null;

  function broadcast(message: ServerMessage) {
    const payload = JSON.stringify(message);
    for (const socket of sockets) deliver(socket, payload);
  }

  function selectView(socket: Socket): ReadonlySet<string> {
    return views.get(socket.data) ?? NO_SUMMARIES;
  }

  function sendState(socket: Socket) {
    const summarized = listSummarizedTasks(engine.state);
    views.set(socket.data, summarized);
    send(socket, { type: 'state', state: serializeViewState(engine.state, summarized) });
  }

  function sendTaskDetail(socket: Socket, taskId: string) {
    views.set(socket.data, new Set([...selectView(socket)].filter((id) => id !== taskId)));
    send(socket, { type: 'task.detail', detail: resolveTaskDetail(engine.state, taskId) });
  }

  function syncSurfaces() {
    const desktop = [...sockets].some((socket) => socket.data.surface === 'desktop');
    if (desktop === desktopConnected) return;
    desktopConnected = desktop;
    broadcast({ type: 'surfaces', desktop });
  }

  const unsubscribeAccounts = accounts?.subscribe((snapshot) =>
    broadcast({ type: 'accounts', accounts: snapshot })
  );

  const unsubscribeTerminals = terminals?.subscribe((snapshot) =>
    broadcast({ type: 'terminals', terminals: snapshot })
  );

  function syncResources() {
    if (!resources) return;
    if (sockets.size > 0 && !unsubscribeResources) {
      unsubscribeResources = resources.subscribe((snapshot) =>
        broadcast({ type: 'resources', resources: snapshot })
      );
    }
    if (sockets.size === 0 && unsubscribeResources) {
      unsubscribeResources();
      unsubscribeResources = null;
    }
  }

  const unsubscribeRemote = remote?.subscribe(() => broadcast({ type: 'remote', remote: remote.snapshot() }));

  const unsubscribeTeams = teamFeeds?.subscribe(() =>
    broadcast({ type: 'teams', teams: teamFeeds.snapshot() })
  );

  const unsubscribeState = engine.subscribe((state, { previous, changes }) => {
    if (sockets.size === 0) return;
    const patch = resolveStatePatch(previous, state, changes);
    let shared: string | null = null;
    for (const socket of sockets) {
      const view = resolveViewPatch(patch, previous, state, selectView(socket));
      views.set(socket.data, view.summarized);
      if (view.patch !== patch) {
        send(socket, { type: 'state.patch', patch: view.patch });
        continue;
      }
      shared ??= JSON.stringify({ type: 'state.patch', patch } satisfies ServerMessage);
      deliver(socket, shared);
    }
  });

  const unsubscribeTranscripts = transcripts.subscribe((runId, entries, start) => {
    if (start === null) return;
    const payload = JSON.stringify({ type: 'transcript', runId, entries, start } satisfies ServerMessage);
    for (const socket of sockets) {
      if (socket.data.transcripts.has(runId)) deliver(socket, payload);
    }
  });

  function sendTranscript(socket: Socket, runId: string, entries: ChatEntry[], start: number) {
    for (let index = 0; index === 0 || index < entries.length; index += TRANSCRIPT_PAGE) {
      send(socket, {
        type: 'transcript',
        runId,
        entries: entries.slice(index, index + TRANSCRIPT_PAGE),
        start: start + index,
      });
    }
  }

  async function handleMessage(socket: Socket, message: ClientMessage) {
    switch (message.type) {
      case 'hello':
        socket.data.surface = message.surface;
        syncSurfaces();
        return;
      case 'command': {
        try {
          await dispatchUserCommand(engine, message.command, message.id, classify, socket.data.origin);
          send(socket, { type: 'ack', id: message.id, error: null });
        } catch (error) {
          const code = error instanceof DomainError ? error.code : 'command_failed';
          send(socket, { type: 'ack', id: message.id, error: { code, message: describeError(error) } });
        }
        return;
      }
      case 'state.sync':
        sendState(socket);
        return;
      case 'task.detail':
        sendTaskDetail(socket, message.taskId);
        return;
      case 'transcript.subscribe': {
        if (!socket.data.transcripts.has(message.runId)) {
          socket.data.transcripts.set(message.runId, transcripts.follow(message.runId));
        }
        const read = transcripts.readEntries(message.runId, message.from);
        sendTranscript(socket, message.runId, read.entries, read.start);
        return;
      }
      case 'transcript.unsubscribe':
        socket.data.transcripts.get(message.runId)?.();
        socket.data.transcripts.delete(message.runId);
        return;
    }
  }

  return {
    open(socket: Socket) {
      sockets.add(socket);
      send(socket, { type: 'surfaces', desktop: desktopConnected });
      send(socket, { type: 'engine', engine: engineInfo });
      if (accounts) send(socket, { type: 'accounts', accounts: accounts.snapshot() });
      if (terminals) send(socket, { type: 'terminals', terminals: terminals.snapshot() });
      if (remote) send(socket, { type: 'remote', remote: remote.snapshot() });
      if (teamFeeds) send(socket, { type: 'teams', teams: teamFeeds.snapshot() });
      const sampled = resources?.snapshot();
      if (sampled) send(socket, { type: 'resources', resources: sampled });
      sendState(socket);
      syncResources();
    },
    close(socket: Socket) {
      sockets.delete(socket);
      syncSurfaces();
      syncResources();
      for (const unfollow of socket.data.transcripts.values()) unfollow();
      socket.data.transcripts.clear();
    },
    message(socket: Socket, raw: string | Buffer) {
      const message = parseClientMessage(raw);
      if (!message) {
        log.warn('[Socket] Ignored a message that is not a Shinsa message');
        return;
      }
      handleMessage(socket, message).catch((error: unknown) => {
        log.error('[Socket] Message failed', { type: message.type, error: describeError(error) });
      });
    },
    stop() {
      unsubscribeState();
      unsubscribeTranscripts();
      unsubscribeAccounts?.();
      unsubscribeTerminals?.();
      unsubscribeRemote?.();
      unsubscribeTeams?.();
      unsubscribeResources?.();
      unsubscribeResources = null;
    },
  };
}
