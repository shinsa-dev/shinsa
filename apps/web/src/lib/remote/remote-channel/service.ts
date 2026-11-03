import {
  CHANNEL_COMPRESSION,
  type ChannelMessage,
  createClientHello,
  createEnrollProof,
  createFrameOpener,
  createFrameSealer,
  decodeText,
  deriveClientSession,
  encodeText,
  listBodyMessages,
  parseBodyChunk,
  parseChannelMessage,
  parsePublicKey,
  parseServerHello,
  REMOTE_KEY_ALGORITHM,
  serializeChannelMessage,
  serializePublicKey,
} from '@shinsa/core';
import { Context, Deferred, Effect, Exit, Fiber, Layer, Queue, Stream } from 'effect';
import { Socket } from 'effect/socket';
import { enterPromiseOr } from '@/lib/runtime/promise.ts';
import { dialSocket } from '@/lib/runtime/socket/dial.ts';
import type { SocketFrame } from '@/lib/runtime/socket/schema.ts';
import {
  CHANNEL_BROKE,
  CHANNEL_BROWSER_ONLY,
  CHANNEL_CLOSED,
  CHANNEL_CLOSED_HERE,
  CHANNEL_DROPPED,
  CHANNEL_HANDSHAKE_MISSING,
  CHANNEL_HANDSHAKE_UNKNOWN,
  CHANNEL_KEY_INVALID,
  CHANNEL_MESSAGE_UNKNOWN,
  CHANNEL_UNANSWERED,
  CHANNEL_UNREACHABLE,
  CHANNEL_UNSEALED,
  ChannelError,
  type ChannelHello,
  type ChannelLink,
  type ChannelOptions,
  type ChannelRequest,
  NULL_BODY_STATUSES,
  type Outgoing,
  type PendingResponse,
  REQUEST_ABORTED,
  RequestAborted,
  type RequestFailure,
  type TerminalStreamMessage,
} from './schema.ts';

export class RemoteChannels extends Context.Service<
  RemoteChannels,
  { open(options: ChannelOptions): Effect.Effect<ChannelLink, ChannelError> }
