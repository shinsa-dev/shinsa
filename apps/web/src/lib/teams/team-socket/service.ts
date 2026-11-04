import {
  type Bytes,
  type FrameError,
  createFrameOpener,
  createTeamHello,
  decodeText,
  deriveTeamSessionKey,
  InstanceId,
  parseShareMessage,
  parseShareWelcome,
  REMOTE_KEY_ALGORITHM,
  TeamId,
  verifyTeamWelcome,
} from '@shinsa/core';
import { Context, Effect, Layer, Option, Schema, Stream } from 'effect';
import { Socket } from 'effect/socket';
import { enterPromiseOr } from '@/lib/runtime/promise.ts';
import { RemoteClient } from '@/lib/runtime/remote/service.ts';
import { dialSocket } from '@/lib/runtime/socket/dial.ts';
import type { SocketFrame } from '@/lib/runtime/socket/schema.ts';
import { type ShareContent, UNREADABLE_MESSAGE } from '@/lib/share/share-socket/schema.ts';
import {
  TEAM_GONE_STATUSES,
  TEAM_MACHINE_OFFLINE,
  TEAM_TASK_GONE,
  TeamChannelEnded,
  type TeamChannelTarget,
} from './schema.ts';

export class TeamSocket extends Context.Service<
  TeamSocket,
  {
    open(
      target: TeamChannelTarget,
      onMessage: (message: ShareContent) => void
    ): Effect.Effect<never, TeamChannelEnded>;
    openLocal(
      url: string,
      onMessage: (message: ShareContent) => void
    ): Effect.Effect<never, TeamChannelEnded>;
  }
>()('shinsa/web/teams/team-socket/TeamSocket') {
  static readonly layer = Layer.effect(
    TeamSocket,
    Effect.gen(function* () {
      const remote = yield* RemoteClient;
      const makeWebSocket = yield* Socket.WebSocketConstructor;
      const decodeParams = Schema.decodeUnknownOption(
        Schema.Struct({ teamId: TeamId, instanceId: InstanceId })
      );
      const end = (reason: string, gone = false) => Effect.fail(new TeamChannelEnded({ reason, gone }));
      const offline = end(TEAM_MACHINE_OFFLINE);
      const taskGone = end(TEAM_TASK_GONE, true);

      const readMessage = (text: string, onMessage: (message: ShareContent) => void) => {
        const message = parseShareMessage(text);
        if (!message) return end(UNREADABLE_MESSAGE);
        if (message.t === 'closed') return end(message.reason, true);
        return Effect.sync(() => onMessage(message));
      };

      const read = Effect.fn('TeamSocket.read')(function* (
        url: string,
        onFrame: (frame: SocketFrame) => Effect.Effect<void, TeamChannelEnded>
      ) {
        const socket = yield* Effect.catchTag(dialSocket(url), 'SocketError', () => offline);
        return { socket, frames: socket.frames.pipe(Stream.runForEach(onFrame)) };
      });

      const open = Effect.fn('TeamSocket.open')(
        function* (target: TeamChannelTarget, onMessage: (message: ShareContent) => void) {
          const params = decodeParams({ teamId: target.teamId, instanceId: target.instanceId });
          if (Option.isNone(params)) return yield* taskGone;
          const answer = yield* remote.teams
            .connect({
              params: { teamId: params.value.teamId },
              payload: { instanceId: params.value.instanceId },
            })
            .pipe(
              Effect.catch((error) =>
                error._tag === 'CloudRefused' && TEAM_GONE_STATUSES.has(error.status) ? taskGone : offline
              )
            );
          const ephemeral = yield* enterPromiseOr(
            () =>
              crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, ['deriveBits']) as Promise<CryptoKeyPair>,
            offline
          );
          const created = yield* Effect.option(
            createTeamHello(target.teamId, target.key, target.view, ephemeral.publicKey)
          );
          if (Option.isNone(created)) return yield* offline;
          const hello = created.value;
          let openFrame: ((frame: Bytes) => Effect.Effect<Bytes, FrameError>) | null = null;

          const readWelcome = Effect.fn('TeamSocket.readWelcome')(function* (text: string) {
            const welcome = parseShareWelcome(text);
            if (welcome?.type === 'refused') return yield* end(welcome.reason, true);
            if (welcome?.type !== 'welcome' || openFrame) return yield* offline;
            const keys = {
              team: target.teamId,
              view: target.view,
              clientEphemeral: hello.ephemeral,
              serverEphemeral: welcome.ephemeral,
            };
            const verified = yield* verifyTeamWelcome(target.key, keys, welcome.proof);
            if (!verified) return yield* taskGone;
            const derived = yield* Effect.option(
              deriveTeamSessionKey(target.key, keys, ephemeral.privateKey, welcome.ephemeral)
            );
            if (Option.isNone(derived)) return yield* offline;
            const key = derived.value;
            openFrame = createFrameOpener(key);
          });

          const readFrame = Effect.fn('TeamSocket.readFrame')(function* (frame: Bytes) {
            const opener = openFrame;
            if (!opener) return yield* offline;
            const opened = yield* Effect.option(opener(frame));
            if (Option.isNone(opened)) return yield* offline;
            const plain = opened.value;
            return yield* readMessage(decodeText(plain), onMessage);
          });

          const { socket, frames } = yield* read(answer.url, (frame) =>
            typeof frame === 'string' ? readWelcome(frame) : readFrame(frame)
          );
          yield* socket.send(JSON.stringify(hello));
          return yield* frames.pipe(
            Effect.andThen(offline),
            Effect.catchTag('SocketError', () => offline)
          );
        },
        Effect.scoped,
        Effect.provideService(Socket.WebSocketConstructor, makeWebSocket)
      );

      const openLocal = Effect.fn('TeamSocket.openLocal')(
        function* (url: string, onMessage: (message: ShareContent) => void) {
          const { frames } = yield* read(url, (frame) =>
            typeof frame === 'string' ? readMessage(frame, onMessage) : end(UNREADABLE_MESSAGE)
          );
          return yield* frames.pipe(
            Effect.andThen(offline),
            Effect.catchTag('SocketError', () => offline)
          );
        },
        Effect.scoped,
        Effect.provideService(Socket.WebSocketConstructor, makeWebSocket)
      );

      return TeamSocket.of({ open, openLocal });
    })
  );
}
