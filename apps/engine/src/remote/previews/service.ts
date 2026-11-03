import {
  isSameSecret,
  PREVIEW_ACCESS_HEADER,
  PREVIEW_GONE,
  PREVIEW_ID_BYTES,
  PREVIEW_KEY_BYTES,
  PREVIEW_KEY_HEADER,
  parsePreviewTunnelPath,
  parsePreviewUrl,
  resolvePrivatePreviewId,
  resolvePrivatePreviewUrl,
  resolveServiceUrl,
  type ServiceDefinition,
  selectServiceTerminal,
  serializeBase64Url,
  serializePreviewUrl,
  type TerminalInfo,
  verifyPreviewAccessToken,
} from '@shinsa/core';
import { Deferred, Effect, Redacted, Ref } from 'effect';
import { describeError } from '../../log/redact.ts';
import type { EffectContext } from '../../runtime/engine.ts';
import { createFinalFailure } from '../../runtime/failures/classify.ts';
import { EgressGate } from '../egress/service.ts';
import { NORMAL_CLOSE } from '../schema.ts';
import {
  isSocketUpgrade,
  listSocketProtocols,
  resolveForwardHeaders,
  resolveLocalOrigin,
  resolvePrivateRunKey,
  resolveCloseCode,
  respondPreviewPage,
} from './forwarding.ts';
import {
  type LiveSocket,
  PREVIEW_LINK_LOST,
  PREVIEW_NO_URL,
  PREVIEW_NOT_PAIRED,
  PREVIEW_SOCKET_HEADERS,
  PreviewAddressFailed,
  type PreviewAnswer,
  type PreviewPeer,
  type PreviewRelay,
  type PreviewRemote,
  type PreviewsDefinition,
  type PreviewShareTarget,
  type PreviewsHandle,
  type PreviewTarget,
  type PreviewUpgrade,
  type PrivateAddresses,
  type PrivateRun,
} from './schema.ts';

