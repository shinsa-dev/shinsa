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
  RELAY_MAX_MESSAGE_BYTES,
  RELAY_MAX_STREAM_ID,
  RELAY_MAX_STREAMS,
  RELAY_PONG,
  type RelayControl,
  type RelayResponse,
  type RelayStreamId,
  type RelayStreamKind,
  serializeRelayControl,
  serializeRelayData,
} from '@shinsa/core';
import { type Cause, Deferred, Effect, Option, Queue, Result, Schema, Stream } from 'effect';
import {
  BODILESS_STATUSES,
  RELAY_ADDRESS_HEADER,
  RELAY_CLOSE_REASONS,
  RELAY_HANDSHAKE_HEADERS,
  RELAY_INTERNAL_HEADERS,
  RELAY_REFUSALS,
  RELAY_RESPONSE_TIMEOUT,
  RELAY_ROLE_HEADER,
  RelayBodyBroken,
  type RelayHub,
  type RelayPeer,
  type RelayRefusal,
  RelayRole,
  type RelayRoom,
} from './schema.ts';

export function createRelayHub(room: RelayRoom): RelayHub {
  const decodeRole = Schema.decodeUnknownOption(RelayRole);
  const answers = new Map<number, Deferred.Deferred<Option.Option<RelayResponse>>>();
  const bodies = new Map<number, Queue.Queue<Bytes, RelayBodyBroken | Cause.Done>>();
  let nextStream = 1;

  const send = (peer: RelayPeer, message: string | Bytes) =>
    Effect.ignore(Effect.try(() => peer.send(message)));

  const close = (peer: RelayPeer, code: number, reason: string) =>
    Effect.ignore(Effect.try(() => peer.close(code, reason)));

  const resolveCloseCode = (code: number) => (code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000);

  const selectMachine = () =>
    Option.fromNullishOr(room.listPeers().find((peer) => peer.tag.role === 'machine'));

  const selectBrowser = (stream: number) =>
    Option.fromNullishOr(
      room.listPeers().find((peer) => peer.tag.role === 'browser' && peer.tag.stream === stream)
    );

  const countStreams = () =>
    answers.size + bodies.size + room.listPeers().filter((peer) => peer.tag.role === 'browser').length;

  const isStreamUsed = (stream: number) =>
    answers.has(stream) || bodies.has(stream) || Option.isSome(selectBrowser(stream));

  const allocateStream = (): Option.Option<RelayStreamId> => {
    if (countStreams() >= RELAY_MAX_STREAMS) return Option.none();
    while (isStreamUsed(nextStream)) nextStream = nextStream >= RELAY_MAX_STREAM_ID ? 1 : nextStream + 1;
    const stream = nextStream as RelayStreamId;
    nextStream = nextStream >= RELAY_MAX_STREAM_ID ? 1 : nextStream + 1;
    return Option.some(stream);
  };

  const sendControl = (peer: RelayPeer, frame: RelayControl) => send(peer, serializeRelayControl(frame));

  const toHeaders = (headers: RelayResponse['headers']) =>
    new Headers(headers.map(([name, value]) => [name, value]));

  const respondRefusal = (refusal: RelayRefusal) =>
    new Response(RELAY_REFUSALS[refusal].text, {
      status: RELAY_REFUSALS[refusal].status,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });

  const releaseStream = Effect.fn('RelayHub.releaseStream')(function* (stream: number) {
    answers.delete(stream);
    const body = bodies.get(stream);
    bodies.delete(stream);
    if (body) yield* Queue.fail(body, new RelayBodyBroken({ message: RELAY_REFUSALS.dropped.text }));
  });

  const cancelStream = Effect.fn('RelayHub.cancelStream')(function* (stream: RelayStreamId) {
    if (!answers.has(stream) && !bodies.has(stream)) return;
    yield* releaseStream(stream);
    const machine = selectMachine();
    if (Option.isSome(machine))
      yield* sendControl(machine.value, {
        type: 'close',
        stream,
        code: RELAY_CLOSE.normal,
        reason: RELAY_CLOSE_REASONS.cancelled,
      });
  });

  const dropStreams = Effect.fn('RelayHub.dropStreams')(function* () {
    for (const peer of room.listPeers())
      if (peer.tag.role === 'browser')
        yield* close(peer, RELAY_CLOSE.machineGone, RELAY_CLOSE_REASONS.machineGone);
    for (const answer of answers.values()) yield* Deferred.succeed(answer, Option.none());
    for (const stream of [...bodies.keys()]) yield* releaseStream(stream);
    answers.clear();
  });

  const listOpenHeaders = (headers: Headers, kind: RelayStreamKind) =>
    [...headers].filter(
      ([name]) =>
        !RELAY_INTERNAL_HEADERS.has(name) && !(kind === 'socket' && RELAY_HANDSHAKE_HEADERS.has(name))
    );

  const openStream = Effect.fn('RelayHub.openStream')(function* (
    machine: RelayPeer,
    stream: RelayStreamId,
    request: Request,
    kind: RelayStreamKind
  ) {
    const url = new URL(request.url);
    const address = request.headers.get(RELAY_ADDRESS_HEADER);
    const answer = yield* Deferred.make<Option.Option<RelayResponse>>();
    answers.set(stream, answer);
    yield* sendControl(machine, {
      type: 'open',
      stream,
      kind,
      method: request.method,
      path: `${url.pathname}${url.search}`,
      headers: listOpenHeaders(request.headers, kind),
      ...(address ? { address } : {}),
    });
    return answer;
  });

  const settle = Effect.fn('RelayHub.settle')(function* (
    stream: RelayStreamId,
    answer: Deferred.Deferred<Option.Option<RelayResponse>>
  ) {
    const settled = yield* Deferred.await(answer).pipe(Effect.timeoutOption(RELAY_RESPONSE_TIMEOUT));
    answers.delete(stream);
    if (Option.isSome(settled)) return Result.fromOption(settled.value, (): RelayRefusal => 'dropped');
    yield* cancelStream(stream);
    return Result.fail<RelayRefusal>('timeout');
  });

  const sendBody = Effect.fn('RelayHub.sendBody')(function* (
    machine: RelayPeer,
    stream: RelayStreamId,
    request: Request
  ) {
    const body = request.body;
    if (body)
      yield* Stream.fromReadableStream({
        evaluate: () => body,
        onError: () => new RelayBodyBroken({ message: RELAY_CLOSE_REASONS.cancelled }),
      }).pipe(
        Stream.runForEach((chunk: Bytes) =>
          Effect.forEach(listRelayBodyFrames(stream, chunk), (frame) => send(machine, frame), {
            discard: true,
          })
        ),
        Effect.ignore
      );
    yield* sendControl(machine, { type: 'end', stream });
  });

  const respondBody = (stream: RelayStreamId, response: RelayResponse) => {
    const body = bodies.get(stream);
    if (!body || BODILESS_STATUSES.has(response.status)) {
      bodies.delete(stream);
      return new Response(null, { status: response.status, headers: toHeaders(response.headers) });
    }
    const readable = Stream.fromQueue(body).pipe(
      Stream.ensuring(
        Effect.suspend(() => (bodies.get(stream) === body ? cancelStream(stream) : Effect.void))
      ),
      Stream.toReadableStream()
    );
    return new Response(readable, { status: response.status, headers: toHeaders(response.headers) });
  };

  const requestHttp = Effect.fn('RelayHub.requestHttp')(function* (request: Request) {
    const machine = selectMachine();
    if (Option.isNone(machine)) return respondRefusal('offline');
    const stream = allocateStream();
    if (Option.isNone(stream)) return respondRefusal('busy');
    bodies.set(stream.value, yield* Queue.unbounded<Bytes, RelayBodyBroken | Cause.Done>());
    const answer = yield* openStream(machine.value, stream.value, request, 'http');
    yield* sendBody(machine.value, stream.value, request);
    const settled = yield* settle(stream.value, answer);
    if (Result.isFailure(settled)) return respondRefusal(settled.failure);
    return respondBody(stream.value, settled.success);
  });

  const openSocket = Effect.fn('RelayHub.openSocket')(function* (request: Request) {
    const machine = selectMachine();
    if (Option.isNone(machine)) return respondRefusal('offline');
    const stream = allocateStream();
    if (Option.isNone(stream)) return respondRefusal('busy');
    const answer = yield* openStream(machine.value, stream.value, request, 'socket');
    const settled = yield* settle(stream.value, answer);
    if (Result.isFailure(settled)) return respondRefusal(settled.failure);
    const response = settled.success;
    if (response.status !== 101)
      return new Response(null, { status: response.status, headers: toHeaders(response.headers) });
    const protocol = response.headers.find(([name]) => name.toLowerCase() === 'sec-websocket-protocol');
    return room.accept({ role: 'browser', stream: stream.value }, protocol?.[1] ?? null);
  });

  const connectMachine = Effect.fn('RelayHub.connectMachine')(function* () {
    const earlier = room.listPeers().filter((peer) => peer.tag.role === 'machine');
    for (const peer of earlier) yield* close(peer, RELAY_CLOSE.replaced, RELAY_CLOSE_REASONS.replaced);
    yield* dropStreams();
    return room.accept({ role: 'machine' }, null);
  });

  const fetch = Effect.fn('RelayHub.fetch')(function* (request: Request) {
    const role = decodeRole(request.headers.get(RELAY_ROLE_HEADER));
    if (Option.isNone(role)) return respondRefusal('unknown');
    if (role.value === 'machine') return yield* connectMachine();
    if (role.value === 'socket') return yield* openSocket(request);
    return yield* requestHttp(request);
  });

  const receiveControl = Effect.fn('RelayHub.receiveControl')(function* (
    machine: RelayPeer,
    frame: RelayControl
  ) {
    if (frame.type === 'ping') return yield* send(machine, RELAY_PONG);
    if (frame.type === 'response') {
      const answer = answers.get(frame.stream);
      if (answer) yield* Deferred.succeed(answer, Option.some(frame));
      return;
    }
    if (frame.type === 'end') {
      const body = bodies.get(frame.stream);
      bodies.delete(frame.stream);
      if (body) yield* Queue.end(body);
      return;
    }
    if (frame.type !== 'close') return;
    const answer = answers.get(frame.stream);
    if (answer) yield* Deferred.succeed(answer, Option.none());
    yield* releaseStream(frame.stream);
    const browser = selectBrowser(frame.stream);
    if (Option.isSome(browser))
      yield* close(
        browser.value,
        resolveCloseCode(frame.code),
        frame.reason.slice(0, RELAY_CLOSE_REASON_LIMIT)
      );
  });

  const receiveData = Effect.fn('RelayHub.receiveData')(function* (bytes: Bytes) {
    const frame = parseRelayData(bytes);
    if (Option.isNone(frame)) return;
    const { stream, kind, payload } = frame.value;
    const body = bodies.get(stream);
    if (body) return yield* Queue.offer(body, payload.slice());
    const browser = selectBrowser(stream);
    if (Option.isSome(browser))
      yield* send(browser.value, kind === 'text' ? decodeText(payload) : payload.slice());
  });

  const receiveBrowser = Effect.fn('RelayHub.receiveBrowser')(function* (
    browser: RelayPeer,
    stream: RelayStreamId,
    message: string | ArrayBuffer
  ) {
    const machine = selectMachine();
    if (Option.isNone(machine))
      return yield* close(browser, RELAY_CLOSE.machineGone, RELAY_CLOSE_REASONS.machineGone);
    const payload = typeof message === 'string' ? encodeText(message) : new Uint8Array(message);
    if (payload.length + RELAY_DATA_HEADER_BYTES > RELAY_MAX_MESSAGE_BYTES) {
      yield* close(browser, RELAY_CLOSE.tooLarge, RELAY_CLOSE_REASONS.tooLarge);
      return yield* sendControl(machine.value, {
        type: 'close',
        stream,
        code: RELAY_CLOSE.tooLarge,
        reason: RELAY_CLOSE_REASONS.tooLarge,
      });
    }
    yield* send(
      machine.value,
      serializeRelayData({ stream, kind: typeof message === 'string' ? 'text' : 'binary', payload })
    );
  });

  const receive = Effect.fn('RelayHub.receive')(function* (peer: RelayPeer, message: string | ArrayBuffer) {
    if (peer.tag.role === 'browser')
      return yield* receiveBrowser(peer, peer.tag.stream as RelayStreamId, message);
    if (typeof message !== 'string') return yield* receiveData(new Uint8Array(message));
    const frame = parseRelayControl(message);
    if (Option.isSome(frame)) yield* receiveControl(peer, frame.value);
  });

  const closed = Effect.fn('RelayHub.closed')(function* (peer: RelayPeer, code: number, reason: string) {
    if (peer.tag.role === 'machine') {
      const others = room.listPeers().some((other) => other !== peer && other.tag.role === 'machine');
      if (!others) yield* dropStreams();
      return;
    }
    const machine = selectMachine();
    if (Option.isSome(machine))
      yield* sendControl(machine.value, {
        type: 'close',
        stream: peer.tag.stream as RelayStreamId,
        code: resolveCloseCode(code),
        reason: reason.slice(0, RELAY_CLOSE_REASON_LIMIT),
      });
  });

  return { fetch, receive, closed };
}
