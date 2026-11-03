import type { ServiceDefinition, TerminalInfo } from '@shinsa/core';
import { Effect } from 'effect';
import { describeError } from '../log/redact.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { EffectContext } from '../runtime/engine.ts';
import {
  PreviewDispatchFailed,
  type PreviewEffects,
  type PreviewLinks,
  type PreviewPeer,
  type PreviewsHandle,
  type PreviewsOptions,
  type PreviewUpgrade,
  PreviewUnreachable,
} from './previews/schema.ts';
import { makePreviews } from './previews/service.ts';

export { resolveCloseCode, resolveForwardHeaders } from './previews/forwarding.ts';
export {
  PREVIEW_LINK_LOST,
  PREVIEW_NO_URL,
  PREVIEW_NOT_PAIRED,
  type PreviewAnswer,
  type PreviewEffects,
  type PreviewLinks,
  type PreviewPeer,
  type PreviewRelay,
  type PreviewsOptions,
  type PreviewUpgrade,
} from './previews/schema.ts';

export class Previews implements PreviewEffects, PreviewLinks {
  readonly #handle: PreviewsHandle;

  constructor(options: PreviewsOptions) {
    const { engine, remote, services } = options;
    const now = options.now ?? Date.now;
    const { random } = options;
    const send = options.fetch ?? fetch;
    this.#handle = edgeRuntime.runSync(
      makePreviews({
        origin: options.origin,
        now: Effect.sync(now),
        random: (bytes) =>
          Effect.sync(() => (random ? random(bytes) : crypto.getRandomValues(new Uint8Array(bytes)))),
        state: Effect.sync(() => engine.state),
        remote: Effect.sync(() => ({
          enabled: remote.isEnabled,
          credentials: remote.store.file.credentials,
          access: remote.store.file.access,
        })),
        snapshot: Effect.sync(() => services.snapshot()),
        dispatch: (command, id) =>
          Effect.tryPromise({
            try: () => engine.dispatch(command, id === undefined ? {} : { id }),
            catch: (error) => new PreviewDispatchFailed({ message: describeError(error) }),
          }),
        fetch: (target, init) =>
          Effect.tryPromise({
            try: () => send(target, init),
            catch: (error) => new PreviewUnreachable({ message: describeError(error) }),
          }),
      })
    );
    remote.subscribe(() => edgeRuntime.runSync(this.#handle.syncRemote));
    engine.subscribe(() => edgeRuntime.runSync(this.#handle.syncSockets));
  }

  subscribe(listener: () => void) {
    return edgeRuntime.runSync(this.#handle.subscribe(listener));
  }

  resolveRemoteUrl(info: TerminalInfo, service: ServiceDefinition) {
    return edgeRuntime.runSync(this.#handle.resolveRemoteUrl(info, service));
  }

  link(taskId: string, serviceId: string, context: EffectContext) {
    return edgeRuntime.runPromise(this.#handle.link(taskId, serviceId, context));
  }

  answer(request: Request, url: URL) {
    return edgeRuntime.runPromise(this.#handle.answer(request, url));
  }

  openSocket(peer: PreviewPeer, upgrade: PreviewUpgrade) {
    return edgeRuntime.runSync(this.#handle.openSocket(peer, upgrade));
  }
}
