import type { ChannelHeaders } from '@shinsa/core';
import { Deferred, Effect, Predicate, Schema } from 'effect';
import { forkApp, runApp } from '@/lib/runtime/app.ts';
import { CloudAnswerInvalid, CloudRefused, CloudUnreachable } from '@/lib/runtime/remote/schema.ts';
import { openRemoteChannel } from './channel.ts';
import { type DashboardClient, isMachineGone } from './dashboard.ts';
import {
  CHANNEL_BROKE,
  CHANNEL_REPLACED,
  ChannelError,
  type ChannelOptions,
  type RemoteChannel,
  RequestAborted,
} from './remote-channel/schema.ts';
import type { EnrolledDevice } from './schema.ts';

const CONNECTING = 0;

const OPEN = 1;

const CLOSED = 3;

export class ChannelSocket extends EventTarget {
  readyState: number = CONNECTING;
  binaryType: BinaryType = 'blob';
  #channel: RemoteChannel | null = null;
  readonly #release: (() => void)[] = [];

  attach(channel: RemoteChannel) {
    if (this.readyState === CLOSED) {
      channel.close();
      return;
    }
    this.#channel = channel;
    this.#release.push(
      channel.subscribeSocket((data) => this.dispatchEvent(new MessageEvent('message', { data }))),
      channel.subscribeClose((error) => this.#finish(error.message))
    );
    this.readyState = OPEN;
    this.dispatchEvent(new Event('open'));
  }

  send(data: string) {
    if (this.readyState !== OPEN || !this.#channel) return;
    void this.#channel.sendSocket(data);
  }

  close() {
    const channel = this.#channel;
    this.#finish('Closed on this page.');
    channel?.close();
  }

  fail(reason: string) {
    this.#finish(reason);
  }

  #finish(reason: string) {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    for (const release of this.#release.splice(0)) release();
    this.#channel = null;
    this.dispatchEvent(new CloseEvent('close', { code: 1000, reason }));
  }
}

export interface RemoteLinkOptions {
  instanceId: string;
  device: EnrolledDevice;
  dashboard: Pick<DashboardClient, 'requestConnect'>;
  openChannel?: (options: ChannelOptions) => Promise<RemoteChannel>;
  onRefused?: (error: ChannelError) => void;
  onRemoved?: () => void;
}

type LinkFailure = ChannelError | RequestAborted | CloudUnreachable | CloudRefused | CloudAnswerInvalid;

const isLinkFailure = Schema.is(
  Schema.Union([ChannelError, RequestAborted, CloudUnreachable, CloudRefused, CloudAnswerInvalid])
);

function resolveLinkFailure(error: unknown): LinkFailure {
  if (isLinkFailure(error)) return error;
  return new ChannelError({ message: Predicate.isError(error) ? error.message : CHANNEL_BROKE });
}

function enterLink<A>(step: () => Promise<A>) {
  return Effect.tryPromise({ try: step, catch: resolveLinkFailure });
}

function listRequestHeaders(headers: Headers): ChannelHeaders {
  return [...headers.entries()];
}

export function createRemoteLink(options: RemoteLinkOptions) {
  const open = options.openChannel ?? openRemoteChannel;
  let connecting: Deferred.Deferred<RemoteChannel, LinkFailure> | null = null;
  let current: RemoteChannel | null = null;
  let socketTaken = false;

  const forget = () => {
    connecting = null;
    current = null;
    socketTaken = false;
  };

  const close = () => {
    const channel = current;
    forget();
    channel?.close();
  };

  const recordFailure = (attempt: Deferred.Deferred<RemoteChannel, LinkFailure>, error: LinkFailure) => {
    if (connecting === attempt) forget();
    if (error._tag === 'ChannelError' && error.refused) options.onRefused?.(error);
    if (isMachineGone(error)) options.onRemoved?.();
  };

  const connect = Effect.fn('RemoteLink.connect')(function* (
    attempt: Deferred.Deferred<RemoteChannel, LinkFailure>
  ) {
    const answer = yield* enterLink(() => options.dashboard.requestConnect(options.instanceId));
    const channel = yield* enterLink(() =>
      open({
        url: answer.url,
        machineKey: options.device.machineKey,
        device: options.device.keys,
        enrollSecret: null,
      })
    );
    if (connecting !== attempt) {
      channel.close();
      return yield* new ChannelError({ message: CHANNEL_REPLACED });
    }
    current = channel;
    channel.subscribeClose(() => {
      if (current === channel) forget();
    });
    return channel;
  });

  const resolveAttempt = (fresh: boolean) => {
    if (fresh) close();
    if (connecting) return connecting;
    const attempt = Deferred.makeUnsafe<RemoteChannel, LinkFailure>();
    connecting = attempt;
    forkApp(
      connect(attempt).pipe(
        Effect.tapError((error) => Effect.sync(() => recordFailure(attempt, error))),
        Deferred.into(attempt)
      )
    );
    return attempt;
  };

  const request = Effect.fn('RemoteLink.request')(function* (input: Request) {
    const url = new URL(input.url);
    const hasBody = input.method !== 'GET' && input.method !== 'HEAD';
    const body = hasBody ? new Uint8Array(yield* enterLink(() => input.arrayBuffer())) : null;
    const channel = yield* Deferred.await(resolveAttempt(false));
    return yield* enterLink(() =>
      channel.request({
        method: input.method,
        path: `${url.pathname}${url.search}`,
        headers: listRequestHeaders(input.headers),
        body,
        signal: input.signal,
      })
    );
  });

  return {
    resolveChannel: (fresh = false) => runApp(Deferred.await(resolveAttempt(fresh))),
    openSocket: (): WebSocket => {
      const socket = new ChannelSocket();
      const attempt = resolveAttempt(socketTaken);
      socketTaken = true;
      forkApp(
        Deferred.await(attempt).pipe(
          Effect.match({
            onSuccess: (channel) => socket.attach(channel),
            onFailure: (error) => socket.fail(error.message),
          })
        )
      );
      return socket as unknown as WebSocket;
    },
    fetch: (input: Request) => runApp(request(input)),
    close,
  };
}