>()('shinsa/web/remote/remote-channel/RemoteChannels') {
  static readonly layer = Layer.effect(
    RemoteChannels,
    Effect.gen(function* () {
      const makeWebSocket = yield* Socket.WebSocketConstructor;
      const refuse = (message: string) => new ChannelError({ message });
      function enter<A>(step: () => Promise<A>, message = CHANNEL_BROKE) {
        return enterPromiseOr(
          step,
          Effect.suspend(() => Effect.fail(refuse(message)))
        );
      }

      const prepareHello = Effect.fn('RemoteChannels.prepareHello')(function* (options: ChannelOptions) {
        const machinePublicKey = yield* enter(() => parsePublicKey(options.machineKey), CHANNEL_KEY_INVALID);
        if (!machinePublicKey) return yield* refuse(CHANNEL_KEY_INVALID);
        const ephemeral = yield* enter(
          () =>
            crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, ['deriveBits']) as Promise<CryptoKeyPair>
        );
        const device = yield* enter(() => serializePublicKey(options.device.publicKey));
        const clientEphemeral = yield* enter(() => serializePublicKey(ephemeral.publicKey));
        const secret = options.enrollSecret;
        let enroll: string | null = null;
        if (secret)
          enroll = yield* enter(() =>
            createEnrollProof(secret, { machine: options.machineKey, device, clientEphemeral })
          );
        const hello = yield* enter(() =>
          createClientHello(options.device.publicKey, ephemeral.publicKey, enroll, options.name ?? null, [
            CHANNEL_COMPRESSION,
          ])
        );
        const prepared: ChannelHello = { machinePublicKey, ephemeral, device, clientEphemeral, hello };
        return prepared;
      });

      const run = Effect.fn('RemoteChannels.run')(function* (
        url: string,
        prepared: ChannelHello,
        options: ChannelOptions,
        ready: Deferred.Deferred<ChannelLink, ChannelError>
      ) {
        const self = yield* Effect.withFiber((fiber) => Effect.succeed(fiber));
        let phase: 'hello' | 'open' | 'closed' = 'hello';
        let confirmed = false;
        let seal: ((plain: Uint8Array<ArrayBuffer>) => Promise<Uint8Array<ArrayBuffer>>) | null = null;
        let open: ((frame: Uint8Array<ArrayBuffer>) => Promise<Uint8Array<ArrayBuffer>>) | null = null;
        let nextId = 0;
        const pending = new Map<string, PendingResponse>();
        const outstanding = new Set<Outgoing>();
        const socketListeners = new Set<(data: string) => void>();
        const terminalListeners = new Set<(message: TerminalStreamMessage) => void>();
        const closeListeners = new Set<(error: ChannelError) => void>();
        const outbox = yield* Queue.unbounded<Outgoing>();

        const failNow = (error: ChannelError) => {
          if (phase === 'closed') return;
          phase = 'closed';
          for (const waiting of pending.values()) {
            Deferred.doneUnsafe(waiting.answer, Exit.fail(error));
            waiting.stream?.error(error);
          }
          pending.clear();
          for (const item of outstanding) Deferred.doneUnsafe(item.sent, Exit.fail(error));
          outstanding.clear();
          Deferred.doneUnsafe(ready, Exit.fail(error));
          for (const listener of closeListeners) listener(error);
        };

        const enqueue = (message: ChannelMessage) => {
          const item: Outgoing = { message, sent: Deferred.makeUnsafe() };
          outstanding.add(item);
          Queue.offerUnsafe(outbox, item);
          return item;
        };

        const send = Effect.fn('RemoteChannel.send')(function* (message: ChannelMessage) {
          if (phase !== 'open') return yield* refuse(CHANNEL_CLOSED);
          return yield* Deferred.await(enqueue(message).sent);
        });

        const abort = (id: string) => {
          const waiting = pending.get(id);
          if (!waiting) return;
          pending.delete(id);
          const error = new RequestAborted({ message: REQUEST_ABORTED });
          Deferred.doneUnsafe(waiting.answer, Exit.fail(error));
          waiting.stream?.error(error);
          if (phase === 'open') enqueue({ t: 'abort', id });
        };

        const request = Effect.fn('RemoteChannel.request')(function* (input: ChannelRequest) {
          if (!(phase === 'open' && confirmed)) return yield* refuse(CHANNEL_CLOSED);
          nextId += 1;
          const id = String(nextId);
          const answer = yield* Deferred.make<Response, RequestFailure>();
          pending.set(id, { answer, stream: null });
          input.signal?.addEventListener('abort', () => abort(id), { once: true });
          yield* send({ t: 'request', id, method: input.method, path: input.path, headers: input.headers });
          for (const message of listBodyMessages(id, input.body ?? new Uint8Array())) yield* send(message);
          return yield* Deferred.await(answer);
        });

        const link: ChannelLink = {
          isOpen: () => phase === 'open' && confirmed,
          isClosed: () => phase === 'closed',
          request,
          sendSocket: (data) => send({ t: 'socket', data }),
          subscribeSocket: (listener) => {
            socketListeners.add(listener);
            return () => socketListeners.delete(listener);
          },
          sendTerminal: (message) => send(message),
          subscribeTerminal: (listener) => {
            terminalListeners.add(listener);
            return () => terminalListeners.delete(listener);
          },
          subscribeClose: (listener) => {
            closeListeners.add(listener);
            return () => closeListeners.delete(listener);
          },
          close: () => {
            failNow(refuse(CHANNEL_CLOSED_HERE));
            self.interruptUnsafe();
          },
        };

        const respond = (message: Extract<ChannelMessage, { t: 'response' }>) => {
          const waiting = pending.get(message.id);
          if (!waiting || waiting.stream) return;
          if (NULL_BODY_STATUSES.has(message.status)) {
            pending.delete(message.id);
            Deferred.doneUnsafe(
              waiting.answer,
              Exit.succeed(new Response(null, { status: message.status, headers: message.headers }))
            );
            return;
          }
          const body = new ReadableStream<Uint8Array>({
            start: (controller) => {
              waiting.stream = controller;
            },
          });
          Deferred.doneUnsafe(
            waiting.answer,
            Exit.succeed(new Response(body, { status: message.status, headers: message.headers }))
          );
        };

        const finish = (id: string) => {
          const waiting = pending.get(id);
          if (!waiting) return;
          pending.delete(id);
          if (waiting.stream) waiting.stream.close();
          else Deferred.doneUnsafe(waiting.answer, Exit.fail(refuse(CHANNEL_UNANSWERED)));
        };

        const handle = (message: ChannelMessage) => {
          switch (message.t) {
            case 'ready':
              confirmed = true;
              Deferred.doneUnsafe(ready, Exit.succeed(link));
              return Effect.void;
            case 'socket':
              for (const listener of socketListeners) listener(message.data);
              return Effect.void;
            case 'response':
              respond(message);
              return Effect.void;
            case 'body': {
              const bytes = parseBodyChunk(message.chunk);
              const stream = pending.get(message.id)?.stream;
              if (stream && bytes) stream.enqueue(bytes);
              return Effect.void;
            }
            case 'end':
              finish(message.id);
              return Effect.void;
            case 'terminal-text':
            case 'terminal-bytes':
            case 'terminal-close':
              for (const listener of terminalListeners) listener(message);
              return Effect.void;
            default:
              return Effect.fail(refuse(CHANNEL_BROWSER_ONLY));
          }
        };

        const handshake = Effect.fn('RemoteChannel.handshake')(function* (text: string) {
          const welcome = parseServerHello(text);
          if (welcome?.type === 'refused')
            return yield* new ChannelError({ message: welcome.reason, refused: true });
          if (welcome?.type === 'pending') {
            options.onPending?.();
            return;
          }
          if (!welcome) return yield* refuse(CHANNEL_HANDSHAKE_UNKNOWN);
          const session = yield* enter(() =>
            deriveClientSession({
              keys: {
                machine: options.machineKey,
                device: prepared.device,
                clientEphemeral: prepared.clientEphemeral,
                serverEphemeral: welcome.ephemeral,
              },
              machinePublicKey: prepared.machinePublicKey,
              devicePrivateKey: options.device.privateKey,
              clientEphemeralPrivateKey: prepared.ephemeral.privateKey,
            })
          );
          if (phase === 'closed') return;
          seal = createFrameSealer(session.send, welcome.compression);
          open = createFrameOpener(session.receive, welcome.compression);
          phase = 'open';
          yield* send({ t: 'ready' });
        });

        const receive = Effect.fn('RemoteChannel.receive')(function* (frame: SocketFrame) {
          if (phase === 'hello') {
            if (typeof frame !== 'string') return yield* refuse(CHANNEL_HANDSHAKE_MISSING);
            return yield* handshake(frame);
          }
          const opener = open;
          if (typeof frame === 'string' || !opener) return yield* refuse(CHANNEL_UNSEALED);
          const plain = yield* enter(() => opener(frame));
          const message = parseChannelMessage(decodeText(plain));
          if (!message) return yield* refuse(CHANNEL_MESSAGE_UNKNOWN);
          return yield* handle(message);
        });

        const life = Effect.gen(function* () {
          const socket = yield* Effect.mapError(dialSocket(url), () => refuse(CHANNEL_UNREACHABLE));
          const write = Effect.fn('RemoteChannel.write')(function* (item: Outgoing) {
            const sealer = seal;
            const sent = Effect.gen(function* () {
              if (phase !== 'open' || !sealer) return yield* refuse(CHANNEL_CLOSED);
              const frame = yield* enter(() => sealer(encodeText(serializeChannelMessage(item.message))));
              if (phase === 'open') yield* socket.send(frame);
            });
            const exit = yield* Effect.exit(sent);
            outstanding.delete(item);
            yield* Deferred.done(item.sent, exit);
          });
          yield* Effect.forkScoped(Effect.forever(Effect.flatMap(Queue.take(outbox), write)));
          yield* socket.send(JSON.stringify(prepared.hello));
          return yield* socket.frames.pipe(
            Stream.runForEach(receive),
            Effect.andThen(Effect.fail(refuse(CHANNEL_DROPPED))),
            Effect.catchTag('SocketError', (error) =>
              Effect.fail(
                refuse(
                  (error.reason._tag === 'SocketCloseError' && error.reason.closeReason) || CHANNEL_DROPPED
                )
              )
            )
          );
        });
        yield* Effect.catch(life, (error) => Effect.sync(() => failNow(error)));
      }, Effect.scoped);

      const open = Effect.fn('RemoteChannels.open')(
        function* (options: ChannelOptions) {
          const preparing = yield* Effect.forkChild(prepareHello(options));
          const url = yield* Effect.promise(() => Promise.resolve(options.url));
          const prepared = yield* Fiber.join(preparing);
          const ready = yield* Deferred.make<ChannelLink, ChannelError>();
          yield* Effect.forkDetach(run(url, prepared, options, ready));
          return yield* Deferred.await(ready);
        },
        Effect.provideService(Socket.WebSocketConstructor, makeWebSocket)
      );

      return RemoteChannels.of({ open });
    })
  );
}
