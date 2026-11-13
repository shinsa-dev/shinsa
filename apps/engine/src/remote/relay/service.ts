import {
  type Bytes,
  decodeText,
  encodeText,
  listRelayBodyFrames,
  parseRelayControl,
  parseRelayData,
  RELAY_CLOSE,
  RELAY_CLOSE_REASON_LIMIT,
  RELAY_DATA_HEADER_BYTES,
  RELAY_MAX_STREAMS,
  RELAY_PING,
  type RelayControl,
  type RelayData,
  type RelayOpen,
  type RelayStreamId,
  resolveRelayMachineUrl,
  serializeRelayControl,
  serializeRelayData,
} from '@shinsa/core';
import {
  Context,
  Deferred,
  Effect,
  Fiber,
  Latch,
  Layer,
  Option,
  Queue,
  Redacted,
  type Scope,
  Stream,
} from 'effect';
import { Socket } from 'effect/socket';
import { RemoteOrigin } from '../client/schema.ts';
import {
  describeSocketError,
  listResponseHeaders,
  listSocketProtocols,
  resolveCloseCode,
  resolveDialHeaders,
  resolveLocalTarget,
  selectRefusalStatus,
  selectSocketProtocol,
} from './headers.ts';
import {
  RELAY_BODILESS_METHODS,
  RELAY_MESSAGES,
  RELAY_PROTOCOL_HEADER,
  RELAY_STREAM_FAILED,
  RelayConnectFailed,
  RelayDialFailed,
  RelayFetch,
  RelayLimits,
  type RelayInbound,
  type RelayLink,
  type RelayStream,
  type RelayTarget,
} from './schema.ts';

export class RelayConnector extends Context.Service<
  RelayConnector,
  { open(target: RelayTarget): Effect.Effect<RelayLink, RelayConnectFailed, Scope.Scope> }
