import {
  type Bytes,
  createFrameOpener,
  createShareHello,
  decodeText,
  deriveShareSessionKey,
  InstanceId,
  parseShareMessage,
  parseShareWelcome,
  REMOTE_KEY_ALGORITHM,
  resolveShareChannelUrl,
  type ShareLink,
  verifyShareWelcome,
} from '@shinsa/core';
import { Context, Effect, Layer, Option, Schema, Stream } from 'effect';
import { Socket } from 'effect/socket';
import { enterPromiseOr } from '@/lib/runtime/promise.ts';
import { CLOUD_NOT_FOUND } from '@/lib/runtime/remote/schema.ts';
import { RemoteClient } from '@/lib/runtime/remote/service.ts';
import { dialSocket } from '@/lib/runtime/socket/dial.ts';
import { keepDialing } from '@/lib/runtime/socket/reconnect.ts';
import { SHARE_GONE } from '@/lib/share/sources.ts';
import {
  SHARE_OFFLINE,
  SHARE_RECONNECT,
  SHARE_UNREACHABLE,
  ShareDropped,
  type ShareSession,
  UNREADABLE_MESSAGE,
} from './schema.ts';

export class ShareSocket extends Context.Service<
  ShareSocket,
  { connect(link: ShareLink, session: ShareSession): Effect.Effect<void> }
>()('shinsa/web/share/share-socket/ShareSocket') {
  static readonly layer = Layer.effect(
    ShareSocket,
    Effect.gen(function* () {
      const remote = yield* RemoteClient;
      const makeWebSocket = yield* Socket.WebSocketConstructor;
      const decodeInstanceId = Schema.decodeUnknownOption(InstanceId);

      const dial = Effect.fn('ShareSocket.dial')(function* (link: ShareLink, session: ShareSession) {
        let connected = false;
        let open: ((frame: Bytes) => Promise<Bytes>) | null = null;
        const drop = (reason: string, final = false) =>
          Effect.suspend(() => {
            const dropped = new ShareDropped({ reason, connected, final });
            session.dropped(dropped);
            return Effect.fail(dropped);
          });
        const gone = (reason = SHARE_GONE) => drop(reason, true);
        const offline = drop(SHARE_OFFLINE);
        function enter<A>(step: () => Promise<A>, failed = offline) {
          return enterPromiseOr(step, failed);
        }

        const instanceId = decodeInstanceId(link.instanceId);
        if (Option.isNone(instanceId)) return yield* gone();
        const answer = yield* remote.shares
          .connect({ params: { instanceId: instanceId.value } })
          .pipe(
            Effect.catch((error) =>
              error._tag === 'CloudRefused' && error.status === CLOUD_NOT_FOUND.status
                ? gone()
                : drop(SHARE_UNREACHABLE)
            )
          );
        if (!answer.online) return yield* offline;
        const ephemeral = yield* enter(
          () =>
            crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, ['deriveBits']) as Promise<CryptoKeyPair>
        );
        const hello = yield* enter(() => createShareHello(link.shareId, link.key, ephemeral.publicKey));
        const socket = yield* Effect.catchTag(
          dialSocket(resolveShareChannelUrl(answer.url, link.shareId)),
          'SocketError',
          () => offline
        );
        yield* socket.send(JSON.stringify(hello));

        const readWelcome = Effect.fn('ShareSocket.readWelcome')(function* (text: string) {
          const welcome = parseShareWelcome(text);
          if (welcome?.type === 'refused') return yield* gone(welcome.reason);
          if (welcome?.type !== 'welcome' || open) return yield* offline;
          const keys = {
            share: link.shareId,
            clientEphemeral: hello.ephemeral,
            serverEphemeral: welcome.ephemeral,
          };
          const verified = yield* enter(() => verifyShareWelcome(link.key, keys, welcome.proof));
          if (!verified) return yield* gone();
          const key = yield* enter(() =>
            deriveShareSessionKey(link.key, keys, ephemeral.privateKey, welcome.ephemeral)
          );
          open = createFrameOpener(key);
          session.welcomed();
        });

        const readFrame = Effect.fn('ShareSocket.readFrame')(function* (frame: Bytes) {
          const opener = open;
          if (!opener) return yield* offline;
          const unreadable = drop(UNREADABLE_MESSAGE);
          const plain = yield* enter(() => opener(frame), unreadable);
          const message = parseShareMessage(decodeText(plain));
          if (!message) return yield* unreadable;
          if (message.t === 'closed') return yield* gone(message.reason);
          if (!session.received(message)) return yield* unreadable;
          if (message.t === 'view') connected = true;
        });

        return yield* socket.frames.pipe(
          Stream.runForEach((frame) => (typeof frame === 'string' ? readWelcome(frame) : readFrame(frame))),
          Effect.andThen(offline),
          Effect.catchTag('SocketError', () => offline)
        );
      }, Effect.scoped);

      const connect = Effect.fn('ShareSocket.connect')(
        function* (link: ShareLink, session: ShareSession) {
          yield* keepDialing(dial(link, session), SHARE_RECONNECT);
        },
        Effect.provideService(Socket.WebSocketConstructor, makeWebSocket)
      );

      return ShareSocket.of({ connect });
    })
  );
}
