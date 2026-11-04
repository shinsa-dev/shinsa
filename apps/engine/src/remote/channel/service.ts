import {
  type Bytes,
  CHANNEL_BODY_CHUNK_BYTES,
  type ChannelHeaders,
  type ChannelMessage,
  type ClientHello,
  concatBytes,
  createFrameOpener,
  createFrameSealer,
  decodeText,
  deriveServerSession,
  encodeText,
  type GuestActor,
  MAX_TERMINAL_STREAMS,
  parseBase64Url,
  parseBodyChunk,
  parseChannelMessage,
  parseClientHello,
  REMOTE_KEY_ALGORITHM,
  resolveCompression,
  type ServerHello,
  serializeBase64Url,
  serializeChannelMessage,
  serializePublicKey,
  TERMINAL_STREAM_CLOSE,
} from '@shinsa/core';
import { Cause, Effect, Ref, Semaphore } from 'effect';
import type { HubSocket } from '../../http/socket.ts';
import { describeError } from '../../log/redact.ts';
import type { TerminalSession } from '../../terminals/schema.ts';
import { applyTerminalText } from '../../terminals/sockets.ts';
import { POLICY_VIOLATION } from '../schema.ts';
import {
  CHANNEL_REQUEST_ORIGIN,
  ChannelBroken,
  type ChannelDefinition,
  type ChannelRaw,
  type ChannelState,
  DROPPED,
  DROPPED_HEADERS,
  MAX_INFLATED_FRAME_BYTES,
  MAX_OPEN_REQUESTS,
  MAX_STREAM_ID_LENGTH,
  type OpenRequest,
  type ProofKeys,
  type RemoteChannelHandle,
  SENT,
  TERMINAL_STREAM_MESSAGES,
  type TerminalStream,
} from './schema.ts';