export const makePreviews = Effect.fn('Previews.make')(function* (definition: PreviewsDefinition) {
  const runSync = Effect.runSyncWith(yield* Effect.context<never>());
  const isSameKey = Redacted.makeEquivalence(isSameSecret);
  const listeners = yield* Ref.make<ReadonlySet<() => void>>(new Set());
  const sockets = yield* Ref.make<ReadonlySet<LiveSocket>>(new Set());
  const addresses = yield* Ref.make<PrivateAddresses>({
    connectKey: null,
    ids: new Map(),
    runs: new Map(),
    pending: new Map(),
  });
  const pairedAs = yield* Ref.make((yield* definition.remote).credentials?.instanceId ?? null);

  const removeSocket = (socket: LiveSocket) =>
    Ref.modify(sockets, (all): [boolean, ReadonlySet<LiveSocket>] => {
      if (!all.has(socket)) return [false, all];
      const rest = new Set(all);
      rest.delete(socket);
      return [true, rest];
    });

  const subscribe = Effect.fn('Previews.subscribe')(function* (listener: () => void) {
    yield* Ref.update(listeners, (all) => new Set(all).add(listener));
    return () =>
      runSync(
        Ref.update(listeners, (all) => {
          const rest = new Set(all);
          rest.delete(listener);
          return rest;
        })
      );
  });

  const publish = Effect.gen(function* () {
    for (const listener of yield* Ref.get(listeners)) yield* Effect.sync(listener);
  });

  const isAllowed = (remote: PreviewRemote, userId: string) => {
    const { access } = remote;
    if (!access) return false;
    return access.owner.id === userId || access.members.some((member) => member.user.id === userId);
  };

  const selectConnectKey = Effect.gen(function* () {
    const remote = yield* definition.remote;
    const key = remote.enabled ? (remote.credentials?.connectKey ?? null) : null;
    yield* Ref.update(addresses, (current) =>
      current.connectKey === key
        ? current
        : { connectKey: key, ids: new Map(), runs: new Map(), pending: new Map() }
    );
    return key;
  });

  const selectPrivateRun = Effect.fn('Previews.selectPrivateRun')(function* (previewId: string) {
    yield* selectConnectKey;
    return (yield* Ref.get(addresses)).runs.get(previewId) ?? null;
  });

  const resolveShare = Effect.fn('Previews.resolveShare')(function* (previewId: string) {
    const instanceId = (yield* definition.remote).credentials?.instanceId;
    if (!instanceId) return null;
    const now = yield* definition.now;
    for (const task of Object.values((yield* definition.state).tasks)) {
      for (const preview of task.previews ?? []) {
        if ((preview.endsAt ?? Number.POSITIVE_INFINITY) <= now) continue;
        const link = parsePreviewUrl(preview.url, definition.origin);
        if (link?.previewId === previewId && link.instanceId === instanceId) {
          const share: PreviewShareTarget = { taskId: task.id, serviceId: preview.serviceId, key: link.key };
          return share;
        }
      }
    }
    return null;
  });

  const isStillOpen = Effect.fn('Previews.isStillOpen')(function* (socket: LiveSocket) {
    if (socket.userId === null) return (yield* resolveShare(socket.previewId)) !== null;
    if ((yield* selectPrivateRun(socket.previewId)) === null) return false;
    return isAllowed(yield* definition.remote, socket.userId);
  });

  const syncSockets = Effect.gen(function* () {
    for (const socket of yield* Ref.get(sockets)) {
      if ((yield* definition.remote).enabled && (yield* isStillOpen(socket))) continue;
      yield* removeSocket(socket);
      yield* Effect.sync(() => {
        socket.peer.close(NORMAL_CLOSE, PREVIEW_GONE);
        socket.upstream.close();
      });
    }
  });

  const syncRemote = Effect.gen(function* () {
    yield* syncSockets;
    yield* publish;
    const instanceId = (yield* definition.remote).credentials?.instanceId ?? null;
    const before = yield* Ref.getAndSet(pairedAs, instanceId);
    if (before === null || before === instanceId) return;
    for (const task of Object.values((yield* definition.state).tasks)) {
      for (const preview of task.previews ?? []) {
        if (!preview.url || preview.failure) continue;
        const where = { taskId: task.id, serviceId: preview.serviceId };
        yield* Effect.forkDetach(
          definition
            .dispatch({ type: 'preview.fail', ...where, detail: PREVIEW_LINK_LOST })
            .pipe(
              Effect.catch((failure) =>
                Effect.logError('[Preview] Could not mark a link as lost').pipe(
                  Effect.annotateLogs({ ...where, error: failure.message })
                )
              )
            )
        );
      }
    }
  });

  const recordPrivateId = Effect.fn('Previews.recordPrivateId')(function* (
    connectKey: string,
    run: PrivateRun,
    previewId: string
  ) {
    const recorded = yield* Ref.modify(addresses, (current): [boolean, PrivateAddresses] => {
      if (current.connectKey !== connectKey) return [false, current];
      return [
        true,
        {
          ...current,
          ids: new Map(current.ids).set(resolvePrivateRunKey(run), previewId),
          runs: new Map(current.runs).set(previewId, run),
        },
      ];
    });
    if (recorded) yield* publish;
  });

  const forgetPending = (runKey: string, made: Deferred.Deferred<void>) =>
    Ref.update(addresses, (current) => {
      if (current.pending.get(runKey) !== made) return current;
      const pending = new Map(current.pending);
      pending.delete(runKey);
      return { ...current, pending };
    });

  const requestPrivateId = Effect.fn('Previews.requestPrivateId')(function* (run: PrivateRun) {
    const connectKey = yield* selectConnectKey;
    if (!connectKey) return;
    const runKey = resolvePrivateRunKey(run);
    const made = yield* Deferred.make<void>();
    const pending = yield* Ref.modify(
      addresses,
      (current): [Deferred.Deferred<void> | null, PrivateAddresses] => {
        const known = current.pending.get(runKey);
        if (known) return [known, current];
        return [null, { ...current, pending: new Map(current.pending).set(runKey, made) }];
      }
    );
    if (pending) return yield* Deferred.await(pending);
    yield* Effect.tryPromise({
      try: () => resolvePrivatePreviewId(connectKey, run),
      catch: (error) => new PreviewAddressFailed({ message: describeError(error) }),
    }).pipe(
      Effect.flatMap((previewId) => recordPrivateId(connectKey, run, previewId)),
      Effect.catch((failure) =>
        Effect.andThen(
          forgetPending(runKey, made),
          Effect.logWarning('[Preview] Could not make a private address').pipe(
            Effect.annotateLogs({ ...run, error: failure.message })
          )
        )
      ),
      Effect.ensuring(Deferred.succeed(made, undefined))
    );
  });

  const resolveRemoteUrl = Effect.fn('Previews.resolveRemoteUrl')(function* (
    info: TerminalInfo,
    service: ServiceDefinition
  ) {
    const instanceId = (yield* definition.remote).credentials?.instanceId;
    const local = resolveServiceUrl(service, info);
    if (!(instanceId && local && info.status === 'running' && (yield* selectConnectKey))) return null;
    const run = { serviceId: service.id, taskId: info.taskId };
    const previewId = (yield* Ref.get(addresses)).ids.get(resolvePrivateRunKey(run));
    if (!previewId) {
      yield* Effect.forkDetach(requestPrivateId(run));
      return null;
    }
    return resolvePrivatePreviewUrl({ instanceId, previewId }, local, definition.origin);
  });

  const findPrivateRun = Effect.fn('Previews.findPrivateRun')(function* (previewId: string) {
    const known = yield* selectPrivateRun(previewId);
    if (known) return known;
    const runs = (yield* definition.snapshot).terminals.flatMap((terminal) =>
      terminal.serviceId ? [{ serviceId: terminal.serviceId, taskId: terminal.taskId }] : []
    );
    yield* Effect.forEach(runs, requestPrivateId, { concurrency: 'unbounded', discard: true });
    return yield* selectPrivateRun(previewId);
  });

  const resolvePrivate = Effect.fn('Previews.resolvePrivate')(function* (
    request: Request,
    previewId: string
  ) {
    const token = request.headers.get(PREVIEW_ACCESS_HEADER);
    const instanceId = (yield* definition.remote).credentials?.instanceId;
    const connectKey = yield* selectConnectKey;
    if (!(token && instanceId && connectKey)) return null;
    const now = yield* definition.now;
    const claim = yield* Effect.promise(() =>
      verifyPreviewAccessToken(connectKey, token, { instanceId, previewId }, now)
    );
    if (!(claim && isAllowed(yield* definition.remote, claim.userId))) return null;
    const run = yield* findPrivateRun(previewId);
    if (!run) return null;
    const target: PreviewTarget = { ...run, userId: claim.userId };
    return target;
  });

  const resolveTarget = Effect.fn('Previews.resolveTarget')(function* (request: Request, previewId: string) {
    const share = yield* resolveShare(previewId);
    if (!share) return yield* resolvePrivate(request, previewId);
    const given = request.headers.get(PREVIEW_KEY_HEADER);
    if (!(given && isSameKey(Redacted.make(given), Redacted.make(share.key)))) return null;
    const target: PreviewTarget = { serviceId: share.serviceId, taskId: share.taskId, userId: null };
    return target;
  });

  const link = Effect.fn('Previews.link')(function* (
    taskId: string,
    serviceId: string,
    context: EffectContext
  ) {
    const state = yield* definition.state;
    const preview = state.tasks[taskId]?.previews?.find((each) => each.serviceId === serviceId);
    if (!preview) return;
    const { credentials } = yield* definition.remote;
    if (!credentials) return yield* createFinalFailure(PREVIEW_NOT_PAIRED);
    const service = (yield* definition.snapshot).services.find((each) => each.id === serviceId);
    if (!service?.previewUrl) return yield* createFinalFailure(PREVIEW_NO_URL);
    const current = parsePreviewUrl(preview.url, definition.origin);
    const url =
      current?.instanceId === credentials.instanceId
        ? null
        : serializePreviewUrl(
            {
              instanceId: credentials.instanceId,
              previewId: serializeBase64Url(yield* definition.random(PREVIEW_ID_BYTES)),
              key: serializeBase64Url(yield* definition.random(PREVIEW_KEY_BYTES)),
            },
            definition.origin
          );
    yield* definition.dispatch(
      { type: 'preview.record', taskId, serviceId, url },
      `${context.key}:preview.record`
    );
  });

  const forward = Effect.fn('Previews.forward')(function* (
    request: Request,
    target: string,
    headers: Record<string, string>,
    port: number
  ) {
    const withoutBody = request.method === 'GET' || request.method === 'HEAD';
    return yield* definition
      .fetch(target, {
        method: request.method,
        headers,
        body: withoutBody ? null : request.body,
        redirect: 'manual',
        decompress: false,
      })
      .pipe(
        Effect.map(
          (response) =>
            new Response(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers: EgressGate.resolvePreviewHeaders(response.headers, [
                resolveLocalOrigin(port),
                `http://127.0.0.1:${port}`,
              ]),
            })
        ),
        Effect.catch((failure) =>
          Effect.logWarning('[Preview] Could not reach the service').pipe(
            Effect.annotateLogs({ target, error: failure.message }),
            Effect.as(respondPreviewPage('stopped', 502))
          )
        )
      );
  });

  const answer = Effect.fn('Previews.answer')(function* (request: Request, url: URL) {
    const parsed = parsePreviewTunnelPath(url.pathname);
    const target = parsed ? yield* resolveTarget(request, parsed.previewId) : null;
    if (!(parsed && target))
      return { kind: 'response', response: respondPreviewPage('gone', 404) } satisfies PreviewAnswer;
    const run = selectServiceTerminal(yield* definition.snapshot, target.serviceId, target.taskId);
    if (!(run?.status === 'running' && run.port))
      return { kind: 'response', response: respondPreviewPage('stopped', 503) } satisfies PreviewAnswer;
    const path = `${parsed.path}${url.search}`;
    const headers = resolveForwardHeaders(request.headers, run.port);
    if (isSocketUpgrade(request)) {
      for (const name of PREVIEW_SOCKET_HEADERS) delete headers[name];
      const upgrade: PreviewUpgrade = {
        previewId: parsed.previewId,
        userId: target.userId,
        target: `ws://localhost:${run.port}${path}`,
        headers,
        protocols: listSocketProtocols(request),
      };
      return { kind: 'upgrade', upgrade } satisfies PreviewAnswer;
    }
    const response = yield* forward(request, `${resolveLocalOrigin(run.port)}${path}`, headers, run.port);
    return { kind: 'response', response } satisfies PreviewAnswer;
  });

  const openSocket = Effect.fn('Previews.openSocket')(function* (peer: PreviewPeer, upgrade: PreviewUpgrade) {
    const upstream = yield* Effect.sync(
      () => new WebSocket(upgrade.target, { headers: upgrade.headers, protocols: upgrade.protocols })
    );
    const live: LiveSocket = { previewId: upgrade.previewId, userId: upgrade.userId, peer, upstream };
    const waiting: (string | Uint8Array)[] = [];
    yield* Ref.update(sockets, (all) => new Set(all).add(live));
    yield* Effect.sync(() => {
      upstream.binaryType = 'arraybuffer';
      upstream.onopen = () => {
        for (const data of waiting.splice(0)) upstream.send(data);
      };
      upstream.onmessage = (event) => {
        const { data } = event as MessageEvent<string | ArrayBuffer>;
        peer.send(typeof data === 'string' ? data : new Uint8Array(data));
      };
      upstream.onclose = (event) => {
        if (!runSync(removeSocket(live))) return;
        peer.close(resolveCloseCode(event.code), event.reason);
      };
    });
    const relay: PreviewRelay = {
      send: (data) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
        else if (upstream.readyState === WebSocket.CONNECTING) waiting.push(data);
      },
      close: () => {
        runSync(removeSocket(live));
        upstream.close();
      },
    };
    return relay;
  });

  const handle: PreviewsHandle = {
    subscribe,
    syncRemote,
    syncSockets,
    resolveRemoteUrl,
    link,
    answer,
    openSocket,
  };
  return handle;
});
