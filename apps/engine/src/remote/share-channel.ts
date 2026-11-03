import { Effect } from 'effect';
import { describeError } from '../log/redact.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { ChannelPeer } from './channel.ts';
import { createEphemeralKeys } from './share-channel/ephemeral.ts';
import {
  type ChannelInput,
  ShareChannelBroke,
  type ShareChannelHandle,
  type ShareChannelHost,
} from './share-channel/schema.ts';
import { makeShareChannel } from './share-channel/service.ts';

export type { HelloAnswer, LiveShare, ShareChannelHost } from './share-channel/schema.ts';
export { SHARE_GONE_REASON } from './share-channel/schema.ts';

export function createChannelEphemeral() {
  return edgeRuntime.runPromise(createEphemeralKeys);
}

function broke(error: unknown) {
  return new ShareChannelBroke({ message: describeError(error) });
}

export class ShareChannel<Subject = string> {
  readonly handle: ShareChannelHandle<Subject>;

  constructor(peer: ChannelPeer, host: ShareChannelHost<Subject>);
  constructor(handle: ShareChannelHandle<Subject>);
  constructor(...source: [ChannelPeer, ShareChannelHost<Subject>] | [ShareChannelHandle<Subject>]) {
    if (source.length === 1) {
      this.handle = source[0];
      return;
    }
    const [peer, host] = source;
    this.handle = edgeRuntime.runSync(
      makeShareChannel<Subject>({
        name: host.name,
        peer,
        authorize: (hello) => Effect.tryPromise({ try: () => host.authorize(hello), catch: broke }),
        resolveLive: (subject) => Effect.tryPromise({ try: () => host.resolveLive(subject), catch: broke }),
      })
    );
  }

  get subject() {
    return edgeRuntime.runSync(this.handle.subject);
  }

  receive(raw: ChannelInput) {
    return edgeRuntime.runPromise(this.handle.receive(raw));
  }

  push() {
    return edgeRuntime.runPromise(this.handle.push);
  }

  end(reason: string) {
    return edgeRuntime.runPromise(this.handle.end(reason));
  }

  fail(reason: string, error?: unknown) {
    edgeRuntime.runSync(this.handle.fail(reason, error ? describeError(error) : undefined));
  }

  close() {
    edgeRuntime.runSync(this.handle.close);
  }
}
