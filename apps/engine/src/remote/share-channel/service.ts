import {
  type Bytes,
  CHANNEL_BODY_CHUNK_BYTES,
  createFrameSealer,
  encodeText,
  type ShareMessage,
  type ShareWelcome,
  serializeBase64Url,
  serializeShareMessage,
} from '@shinsa/core';
import { Effect, Ref, Semaphore } from 'effect';
import { describeError } from '../../log/redact.ts';
import { EgressGate } from '../egress/service.ts';
import { NORMAL_CLOSE, POLICY_VIOLATION } from '../schema.ts';
import {
  type ChannelInput,
  type ChannelState,
  type LiveFile,
  type PushState,
  ShareChannelBroke,
  type ShareChannelDefinition,
  type ShareChannelHandle,
} from './schema.ts';

export const makeShareChannel = Effect.fn('ShareChannel.make')(function* <Subject>(
  definition: ShareChannelDefinition<Subject>
) {
  const { name, peer } = definition;
  const state = yield* Ref.make<ChannelState<Subject>>({ kind: 'hello' });
  const pushState = yield* Ref.make<PushState>({ dirty: false, running: false });
  const sent = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
  const lastView = yield* Ref.make<string | null>(null);
  const receiving = yield* Semaphore.make(1);
  const broken = `The ${name} broke.`;

  const broke = (error: unknown) => new ShareChannelBroke({ message: describeError(error) });

  const sendPeer = (data: string | Bytes) =>
    Effect.try({
      try: () => {
        peer.send(data);
      },
      catch: broke,
    });

  const closePeer = (code: number, reason: string) =>
    Effect.try({ try: () => peer.close(code, reason), catch: broke });

  const subject = Effect.map(Ref.get(state), (current) => (current.kind === 'open' ? current.subject : null));

  const close = Ref.set(state, { kind: 'closed' });

  const fail = Effect.fn('ShareChannel.fail')(function* (reason: string, detail?: string) {
    if ((yield* Ref.get(state)).kind === 'closed') return;
    if (detail !== undefined)
      yield* Effect.logWarning('[Share] Closing a live view').pipe(
        Effect.annotateLogs({ reason, error: detail })
      );
    yield* Effect.ignore(closePeer(POLICY_VIOLATION, reason));
    yield* close;
  });

  const send = Effect.fn('ShareChannel.send')(function* (message: ShareMessage) {
    const current = yield* Ref.get(state);
    if (current.kind !== 'open') return;
    const frame = yield* Effect.tryPromise({
      try: () => current.seal(encodeText(serializeShareMessage(message))),
      catch: broke,
    });
    if ((yield* Ref.get(state)).kind === 'open') yield* sendPeer(frame);
  });

  const sendFile = Effect.fn('ShareChannel.sendFile')(function* (file: LiveFile) {
    yield* send({ t: 'file', id: file.id, version: file.version, type: file.type });
    const bytes = yield* Effect.tryPromise({ try: () => file.read(), catch: broke });
    for (let offset = 0; offset < bytes.length; offset += CHANNEL_BODY_CHUNK_BYTES) {
      const chunk = serializeBase64Url(bytes.slice(offset, offset + CHANNEL_BODY_CHUNK_BYTES));
      yield* send({ t: 'body', id: file.id, chunk });
    }
    yield* send({ t: 'end', id: file.id });
  });

  const pushOnce = Effect.fn('ShareChannel.pushOnce')(function* (current: Subject) {
    const live = yield* definition.resolveLive(current);
    const key = JSON.stringify({ ...live.view, updatedAt: 0, snapshot: null });
    if (key !== (yield* Ref.get(lastView))) {
      yield* Ref.set(lastView, key);
      const data = yield* Effect.try({ try: () => EgressGate.serializeView(live.view), catch: broke });
      yield* send({ t: 'view', data });
    }
    for (const file of live.files) {
      if ((yield* Ref.get(sent)).get(file.id) === file.version) continue;
      yield* Ref.update(sent, (versions) => new Map(versions).set(file.id, file.version));
      yield* sendFile(file);
    }
  });

  const drainOnce = Effect.gen(function* () {
    const current = yield* Ref.get(state);
    if (current.kind !== 'open') return false;
    const dirty = yield* Ref.modify(pushState, (pushing) => [pushing.dirty, { ...pushing, dirty: false }]);
    if (!dirty) return false;
    yield* pushOnce(current.subject);
    return true;
  });

  const push = Effect.gen(function* () {
    const started = yield* Ref.modify(pushState, (pushing) => [
      !pushing.running,
      { dirty: true, running: true },
    ]);
    if (!started) return;
    yield* drainOnce.pipe(
      Effect.repeat({ while: (more) => more }),
      Effect.catch((failure) => fail(broken, failure.message)),
      Effect.ensuring(Ref.update(pushState, (pushing) => ({ ...pushing, running: false })))
    );
  });

  const refuse = Effect.fn('ShareChannel.refuse')(function* (reason: string) {
    yield* sendPeer(JSON.stringify({ type: 'refused', reason } satisfies ShareWelcome));
    yield* fail(reason);
  });

  const receiveOnce = Effect.fn('ShareChannel.receiveOnce')(function* (raw: ChannelInput) {
    const current = yield* Ref.get(state);
    if (current.kind === 'closed') return;
    if (current.kind === 'open') return yield* fail(`A ${name} only listens.`);
    const answer = typeof raw === 'string' ? yield* definition.authorize(raw) : null;
    if (!answer) return yield* fail(`The ${name} expects a hello first.`);
    if ('refused' in answer) return yield* refuse(answer.refused);
    if ((yield* Ref.get(state)).kind !== 'hello') return;
    yield* Ref.set(state, { kind: 'open', subject: answer.subject, seal: createFrameSealer(answer.session) });
    yield* sendPeer(JSON.stringify(answer.welcome));
    yield* push;
  });

  const receive = (raw: ChannelInput) =>
    receiveOnce(raw).pipe(
      Effect.catch((failure) => fail(broken, failure.message)),
      Semaphore.withPermit(receiving)
    );

  const end = Effect.fn('ShareChannel.end')(function* (reason: string) {
    if ((yield* Ref.get(state)).kind === 'closed') return;
    yield* send({ t: 'closed', reason });
    yield* closePeer(NORMAL_CLOSE, reason);
    yield* close;
  });

  const handle: ShareChannelHandle<Subject> = { subject, receive, push, end, fail, close };
  return handle;
});
