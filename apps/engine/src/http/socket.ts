import {
  type ChatEntry,
  type ParsedClientMessage,
  DEVELOPMENT_VERSION,
  type ScopedActor,
  listSummarizedTasks,
  parseClientMessage,
  type RemoteSnapshot,
  type RequestOrigin,
  resolveEngineInfo,
  isTaskInScope,
  resolveScopedEngineInfo,
  resolveScopedPatch,
  resolveScopedTerminals,
  resolveScopedState,
  resolveStatePatch,
  resolveTaskDetail,
  resolveViewPatch,
  type ServerMessage,
  type Surface,
  serializeState,
  serializeViewState,
  type TeamFeedSnapshot,
  type TerminalsSnapshot,
} from '@shinsa/core';
import { Cause, Effect, type Scope } from 'effect';
import type { Accounts } from '../accounts/index.ts';
import type { Transcripts } from '../agents/transcripts/service.ts';
import { describeError, log } from '../log/index.ts';
import type { RemoteHandle } from '../remote/machine/schema.ts';
import type { Presence } from '../remote/presence/service.ts';
import type { ResourceMonitor } from '../resources/index.ts';
import type { EngineCore } from '../runtime/engine/service.ts';
import type { Terminals } from '../terminals/index.ts';
import type { CommandRouter } from '../triage/index.ts';
import { makeAttentionTracker } from './attention/service.ts';
import { dispatchUserCommand, resolveRequestActor } from './commands.ts';
import { REQUEST_FAILED } from './schema.ts';

export interface SocketData {
  kind: 'hub';
  transcripts: Map<string, Effect.Effect<void>>;
  surface: Surface | null;
  origin: RequestOrigin;
  guest: ScopedActor | null;
  userId: string | null;
}

interface FeedSource<T> {
  observe(listener: Effect.Effect<void>): Effect.Effect<void, never, Scope.Scope>;
  readonly snapshot: Effect.Effect<T>;
}