export const makeRemoteChannel = Effect.fn('RemoteChannel.make')(function* (definition: ChannelDefinition) {
  const run = Effect.runForkWith(yield* Effect.context<never>());
  const state = yield* Ref.make<ChannelState>({ kind: 'hello' });
  const requests = yield* Ref.make<ReadonlyMap<string, OpenRequest>>(new Map());
  const streams = yield* Ref.make<ReadonlyMap<string, TerminalStream>>(new Map());
  const queue = yield* Semaphore.make(1);

  const broken = (error: unknown) => new ChannelBroken({ message: describeError(error) });

  const isSafePath = (path: string) => path.startsWith('/') && !path.startsWith('//') && !path.includes('\\');

  const listForwardedHeaders = (headers: ChannelHeaders) =>
    headers.filter(([name]) => {
      const lower = name.toLowerCase();
      return !DROPPED_HEADERS.has(lower) && !lower.startsWith('sec-');
    });

  const toBytes = (raw: ChannelRaw): Bytes | null => (typeof raw === 'string' ? null : new Uint8Array(raw));

  const isOpen = Ref.get(state).pipe(Effect.map((current) => current.kind === 'open'));

  const isClosed = Ref.get(state).pipe(Effect.map((current) => current.kind === 'closed'));

  const device = Ref.get(state).pipe(
    Effect.map((current) => (current.kind === 'open' ? current.device : null))
  );

  const updateRequest = (id: string, change: (open: OpenRequest) => OpenRequest) =>
    Ref.update(requests, (open) => {
      const request = open.get(id);
      return request ? new Map(open).set(id, change(request)) : open;
    });

  const removeRequest = (id: string) =>
    Ref.update(requests, (open) => {
      const rest = new Map(open);
      rest.delete(id);
      return rest;
    });

  const selectSession = (terminalId: string): Effect.Effect<TerminalSession | null> =>
    definition.terminals ? definition.terminals.select(terminalId) : Effect.succeed(null);

  const close = Effect.gen(function* () {
    const previous = yield* Ref.getAndSet(state, { kind: 'closed' });
    if (previous.kind === 'open' && previous.socket) yield* definition.closeSocket(previous.socket);
    const open = yield* Ref.getAndSet(requests, new Map());
    for (const request of open.values()) request.controller.abort();
    for (const stream of (yield* Ref.getAndSet(streams, new Map())).values())
      (yield* selectSession(stream.terminalId))?.detach(stream.viewer);
  }).pipe(Effect.withSpan('RemoteChannel.close'));

  const fail = Effect.fn('RemoteChannel.fail')(function* (reason: string, error?: string) {
    if (yield* isClosed) return;
    if (error !== undefined)
      yield* Effect.logWarning('[Remote] Closing a remote channel').pipe(
        Effect.annotateLogs({ reason, error })
      );
    yield* definition.closePeer(POLICY_VIOLATION, reason);
    yield* close;
  });

  const send = Effect.fn('RemoteChannel.send')(function* (message: ChannelMessage) {
    const current = yield* Ref.get(state);
    if (current.kind !== 'open') return;
    const frame = yield* current.seal(encodeText(serializeChannelMessage(message)));
    if (!(yield* isOpen)) return;
    if ((yield* definition.send(frame)) !== DROPPED) return;
    yield* Effect.logWarning('[Remote] Dropped a sealed frame, closing the channel').pipe(
      Effect.annotateLogs({ bytes: frame.byteLength })
    );
    yield* fail('The channel dropped a frame.');
  });

  const post = (message: ChannelMessage) => Effect.forkDetach(send(message));

  const respondStatus = Effect.fn('RemoteChannel.respondStatus')(function* (id: string, status: number) {
    yield* send({ t: 'response', id, status, headers: [] });
    yield* send({ t: 'end', id });
  });

  const refuse = Effect.fn('RemoteChannel.refuse')(function* (reason: string) {
    yield* definition.send(JSON.stringify({ type: 'refused', reason } satisfies ServerHello));
    yield* fail(reason);
  });

  const requestAnswer = (hello: ClientHello, keys: ProofKeys) =>
    hello.enroll === null
      ? definition.resumeAccess(hello.device)
      : definition.requestAccess(hello.enroll, keys, hello.name);

  const awaitAccess = Effect.fn('RemoteChannel.awaitAccess')(function* (hello: ClientHello, keys: ProofKeys) {
    const answer = yield* requestAnswer(hello, keys);
    if (answer === null) {
      yield* refuse('This device is not added to this machine. Ask for access with its link first.');
      return false;
    }
    if (answer.kind === 'refused') {
      yield* refuse(answer.reason);
      return false;
    }
    if (answer.kind === 'admitted') return !(yield* isClosed);
    yield* definition.send(JSON.stringify({ type: 'pending' } satisfies ServerHello));
    const approved = yield* answer.decided;
    if (yield* isClosed) return false;
    if (!approved) yield* refuse('Your request to reach this machine was declined.');
    return approved;
  });

  const handshake = Effect.fn('RemoteChannel.handshake')(function* (hello: ClientHello) {
    const machine = yield* definition.machineKey;
    const keys = { machine: machine.publicKey, device: hello.device, clientEphemeral: hello.ephemeral };
    if (!(yield* definition.isEnrolled(hello.device)) && !(yield* awaitAccess(hello, keys))) return;
    const ephemeral = yield* Effect.tryPromise({
      try: () =>
        crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, ['deriveBits']) as Promise<CryptoKeyPair>,
      catch: broken,
    });
    const serverEphemeral = yield* serializePublicKey(ephemeral.publicKey);
    const session = yield* deriveServerSession({
      keys: { ...keys, serverEphemeral },
      machinePrivateKey: machine.privateKey,
      serverEphemeralPrivateKey: ephemeral.privateKey,
    }).pipe(Effect.mapError(broken));
    const compression = resolveCompression(hello);
    const guest = yield* definition.resolveGuest(hello.device);
    const opened = yield* Ref.modify(state, (current): [boolean, ChannelState] =>
      current.kind === 'closed'
        ? [false, current]
        : [
            true,
            {
              kind: 'open',
              device: hello.device,
              guest,
              seal: createFrameSealer(session.send, compression),
              open: createFrameOpener(session.receive, compression, MAX_INFLATED_FRAME_BYTES),
              socket: null,
            },
          ]
    );
    if (!opened) return;
    yield* definition.send(
      JSON.stringify({ type: 'welcome', ephemeral: serverEphemeral, compression } satisfies ServerHello)
    );
    yield* definition.recordSeen(hello.device);
    yield* post({ t: 'ready' });
  });

  const createSocket = (guest: GuestActor | null, owner: boolean): HubSocket => ({
    data: { kind: 'hub', transcripts: new Map(), surface: null, origin: owner ? 'owner' : 'remote', guest },
    send: (payload: string) => run(send({ t: 'socket', data: payload })),
  });

  const closeStream = (id: string, code: number, reason: string) =>
    send({ t: 'terminal-close', id, code, reason });

  const removeStream = (id: string) =>
    Ref.modify(streams, (open): [TerminalStream | null, ReadonlyMap<string, TerminalStream>] => {
      const stream = open.get(id);
      if (!stream) return [null, open];
      const rest = new Map(open);
      rest.delete(id);
      return [stream, rest];
    });

  const drain = Effect.gen(function* () {
    for (const stream of (yield* Ref.get(streams)).values())
      (yield* selectSession(stream.terminalId))?.drain(stream.viewer);
  }).pipe(Effect.withSpan('RemoteChannel.drain'));

  const sendTerminal = (id: string, stream: TerminalStream, data: string | Uint8Array) => {
    const message: ChannelMessage =
      typeof data === 'string'
        ? { t: 'terminal-text', id, data }
        : { t: 'terminal-bytes', id, chunk: serializeBase64Url(data as Bytes) };
    stream.pending += data.length;
    run(
      send(message).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            stream.pending -= data.length;
            if ((yield* Ref.get(streams)).get(id) === stream) yield* drain;
          })
        )
      )
    );
    return SENT;
  };

  const openTerminal = Effect.fn('RemoteChannel.openTerminal')(function* (
    id: string,
    terminalId: string,
    guest: GuestActor | null
  ) {
    const open = yield* Ref.get(streams);
    if (open.has(id) || id.length > MAX_STREAM_ID_LENGTH)
      return yield* fail('A terminal stream was not valid.');
    if (guest || !(yield* definition.isOwner))
      return yield* closeStream(id, TERMINAL_STREAM_CLOSE.refused, TERMINAL_STREAM_MESSAGES.ownerOnly);
    if (open.size >= MAX_TERMINAL_STREAMS)
      return yield* closeStream(id, TERMINAL_STREAM_CLOSE.refused, TERMINAL_STREAM_MESSAGES.tooMany);
    const session = yield* selectSession(terminalId);
    if (!session) return yield* closeStream(id, TERMINAL_STREAM_CLOSE.gone, TERMINAL_STREAM_MESSAGES.closed);
    const stream: TerminalStream = {
      terminalId,
      pending: 0,
      viewer: {
        send: (data) => sendTerminal(id, stream, data),
        buffered: () => stream.pending + (definition.buffered?.() ?? 0),
        end: () =>
          run(
            Effect.gen(function* () {
              if (!(yield* removeStream(id))) return;
              yield* closeStream(id, TERMINAL_STREAM_CLOSE.gone, TERMINAL_STREAM_MESSAGES.closed);
            })
          ),
      },
    };
    yield* Ref.update(streams, (current) => new Map(current).set(id, stream));
    session.attach(stream.viewer);
  });

  const withTerminal = Effect.fn('RemoteChannel.withTerminal')(function* (
    id: string,
    apply: (session: TerminalSession) => void
  ) {
    const stream = (yield* Ref.get(streams)).get(id);
    const session = stream ? yield* selectSession(stream.terminalId) : null;
    if (session) apply(session);
  });

  const detachTerminal = Effect.fn('RemoteChannel.detachTerminal')(function* (id: string) {
    const stream = yield* removeStream(id);
    if (stream) (yield* selectSession(stream.terminalId))?.detach(stream.viewer);
  });

  const startRequest = Effect.fn('RemoteChannel.startRequest')(function* (
    message: Extract<ChannelMessage, { t: 'request' }>,
    guest: GuestActor | null
  ) {
    const open = yield* Ref.get(requests);
    if (open.has(message.id) || !isSafePath(message.path)) return yield* fail('A request was not valid.');
    if (open.size >= MAX_OPEN_REQUESTS) {
      yield* Effect.forkDetach(respondStatus(message.id, 429));
      return;
    }
    yield* Ref.update(requests, (current) =>
      new Map(current).set(message.id, {
        method: message.method,
        path: message.path,
        headers: listForwardedHeaders(message.headers),
        chunks: [],
        size: 0,
        controller: new AbortController(),
        sent: false,
        guest,
      })
    );
  });

  const appendBody = Effect.fn('RemoteChannel.appendBody')(function* (id: string, chunk: string) {
    const request = (yield* Ref.get(requests)).get(id);
    const bytes = parseBodyChunk(chunk);
    if (!request || request.sent || !bytes) return;
    const size = request.size + bytes.length;
    if (size > definition.maxBodyBytes) {
      yield* removeRequest(id);
      yield* Effect.forkDetach(respondStatus(id, 413));
      return;
    }
    yield* updateRequest(id, (open) => ({ ...open, size, chunks: [...open.chunks, bytes] }));
  });

  const streamResponse = Effect.fn('RemoteChannel.streamResponse')(function* (
    id: string,
    signal: AbortSignal,
    response: Response
  ) {
    yield* send({ t: 'response', id, status: response.status, headers: [...response.headers.entries()] });
    if (response.body) {
      const reader = response.body.getReader();
      signal.addEventListener('abort', () => void reader.cancel(), { once: true });
      for (;;) {
        const { done, value } = yield* Effect.tryPromise({ try: () => reader.read(), catch: broken });
        if (done || signal.aborted || !(yield* isOpen)) break;
        for (let offset = 0; offset < value.length; offset += CHANNEL_BODY_CHUNK_BYTES) {
          const chunk = serializeBase64Url(value.slice(offset, offset + CHANNEL_BODY_CHUNK_BYTES) as Bytes);
          yield* send({ t: 'body', id, chunk });
        }
      }
    }
    if (!signal.aborted) yield* send({ t: 'end', id });
  });

  const finishRequest = Effect.fn('RemoteChannel.finishRequest')(function* (id: string) {
    const open = (yield* Ref.get(requests)).get(id);
    if (!open || open.sent) return;
    yield* updateRequest(id, (request) => ({ ...request, sent: true }));
    const { signal } = open.controller;
    const hasBody = open.method !== 'GET' && open.method !== 'HEAD';
    yield* Effect.gen(function* () {
      const request = yield* Effect.try({
        try: () =>
          new Request(`${CHANNEL_REQUEST_ORIGIN}${open.path}`, {
            method: open.method,
            headers: [
              ...open.headers,
              ...(hasBody ? [['content-length', String(open.size)] as [string, string]] : []),
            ],
            ...(hasBody ? { body: concatBytes(...open.chunks) } : {}),
            signal,
          }),
        catch: broken,
      });
      const response = yield* definition.respond(request, open.guest);
      yield* streamResponse(id, signal, response);
    }).pipe(
      Effect.catchCause((cause) =>
        signal.aborted || Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : Effect.logWarning('[Remote] A remote request failed').pipe(
              Effect.annotateLogs({ path: open.path, error: describeError(Cause.squash(cause)) }),
              Effect.andThen(respondStatus(id, 500))
            )
      ),
      Effect.ensuring(removeRequest(id))
    );
  });

  const handle = Effect.fn('RemoteChannel.handle')(function* (message: ChannelMessage) {
    const current = yield* Ref.get(state);
    if (current.kind !== 'open') return;
    switch (message.t) {
      case 'ready': {
        if (current.socket) return;
        const socket = createSocket(current.guest, yield* definition.isOwner);
        yield* Ref.update(state, (latest) => (latest.kind === 'open' ? { ...latest, socket } : latest));
        return yield* definition.openSocket(socket);
      }
      case 'socket':
        if (current.socket) yield* definition.receiveSocket(current.socket, message.data);
        return;
      case 'request':
        return yield* startRequest(message, current.guest);
      case 'body':
        return yield* appendBody(message.id, message.chunk);
      case 'end':
        yield* Effect.forkDetach(finishRequest(message.id));
        return;
      case 'abort':
        (yield* Ref.get(requests)).get(message.id)?.controller.abort();
        return yield* removeRequest(message.id);
      case 'response':
        return yield* fail('The browser cannot send a response.');
      case 'terminal-open':
        return yield* openTerminal(message.id, message.terminal, current.guest);
      case 'terminal-text':
        return yield* withTerminal(message.id, (session) => applyTerminalText(session, message.data));
      case 'terminal-bytes': {
        const bytes = parseBase64Url(message.chunk);
        if (bytes) yield* withTerminal(message.id, (session) => session.input(bytes));
        return;
      }
      case 'terminal-close':
        return yield* detachTerminal(message.id);
    }
  });

  const handleRaw = Effect.fn('RemoteChannel.handleRaw')(function* (raw: ChannelRaw) {
    const current = yield* Ref.get(state);
    if (current.kind === 'closed') return;
    if (current.kind === 'hello') {
      const hello = typeof raw === 'string' ? parseClientHello(raw) : null;
      if (!hello) return yield* fail('The channel expects a hello first.');
      return yield* handshake(hello);
    }
    const frame = toBytes(raw);
    if (!frame) return yield* fail('A sealed channel only carries sealed frames.');
    const plain = yield* current.open(frame).pipe(Effect.mapError(broken));
    const message = parseChannelMessage(decodeText(plain));
    if (!message) return yield* fail('A sealed frame held no channel message.');
    yield* handle(message);
  });

  const receive = (raw: ChannelRaw) =>
    Semaphore.withPermit(
      queue,
      handleRaw(raw).pipe(
        Effect.catchCause((cause) => fail('The channel broke.', describeError(Cause.squash(cause))))
      )
    );

  const channel: RemoteChannelHandle = { device, isOpen, receive, fail, drain, close };
  return channel;
});
