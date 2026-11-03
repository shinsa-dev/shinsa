import { Effect } from 'effect';
import { describeError } from '../log/redact.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import {
  ChannelBroken,
  type ChannelHost,
  type ChannelPeer,
  type ChannelRaw,
  type RemoteChannelHandle,
} from './channel/schema.ts';
import { makeRemoteChannel } from './channel/service.ts';

export type { AccessAnswer, ChannelHost, ChannelPeer, RemoteChannelHandle } from './channel/schema.ts';

function toBroken(error: unknown) {
  return new ChannelBroken({ message: describeError(error) });
}

export class RemoteChannel {
  readonly handle: RemoteChannelHandle;

  constructor(peer: ChannelPeer, host: ChannelHost) {
    this.handle = edgeRuntime.runSync(
      makeRemoteChannel({
        send: (data) => Effect.sync(() => peer.send(data)),
        closePeer: (code, reason) => Effect.sync(() => peer.close(code, reason)),
        machineKey: Effect.tryPromise({ try: () => host.resolveMachineKey(), catch: toBroken }),
        isEnrolled: (device) => Effect.sync(() => host.isEnrolled(device)),
        resolveGuest: (device) => Effect.sync(() => host.resolveGuest(device)),
        requestAccess: (proof, keys, name) =>
          Effect.tryPromise({ try: () => host.requestAccess(proof, keys, name), catch: toBroken }),
        resumeAccess: (device) => Effect.sync(() => host.resumeAccess(device)),
        recordSeen: (device) => Effect.sync(() => host.recordSeen(device)),
        openSocket: (socket) => Effect.sync(() => host.hub.open(socket)),
        closeSocket: (socket) => Effect.sync(() => host.hub.close(socket)),
        receiveSocket: (socket, raw) => Effect.sync(() => host.hub.message(socket, raw)),
        respond: (request, guest) =>
          Effect.tryPromise({ try: () => host.respond(request, guest), catch: toBroken }),
        maxBodyBytes: host.maxBodyBytes,
      })
    );
  }

  get device() {
    return edgeRuntime.runSync(this.handle.device);
  }

  get isOpen() {
    return edgeRuntime.runSync(this.handle.isOpen);
  }

  receive(raw: ChannelRaw) {
    return edgeRuntime.runPromise(this.handle.receive(raw));
  }

  fail(reason: string, error?: unknown) {
    edgeRuntime.runSync(this.handle.fail(reason, error ? describeError(error) : undefined));
  }

  close() {
    edgeRuntime.runSync(this.handle.close);
  }
}
