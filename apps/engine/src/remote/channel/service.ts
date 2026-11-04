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
  parseBodyChunk,
  parseChannelMessage,
  parseClientHello,
  REMOTE_KEY_ALGORITHM,
  resolveCompression,
  type ServerHello,
  serializeBase64Url,
  serializeChannelMessage,
  serializePublicKey,
} from '@shinsa/core';
import { Cause, Effect, Ref, Semaphore } from 'effect';
import type { HubSocket } from '../../http/socket.ts';
import { describeError } from '../../log/redact.ts';
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
  type OpenRequest,
  type ProofKeys,
  type RemoteChannelHandle,
} from './schema.ts';

export const makeRemoteChannel = Effect.fn('RemoteChannel.make')(function* (definition: ChannelDefinition) {
  const run = Effect.runForkWith(yield* Effect.context<never>());
  const state = yield* Ref.make<ChannelState>({ kind: 'hello' });
  const requests = yield* Ref.make<ReadonlyMap<string, OpenRequest>>(new Map());
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

  const close = Effect.gen(function* () {
    const previous = yield* Ref.getAndSet(state, { kind: 'closed' });
    if (previous.kind === 'open' && previous.socket) yield* definition.closeSocket(previous.socket);
    const open = yield* Ref.getAndSet(requests, new Map());
    for (const request of open.values()) request.controller.abort();
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

  const createSocket = (guest: GuestActor | null): HubSocket => ({
    data: { kind: 'hub', transcripts: new Map(), surface: null, origin: 'remote', guest },
    send: (payload: string) => run(send({ t: 'socket', data: payload })),
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
      Effect.catch((failure) =>
        signal.aborted
          ? Effect.void
          : Effect.logWarning('[Remote] A remote request failed').pipe(
              Effect.annotateLogs({ path: open.path, error: failure.message }),
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
        const socket = createSocket(current.guest);
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

  const channel: RemoteChannelHandle = { device, isOpen, receive, fail, close };
  return channel;
});
