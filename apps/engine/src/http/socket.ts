import {
  type ChatEntry,
  type ParsedClientMessage,
  DEVELOPMENT_VERSION,
  type ScopedActor,
  listSummarizedTasks,
  parseClientMessage,
  type RequestOrigin,
  resolveEngineInfo,
  isTaskInScope,
  resolveScopedEngineInfo,
  resolveScopedPatch,
  resolveScopedState,
  resolveStatePatch,
  resolveTaskDetail,
  resolveViewPatch,
  type ServerMessage,
  type Surface,
  serializeState,
  serializeViewState,
} from '@shinsa/core';
import { Cause, Effect } from 'effect';
import type { Accounts } from '../accounts/index.ts';
import type { Transcripts } from '../agents/transcripts/index.ts';
import { describeError, log } from '../log/index.ts';
import type { Remote } from '../remote/index.ts';
import type { TeamFeeds } from '../remote/team-feeds.ts';
import type { ResourceMonitor } from '../resources/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { Engine } from '../runtime/engine.ts';
import type { Terminals } from '../terminals/index.ts';
import type { Classifier } from '../triage/message.ts';
import { type AttentionClock, AttentionTracker } from './attention.ts';
import { dispatchUserCommand } from './commands.ts';
import { REQUEST_FAILED } from './schema.ts';

export interface SocketData {
  kind: 'hub';
  transcripts: Map<string, () => void>;
  surface: Surface | null;
  origin: RequestOrigin;
  guest: ScopedActor | null;
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

const TRANSCRIPT_PAGE = 500;

const COMMAND_FAILED = 'command_failed';

export function createSocketHub(
  engine: Engine,
  transcripts: Transcripts,
  accounts?: Accounts,
  classify: Classifier | null = null,
  terminals?: Terminals,
  remote?: Remote,
  teamFeeds?: Pick<TeamFeeds, 'subscribe' | 'snapshot'>,
  version = DEVELOPMENT_VERSION,
  resources?: Pick<ResourceMonitor, 'subscribe' | 'snapshot'>,
  clock?: AttentionClock
) {
  const sockets = new Set<Socket>();
  const views = new WeakMap<SocketData, ReadonlySet<string>>();
  const engineInfo = resolveEngineInfo(version);
  let desktopConnected = false;
  let unsubscribeResources: (() => void) | null = null;
  const attention = new AttentionTracker<Socket>(
    (socket, where) => send(socket, { type: 'attention', where }),
    clock
  );

  function broadcast(message: ServerMessage) {
    const payload = JSON.stringify(message);
    for (const socket of sockets) if (!socket.data.guest) deliver(socket, payload);
  }

  function isVisibleRun(socket: Socket, runId: string) {
    const { guest } = socket.data;
    return !guest || isTaskInScope(engine.state, guest.scope, engine.state.runs[runId]?.taskId ?? null);
  }

  function selectView(socket: Socket): ReadonlySet<string> {
    return views.get(socket.data) ?? NO_SUMMARIES;
  }

  function sendState(socket: Socket) {
    const { guest } = socket.data;
    if (guest) {
      send(socket, { type: 'state', state: serializeState(resolveScopedState(engine.state, guest.scope)) });
      return;
    }
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
      const { guest } = socket.data;
      if (guest) {
        send(socket, {
          type: 'state.patch',
          patch: resolveScopedPatch(previous, state, changes, guest.scope),
        });
        continue;
      }
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

  const handleMessage = Effect.fn('SocketHub.handleMessage')(function* (
    socket: Socket,
    message: ParsedClientMessage
  ) {
    switch (message.type) {
      case 'hello':
        if (socket.data.guest) return;
        socket.data.surface = message.surface;
        syncSurfaces();
        return;
      case 'presence':
        attention.report(socket, message.active);
        return;
      case 'command': {
        const error = yield* dispatchUserCommand(engine, message.command, {
          clientId: message.id,
          classify,
          origin: socket.data.origin,
          guest: socket.data.guest,
        }).pipe(
          Effect.as(null),
          Effect.catch((failure) =>
            Effect.succeed({
              code: failure.code === REQUEST_FAILED ? COMMAND_FAILED : failure.code,
              message: failure.message,
            })
          )
        );
        send(socket, { type: 'ack', id: message.id, error });
        return;
      }
      case 'state.sync':
        sendState(socket);
        return;
      case 'task.detail':
        if (socket.data.guest) return;
        sendTaskDetail(socket, message.taskId);
        return;
      case 'transcript.subscribe': {
        if (!isVisibleRun(socket, message.runId)) return;
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
  });

  return {
    open(socket: Socket) {
      sockets.add(socket);
      send(socket, { type: 'surfaces', desktop: desktopConnected });
      if (socket.data.guest) {
        send(socket, { type: 'engine', engine: resolveScopedEngineInfo(version, socket.data.guest.scope) });
        sendState(socket);
        return;
      }
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
      attention.remove(socket);
      syncSurfaces();
      syncResources();
      for (const unfollow of socket.data.transcripts.values()) unfollow();
      socket.data.transcripts.clear();
    },
    message(socket: Socket, raw: string | Buffer) {
      const message = parseClientMessage(String(raw));
      if (!message) {
        log.warn('[Socket] Ignored a message that is not a Shinsa message');
        return;
      }
      edgeRuntime.runFork(
        handleMessage(socket, message).pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() =>
              log.error('[Socket] Message failed', {
                type: message.type,
                error: describeError(Cause.squash(cause)),
              })
            )
          )
        )
      );
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
      attention.stop();
    },
  };
}