>()('shinsa/engine/remote/relay/RelayConnector') {
  static readonly layer = Layer.effect(
    RelayConnector,
    Effect.gen(function* () {
      const makeWebSocket = yield* Socket.WebSocketConstructor;
      const origin = yield* RemoteOrigin;
      const send = yield* RelayFetch;
      const limits = yield* RelayLimits;

      const open = Effect.fn('RelayConnector.open')(function* (target: RelayTarget) {
        const scope = yield* Effect.scope;
        const socket = yield* Socket.makeWebSocket(resolveRelayMachineUrl(target.instanceId, origin), {
          headers: { authorization: `Bearer ${Redacted.value(target.machineToken)}` },
          openTimeout: limits.connectTimeout,
        }).pipe(Effect.provideService(Socket.WebSocketConstructor, makeWebSocket));
        const reader = yield* socket.reader.pipe(
          Effect.mapError(
            (error) =>
              new RelayConnectFailed({
                message: describeSocketError(error),
                status: Option.getOrNull(selectRefusalStatus(error)),
              })
          )
        );
        const writer = yield* socket.writer;
        const streams = new Map<number, RelayStream>();
        const pongs = new Set<Deferred.Deferred<void>>();

        const write = (message: string | Bytes) => Effect.ignore(writer.write(message));

        const writeControl = (frame: RelayControl) => write(serializeRelayControl(frame));

        const writeClose = (stream: RelayStreamId, code: number, reason: string) =>
          writeControl({ type: 'close', stream, code, reason: reason.slice(0, RELAY_CLOSE_REASON_LIMIT) });

        const release = (stream: RelayStreamId, entry: RelayStream) =>
          Effect.sync(() => {
            if (streams.get(stream) !== entry) return false;
            streams.delete(stream);
            return true;
          });

        const answerHttp = Effect.fn('RelayConnector.answerHttp')(function* (
          stream: RelayStreamId,
          request: RelayOpen,
          body: Bytes,
          flow: Latch.Latch
        ) {
          const response = yield* Effect.tryPromise({
            try: (signal) =>
              send(resolveLocalTarget(target.localUrl, request.path, false), {
                method: request.method,
                headers: resolveDialHeaders(request),
                body: RELAY_BODILESS_METHODS.has(request.method) ? null : body,
                redirect: 'manual',
                decompress: false,
                signal,
              }),
            catch: (error) => new RelayDialFailed({ message: String(error) }),
          });
          yield* writeControl({
            type: 'response',
            stream,
            status: response.status,
            headers: listResponseHeaders(response.headers),
          });
          const readable = response.body;
          if (readable)
            yield* Stream.fromReadableStream({
              evaluate: () => readable,
              onError: (error) => new RelayDialFailed({ message: String(error) }),
            }).pipe(
              Stream.runForEach((chunk: Bytes) =>
                Effect.forEach(listRelayBodyFrames(stream, chunk), (frame) => flow.whenOpen(write(frame)), {
                  discard: true,
                })
              )
            );
          yield* writeControl({ type: 'end', stream });
        });

        const runHttp = (stream: RelayStreamId, entry: Extract<RelayStream, { kind: 'http' }>) => {
          const body = new Uint8Array(entry.size);
          let offset = 0;
          for (const chunk of entry.chunks) {
            body.set(chunk, offset);
            offset += chunk.length;
          }
          entry.chunks.length = 0;
          return answerHttp(stream, entry.open, body, entry.flow).pipe(
            Effect.catch(() => writeClose(stream, RELAY_STREAM_FAILED, RELAY_MESSAGES.unanswered)),
            Effect.ensuring(release(stream, entry))
          );
        };

        const serveSocket = Effect.fn('RelayConnector.serveSocket')(function* (
          stream: RelayStreamId,
          request: RelayOpen,
          entry: Extract<RelayStream, { kind: 'socket' }>
        ) {
          const created: { socket: Socket.WebSocketLike | null } = { socket: null };
          const local = yield* Socket.makeWebSocket(resolveLocalTarget(target.localUrl, request.path, true), {
            headers: resolveDialHeaders(request),
            protocols: listSocketProtocols(request),
            openTimeout: limits.dialTimeout,
          }).pipe(
            Effect.provideService(Socket.WebSocketConstructor, (url, options) => {
              created.socket = makeWebSocket(url, options);
              return created.socket;
            })
          );
          const localWriter = yield* local.writer;
          const localReader = yield* Effect.result(local.reader);
          if (localReader._tag === 'Failure') {
            const status = Option.getOrElse(selectRefusalStatus(localReader.failure), () => 502);
            yield* writeControl({ type: 'response', stream, status, headers: [] });
            return;
          }
          yield* writeControl({
            type: 'response',
            stream,
            status: 101,
            headers: Option.match(selectSocketProtocol(created.socket), {
              onNone: () => [],
              onSome: (protocol) => [[RELAY_PROTOCOL_HEADER, protocol]],
            }),
          });
          yield* Effect.forkScoped(
            Effect.forever(
              Effect.flatMap(Queue.take(entry.inbox), (message) => Effect.ignore(localWriter.write(message)))
            )
          );
          const ended = yield* Effect.flip(
            Effect.forever(
              Effect.flatMap(localReader.success.pull, (frames) =>
                Effect.forEach(frames, (frame) => forwardLocal(stream, frame), { discard: true })
              )
            )
          );
          if (!(yield* release(stream, entry))) return;
          if (ended === 'tooLarge') {
            yield* Effect.ignore(
              localWriter.write(new Socket.CloseEvent(RELAY_CLOSE.tooLarge, RELAY_MESSAGES.tooLarge))
            );
            return yield* writeClose(stream, RELAY_CLOSE.tooLarge, RELAY_MESSAGES.tooLarge);
          }
          const reason = ended.reason;
          const code =
            reason._tag === 'SocketCloseError' ? resolveCloseCode(reason.code) : RELAY_STREAM_FAILED;
          yield* writeClose(stream, code, describeSocketError(ended));
        }, Effect.scoped);

        const forwardLocal = (stream: RelayStreamId, frame: string | Uint8Array) => {
          const text = typeof frame === 'string';
          const payload = text ? encodeText(frame) : new Uint8Array(frame);
          if (payload.length + RELAY_DATA_HEADER_BYTES > limits.messageBytes)
            return Effect.fail('tooLarge' as const);
          return write(serializeRelayData({ stream, kind: text ? 'text' : 'binary', payload }));
        };

        const startStream = Effect.fn('RelayConnector.startStream')(function* (request: RelayOpen) {
          if (streams.has(request.stream)) return;
          if (streams.size >= RELAY_MAX_STREAMS)
            return yield* writeClose(request.stream, RELAY_CLOSE.refused, RELAY_MESSAGES.busy);
          if (request.kind === 'http') {
            streams.set(request.stream, {
              kind: 'http',
              open: request,
              chunks: [],
              size: 0,
              fiber: null,
              flow: yield* Latch.make(true),
            });
            return;
          }
          const entry: RelayStream = { kind: 'socket', inbox: yield* Queue.unbounded<RelayInbound>() };
          streams.set(request.stream, entry);
          yield* Effect.forkIn(
            serveSocket(request.stream, request, entry).pipe(Effect.ensuring(release(request.stream, entry))),
            scope
          );
        });

        const endStream = Effect.fn('RelayConnector.endStream')(function* (stream: RelayStreamId) {
          const entry = streams.get(stream);
          if (entry?.kind !== 'http' || entry.fiber) return;
          entry.fiber = yield* Effect.forkIn(runHttp(stream, entry), scope);
        });

        const closeStream = Effect.fn('RelayConnector.closeStream')(function* (
          stream: RelayStreamId,
          code: number,
          reason: string
        ) {
          const entry = streams.get(stream);
          if (!entry) return;
          streams.delete(stream);
          if (entry.kind === 'socket')
            return yield* Queue.offer(entry.inbox, new Socket.CloseEvent(resolveCloseCode(code), reason));
          if (entry.fiber) yield* Effect.forkIn(Fiber.interrupt(entry.fiber), scope);
        });

        const receiveData = Effect.fn('RelayConnector.receiveData')(function* (frame: RelayData) {
          const entry = streams.get(frame.stream);
          if (!entry) return;
          if (entry.kind === 'socket') {
            const message = frame.kind === 'text' ? decodeText(frame.payload) : frame.payload.slice();
            return yield* Queue.offer(entry.inbox, message);
          }
          if (entry.fiber) return;
          entry.size += frame.payload.length;
          if (entry.size > limits.requestBodyBytes) {
            streams.delete(frame.stream);
            return yield* writeClose(frame.stream, RELAY_CLOSE.tooLarge, RELAY_MESSAGES.tooLarge);
          }
          entry.chunks.push(frame.payload.slice());
        });

        const flowStream = (stream: RelayStreamId, flowing: boolean) => {
          const entry = streams.get(stream);
          if (entry?.kind !== 'http') return Effect.void;
          return Effect.asVoid(flowing ? entry.flow.open : entry.flow.close);
        };

        const receiveControl = Effect.fn('RelayConnector.receiveControl')(function* (frame: RelayControl) {
          if (frame.type === 'pong') {
            for (const pong of pongs) yield* Deferred.succeed(pong, undefined);
            return;
          }
          if (frame.type === 'open') return yield* startStream(frame);
          if (frame.type === 'pause') return yield* flowStream(frame.stream, false);
          if (frame.type === 'resume') return yield* flowStream(frame.stream, true);
          if (frame.type === 'end') return yield* endStream(frame.stream);
          if (frame.type === 'close') return yield* closeStream(frame.stream, frame.code, frame.reason);
        });

        const receive = (message: string | Uint8Array) => {
          if (typeof message === 'string')
            return Option.match(parseRelayControl(message), {
              onNone: () => Effect.void,
              onSome: receiveControl,
            });
          return Option.match(parseRelayData(new Uint8Array(message)), {
            onNone: () => Effect.void,
            onSome: receiveData,
          });
        };

        const reading = yield* Effect.forkIn(
          Effect.forever(
            Effect.flatMap(reader.pull, (messages) => Effect.forEach(messages, receive, { discard: true }))
          ).pipe(Effect.catch((error) => Effect.succeed(describeSocketError(error)))),
          scope
        );

        const ping = Effect.gen(function* () {
          const pong = yield* Deferred.make<void>();
          pongs.add(pong);
          yield* write(RELAY_PING);
          const answered = yield* Deferred.await(pong).pipe(
            Effect.timeoutOption(limits.pingTimeout),
            Effect.ensuring(Effect.sync(() => pongs.delete(pong)))
          );
          return Option.isSome(answered);
        }).pipe(Effect.withSpan('RelayConnector.ping'));

        const link: RelayLink = { closed: Fiber.join(reading), ping };
        return link;
      });

      return RelayConnector.of({ open });
    })
  );
}