export interface SocketHubInput {
  readonly engine: EngineCore['Service'];
  readonly transcripts: Transcripts['Service'];
  readonly accounts?: Accounts['Service'] | undefined;
  readonly router?: CommandRouter['Service'] | null | undefined;
  readonly terminals?: Terminals['Service'] | undefined;
  readonly remote?: FeedSource<RemoteSnapshot> | undefined;
  readonly teamFeeds?: FeedSource<TeamFeedSnapshot> | undefined;
  readonly version?: string | undefined;
  readonly resources?: ResourceMonitor['Service'] | undefined;
  readonly teams?: Pick<RemoteHandle, 'resolveTeamScope' | 'resolveActor'> | undefined;
  readonly presence?: Presence['Service'] | undefined;
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

export const makeSocketHub = Effect.fn('SocketHub.make')(function* (input: SocketHubInput) {
  const { engine, transcripts, accounts, terminals, remote, teamFeeds, resources, teams, presence } = input;
  const router = input.router ?? null;
  const version = input.version ?? DEVELOPMENT_VERSION;
  const context = yield* Effect.context<never>();
  const runSync = Effect.runSyncWith(context);
  const runFork = Effect.runForkWith(context);
  const readState = () => runSync(engine.state);
  const sockets = new Set<Socket>();
  const views = new WeakMap<SocketData, ReadonlySet<string>>();
  const engineInfo = resolveEngineInfo(version);
  let desktopConnected = false;
  let unsubscribeResources: Effect.Effect<void> | null = null;
  const attention = yield* makeAttentionTracker<Socket>(
    (socket, where) => send(socket, { type: 'attention', where }),
    presence ? presence.recordOwner : null
  );

  function broadcast(message: ServerMessage) {
    const payload = JSON.stringify(message);
    for (const socket of sockets) if (!socket.data.guest) deliver(socket, payload);
  }

  function isVisibleRun(socket: Socket, runId: string) {
    const { guest } = socket.data;
    if (!guest) return true;
    const state = readState();
    return isTaskInScope(state, guest.scope, state.runs[runId]?.taskId ?? null);
  }

  function selectView(socket: Socket): ReadonlySet<string> {
    return views.get(socket.data) ?? NO_SUMMARIES;
  }

  function sendState(socket: Socket) {
    const { guest } = socket.data;
    const state = readState();
    if (guest) {
      send(socket, { type: 'state', state: serializeState(resolveScopedState(state, guest.scope)) });
      return;
    }
    const summarized = listSummarizedTasks(state);
    views.set(socket.data, summarized);
    send(socket, { type: 'state', state: serializeViewState(state, summarized) });
  }

  function sendScopedTerminals(socket: Socket, snapshot: TerminalsSnapshot) {
    const { guest } = socket.data;
    if (!guest) return;
    send(socket, {
      type: 'terminals',
      terminals: resolveScopedTerminals(readState(), guest.scope, snapshot),
    });
  }

  function sendTaskDetail(socket: Socket, taskId: string) {
    views.set(socket.data, new Set([...selectView(socket)].filter((id) => id !== taskId)));
    send(socket, { type: 'task.detail', detail: resolveTaskDetail(readState(), taskId) });
  }

  function syncSurfaces() {
    const desktop = [...sockets].some((socket) => socket.data.surface === 'desktop');
    if (desktop === desktopConnected) return;
    desktopConnected = desktop;
    broadcast({ type: 'surfaces', desktop });
  }

  if (accounts) {
    const unsubscribe = yield* accounts.subscribe((snapshot) =>
      Effect.sync(() => broadcast({ type: 'accounts', accounts: snapshot }))
    );
    yield* Effect.addFinalizer(() => unsubscribe);
  }

  if (terminals) {
    const unsubscribe = yield* terminals.subscribe((snapshot) => {
      broadcast({ type: 'terminals', terminals: snapshot });
      for (const socket of sockets) if (socket.data.guest) sendScopedTerminals(socket, snapshot);
    });
    yield* Effect.addFinalizer(() => unsubscribe);
  }

  function syncResources() {
    if (!resources) return;
    if (sockets.size > 0 && !unsubscribeResources) {
      unsubscribeResources = runSync(
        resources.subscribe((snapshot) => broadcast({ type: 'resources', resources: snapshot }))
      );
    }
    if (sockets.size === 0 && unsubscribeResources) {
      runFork(unsubscribeResources);
      unsubscribeResources = null;
    }
  }

  yield* Effect.addFinalizer(() =>
    Effect.suspend(() => {
      const release = unsubscribeResources ?? Effect.void;
      unsubscribeResources = null;
      return release;
    })
  );

  if (remote) {
    yield* remote.observe(
      Effect.flatMap(remote.snapshot, (snapshot) =>
        Effect.sync(() => broadcast({ type: 'remote', remote: snapshot }))
      )
    );
  }

  if (teamFeeds) {
    yield* teamFeeds.observe(
      Effect.flatMap(teamFeeds.snapshot, (snapshot) =>
        Effect.sync(() => broadcast({ type: 'teams', teams: snapshot }))
      )
    );
  }

  yield* engine.observe((state, { previous, changes }) => {
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

  const unsubscribeTranscripts = yield* transcripts.subscribe((runId, entries, start) => {
    if (start === null) return;
    const payload = JSON.stringify({ type: 'transcript', runId, entries, start } satisfies ServerMessage);
    for (const socket of sockets) {
      if (socket.data.transcripts.has(runId)) deliver(socket, payload);
    }
  });
  yield* Effect.addFinalizer(() => unsubscribeTranscripts);

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
        return yield* attention.report(socket, message.active);
      case 'command': {
        const error = yield* dispatchUserCommand(engine, message.command, {
          clientId: message.id,
          router,
          origin: socket.data.origin,
          guest: socket.data.guest,
          actor: yield* resolveRequestActor(
            {
              via: socket.data.origin === 'local' ? 'local' : 'channel',
              guest: socket.data.guest,
              userId: socket.data.userId,
            },
            teams
          ),
          teams: teams ?? null,
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
          socket.data.transcripts.set(message.runId, yield* transcripts.follow(message.runId));
        }
        const read = yield* transcripts.readEntries(message.runId, message.from);
        sendTranscript(socket, message.runId, read.entries, read.start);
        return;
      }
      case 'transcript.unsubscribe':
        yield* socket.data.transcripts.get(message.runId) ?? Effect.void;
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
        if (terminals) sendScopedTerminals(socket, runSync(terminals.snapshot));
        sendState(socket);
        return;
      }
      send(socket, { type: 'engine', engine: engineInfo });
      if (accounts) send(socket, { type: 'accounts', accounts: runSync(accounts.snapshot) });
      if (terminals) send(socket, { type: 'terminals', terminals: runSync(terminals.snapshot) });
      if (remote) send(socket, { type: 'remote', remote: runSync(remote.snapshot) });
      if (teamFeeds) send(socket, { type: 'teams', teams: runSync(teamFeeds.snapshot) });
      const sampled = resources && runSync(resources.snapshot);
      if (sampled) send(socket, { type: 'resources', resources: sampled });
      sendState(socket);
      syncResources();
    },
    close(socket: Socket) {
      sockets.delete(socket);
      runSync(attention.remove(socket));
      syncSurfaces();
      syncResources();
      for (const unfollow of socket.data.transcripts.values()) runSync(unfollow);
      socket.data.transcripts.clear();
    },
    message(socket: Socket, raw: string | Buffer) {
      const message = parseClientMessage(String(raw));
      if (!message) {
        log.warn('[Socket] Ignored a message that is not a Shinsa message');
        return;
      }
      runFork(
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
  };
});
