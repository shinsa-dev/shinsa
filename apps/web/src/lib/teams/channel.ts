import { resolveTeamViewPath, type TeamViewTarget } from '@shinsa/core';
import { Clock, Effect, Layer } from 'effect';
import { Socket } from 'effect/socket';
import { forkApp } from '@/lib/runtime/app.ts';
import { type RequestFetch, sendThrough } from '@/lib/runtime/fetch.ts';
import { keepDialing } from '@/lib/runtime/socket/reconnect.ts';
import type { SocketTransport } from '@/lib/runtime/socket/schema.ts';
import {
  createShareReceiver,
  type ShareReceiverOptions,
  type ShareStreamHandlers,
} from '@/lib/share/live.ts';
import { ShareGoneError } from '@/lib/share/sources.ts';
import {
  type TeamChannelEnded,
  type TeamChannelHandlers,
  type TeamChannelTarget,
  TEAM_RECONNECT,
  TeamStreamDropped,
  type TeamTransport,
} from './team-socket/schema.ts';
import { TeamSocket } from './team-socket/service.ts';

export interface TeamChannelOptions {
  fetch?: RequestFetch;
  transport?: SocketTransport;
}

export interface TeamTaskStreamOptions extends ShareReceiverOptions {
  clock?: Clock.Clock;
}

function runTeamChannel(
  handlers: TeamChannelHandlers,
  options: TeamChannelOptions,
  open: (socket: TeamSocket['Service']) => Effect.Effect<never, TeamChannelEnded>
) {
  const transport = options.transport ?? Socket.layerWebSocketConstructorGlobal;
  const channel = Effect.gen(function* () {
    const socket = yield* TeamSocket;
    return yield* open(socket);
  }).pipe(
    Effect.catchTag('TeamChannelEnded', (ended) =>
      Effect.sync(() => handlers.onEnd({ reason: ended.reason, gone: ended.gone }))
    ),
    Effect.provide(TeamSocket.layer.pipe(Layer.provideMerge(transport)))
  );
  const fiber = forkApp(options.fetch ? sendThrough(options.fetch)(channel) : channel);
  return () => fiber.interruptUnsafe();
}

export function openTeamChannel(
  target: TeamChannelTarget,
  handlers: TeamChannelHandlers,
  options: TeamChannelOptions = {}
) {
  return runTeamChannel(handlers, options, (socket) => socket.open(target, handlers.onMessage));
}

export function resolveLocalTeamViewUrl(target: TeamViewTarget, origin: Pick<Location, 'protocol' | 'host'>) {
  const protocol = origin.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${origin.host}${resolveTeamViewPath(target)}`;
}

export function openLocalTeamView(
  target: TeamViewTarget,
  handlers: TeamChannelHandlers,
  options: TeamChannelOptions & { origin?: Pick<Location, 'protocol' | 'host'> } = {}
) {
  const url = resolveLocalTeamViewUrl(target, options.origin ?? location);
  return runTeamChannel(handlers, options, (socket) => socket.openLocal(url, handlers.onMessage));
}

export function openTeamTaskStream(
  transport: TeamTransport,
  handlers: ShareStreamHandlers,
  options: TeamTaskStreamOptions = {}
) {
  let connected = false;
  const receiver = createShareReceiver((source) => {
    connected = true;
    handlers.onSource(source);
  }, options);
  const attempt = Effect.callback<never, TeamStreamDropped>((resume) => {
    let live = true;
    connected = false;
    receiver.restart();
    const stop = transport({
      onMessage: (message) => {
        if (live) receiver.receive(message);
      },
      onEnd: (end) => {
        if (!live) return;
        live = false;
        handlers.onError(end.gone ? new ShareGoneError(end.reason) : new Error(end.reason));
        resume(Effect.fail(new TeamStreamDropped({ connected, final: end.gone })));
      },
    });
    return Effect.sync(() => {
      live = false;
      stop();
    });
  });
  const stream = keepDialing(attempt, TEAM_RECONNECT);
  const fiber = forkApp(options.clock ? Effect.provideService(stream, Clock.Clock, options.clock) : stream);
  return () => {
    fiber.interruptUnsafe();
    receiver.stop();
  };
}
