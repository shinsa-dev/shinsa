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
import { Context, Deferred, Effect, Exit, Layer, Option, Queue } from 'effect';
import { Socket } from 'effect/socket';
import {
  DEVICE_CHANNEL_MESSAGES,
  DEVICE_CHANNEL_OPEN_TIMEOUT,
  DeviceChannelError,
  type DeviceChannelLink,
  type DeviceChannelOptions,
  type DeviceChannelRequest,
  type DeviceChannelsShape,
  type DeviceFrame,
  type DeviceHello,
  type DeviceOutgoing,
  type DevicePending,
  DeviceRequestAborted,
  type DeviceRequestFailure,
  NULL_BODY_STATUSES,
} from './schema.ts';

export class DeviceChannels extends Context.Service<DeviceChannels, DeviceChannelsShape>()(
  'shinsa/engine/remote/device-channel/DeviceChannels'
) {
  static readonly layer = Layer.effect(
    DeviceChannels,
    Effect.gen(function* () {
      const makeWebSocket = yield* Socket.WebSocketConstructor;
      const fail = (message: string, refused = false) => new DeviceChannelError({ message, refused });

      const prepareHello = Effect.fn('DeviceChannels.prepareHello')(function* (
        options: DeviceChannelOptions
      ) {
        const machinePublicKey = yield* parsePublicKey(options.machineKey);
        if (!machinePublicKey) return yield* fail(DEVICE_CHANNEL_MESSAGES.keyInvalid);
        const ephemeral = yield* Effect.promise(
          () =>
            crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, ['deriveBits']) as Promise<CryptoKeyPair>
        );
        const device = yield* serializePublicKey(options.device.publicKey);
        const clientEphemeral = yield* serializePublicKey(ephemeral.publicKey);
        const proof = options.enrollSecret
          ? yield* Effect.option(
              createEnrollProof(options.enrollSecret, {
                machine: options.machineKey,
                device,
                clientEphemeral,
              })
            )
          : Option.none();
        if (options.enrollSecret && Option.isNone(proof)) return yield* fail(DEVICE_CHANNEL_MESSAGES.broke);
        const hello = yield* createClientHello(
          options.device.publicKey,
          ephemeral.publicKey,
          Option.getOrNull(proof),
          options.name,
          [CHANNEL_COMPRESSION]
        );
        const prepared: DeviceHello = { machinePublicKey, ephemeral, device, clientEphemeral, hello };
        return prepared;
      });

      const run = Effect.fn('DeviceChannels.run')(function* (
        prepared: DeviceHello,
        options: DeviceChannelOptions,
        ready: Deferred.Deferred<DeviceChannelLink, DeviceChannelError>
      ) {
        const self = yield* Effect.withFiber((fiber) => Effect.succeed(fiber));
        let phase: 'hello' | 'open' | 'closed' = 'hello';
        let confirmed = false;
        let seal: ReturnType<typeof createFrameSealer> | null = null;
        let open: ReturnType<typeof createFrameOpener> | null = null;
        let nextId = 0;
        const pending = new Map<string, DevicePending>();
        const outstanding = new Set<DeviceOutgoing>();
        const socketListeners = new Set<(data: string) => void>();
        const unheard: string[] = [];
        let closedWith: DeviceChannelError | null = null;
        const closeListeners = new Set<(error: DeviceChannelError) => void>();
        const outbox = yield* Queue.unbounded<DeviceOutgoing>();

        const failNow = (error: DeviceChannelError) => {
          if (phase === 'closed') return;
          phase = 'closed';
          closedWith = error;
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
          const item: DeviceOutgoing = { message, sent: Deferred.makeUnsafe() };
          outstanding.add(item);
          Queue.offerUnsafe(outbox, item);
          return item;
        };

        const send = Effect.fn('DeviceChannel.send')(function* (message: ChannelMessage) {
          if (phase !== 'open') return yield* fail(DEVICE_CHANNEL_MESSAGES.closed);
          return yield* Deferred.await(enqueue(message).sent);
        });

        const abort = (id: string) => {
          const waiting = pending.get(id);
          if (!waiting) return;
          pending.delete(id);
          const error = new DeviceRequestAborted({ message: DEVICE_CHANNEL_MESSAGES.aborted });
          Deferred.doneUnsafe(waiting.answer, Exit.fail(error));
          waiting.stream?.error(error);
          if (phase === 'open') enqueue({ t: 'abort', id });
        };

        const request = Effect.fn('DeviceChannel.request')(function* (input: DeviceChannelRequest) {
          if (!(phase === 'open' && confirmed)) return yield* fail(DEVICE_CHANNEL_MESSAGES.closed);
          nextId += 1;
          const id = String(nextId);
          const answer = yield* Deferred.make<Response, DeviceRequestFailure>();
          pending.set(id, { answer, stream: null });
          input.signal?.addEventListener('abort', () => abort(id), { once: true });
          yield* send({ t: 'request', id, method: input.method, path: input.path, headers: input.headers });
          for (const message of listBodyMessages(id, input.body ?? new Uint8Array())) yield* send(message);
          return yield* Deferred.await(answer);
        });

        const link: DeviceChannelLink = {
          isOpen: Effect.sync(() => phase === 'open' && confirmed),
          request,
          sendSocket: (data) => send({ t: 'socket', data }),
          subscribeSocket: (listener) => {
            socketListeners.add(listener);
            for (const data of unheard.splice(0)) listener(data);
            return () => socketListeners.delete(listener);
          },
          subscribeClose: (listener) => {
            if (closedWith) {
              listener(closedWith);
              return () => undefined;
            }
            closeListeners.add(listener);
            return () => closeListeners.delete(listener);
          },
          close: Effect.sync(() => {
            failNow(fail(DEVICE_CHANNEL_MESSAGES.closedHere));
            self.interruptUnsafe();
          }),
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
          else Deferred.doneUnsafe(waiting.answer, Exit.fail(fail(DEVICE_CHANNEL_MESSAGES.unanswered)));
        };

        const handle = (message: ChannelMessage) => {
          switch (message.t) {
            case 'ready':
              confirmed = true;
              Deferred.doneUnsafe(ready, Exit.succeed(link));
              return Effect.void;
            case 'socket':
              if (socketListeners.size === 0) unheard.push(message.data);
              for (const listener of socketListeners) listener(message.data);
              return Effect.void;
            case 'response':
              respond(message);
              return Effect.void;
            case 'body': {
              const bytes = Option.getOrNull(parseBodyChunk(message.chunk));
              const stream = pending.get(message.id)?.stream;
              if (stream && bytes) stream.enqueue(bytes);
              return Effect.void;
            }
            case 'end':
              finish(message.id);
              return Effect.void;
            default:
              return Effect.fail(fail(DEVICE_CHANNEL_MESSAGES.clientOnly));
          }
        };

        const handshake = Effect.fn('DeviceChannel.handshake')(function* (text: string) {
          const welcome = Option.getOrNull(parseServerHello(text));
          if (welcome?.type === 'refused') return yield* fail(welcome.reason, true);
          if (welcome?.type === 'pending') return;
          if (!welcome) return yield* fail(DEVICE_CHANNEL_MESSAGES.handshakeUnknown);
          const derived = yield* Effect.option(
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
          if (Option.isNone(derived)) return yield* fail(DEVICE_CHANNEL_MESSAGES.broke);
          seal = createFrameSealer(derived.value.send, welcome.compression);
          open = createFrameOpener(derived.value.receive, welcome.compression);
          phase = 'open';
          yield* send({ t: 'ready' });
        });

        const receive = Effect.fn('DeviceChannel.receive')(function* (frame: DeviceFrame) {
          if (phase === 'hello') {
            if (typeof frame !== 'string') return yield* fail(DEVICE_CHANNEL_MESSAGES.handshakeMissing);
            return yield* handshake(frame);
          }
          const opener = open;
          if (typeof frame === 'string' || !opener) return yield* fail(DEVICE_CHANNEL_MESSAGES.unsealed);
          const opened = yield* Effect.option(opener(new Uint8Array(frame)));
          if (Option.isNone(opened)) return yield* fail(DEVICE_CHANNEL_MESSAGES.broke);
          const message = Option.getOrNull(parseChannelMessage(decodeText(opened.value)));
          if (!message) return yield* fail(DEVICE_CHANNEL_MESSAGES.unknown);
          return yield* handle(message);
        });

        const closeReason = (error: Socket.SocketError) =>
          (error.reason._tag === 'SocketCloseError' && error.reason.closeReason) ||
          (error.reason._tag === 'SocketOpenError' ? DEVICE_CHANNEL_MESSAGES.unreachable : null) ||
          DEVICE_CHANNEL_MESSAGES.dropped;

        const life = Effect.gen(function* () {
          const socket = yield* Socket.makeWebSocket(options.url, {
            headers: { Origin: options.origin },
            openTimeout: DEVICE_CHANNEL_OPEN_TIMEOUT,
          });
          const reader = yield* socket.reader;
          const writer = yield* socket.writer;
          const write = Effect.fn('DeviceChannel.write')(function* (item: DeviceOutgoing) {
            const sealer = seal;
            const sent = Effect.gen(function* () {
              if (phase !== 'open' || !sealer) return yield* fail(DEVICE_CHANNEL_MESSAGES.closed);
              const frame = yield* sealer(encodeText(serializeChannelMessage(item.message)));
              yield* Effect.ignore(writer.write(frame));
            });
            const exit = yield* Effect.exit(sent);
            outstanding.delete(item);
            yield* Deferred.done(item.sent, exit);
          });
          yield* Effect.forkScoped(Effect.forever(Effect.flatMap(Queue.take(outbox), write)));
          yield* writer.write(JSON.stringify(prepared.hello));
          return yield* Effect.forever(
            Effect.flatMap(reader.pull, (frames) => Effect.forEach(frames, receive, { discard: true }))
          );
        }).pipe(Effect.catchTag('SocketError', (error) => Effect.fail(fail(closeReason(error)))));
        yield* Effect.catch(life, (error) => Effect.sync(() => failNow(error)));
      }, Effect.scoped);

      const openChannel = Effect.fn('DeviceChannels.open')(
        function* (options: DeviceChannelOptions) {
          const prepared = yield* prepareHello(options);
          const ready = yield* Deferred.make<DeviceChannelLink, DeviceChannelError>();
          yield* Effect.forkDetach(run(prepared, options, ready));
          return yield* Deferred.await(ready);
        },
        Effect.provideService(Socket.WebSocketConstructor, makeWebSocket)
      );

      return DeviceChannels.of({ open: openChannel });
    })
  );
}
