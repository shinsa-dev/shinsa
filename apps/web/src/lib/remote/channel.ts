import { Effect, Layer } from 'effect';
import { Socket } from 'effect/socket';
import { runApp } from '@/lib/runtime/app.ts';
import { provideTransport } from '@/lib/runtime/socket/transport.ts';
import type { ChannelLink, ChannelOptions, RemoteChannel } from './remote-channel/schema.ts';
import { RemoteChannels } from './remote-channel/service.ts';

function adoptChannel(link: ChannelLink): RemoteChannel {
  return {
    get isOpen() {
      return link.isOpen();
    },
    get isClosed() {
      return link.isClosed();
    },
    request: (input) => runApp(link.request(input)),
    sendSocket: (data) => runApp(link.sendSocket(data)),
    subscribeSocket: link.subscribeSocket,
    sendTerminal: (message) => runApp(link.sendTerminal(message)),
    subscribeTerminal: link.subscribeTerminal,
    subscribeClose: link.subscribeClose,
    close: link.close,
  };
}

export function openRemoteChannel(options: ChannelOptions): Promise<RemoteChannel> {
  const openSocket = options.openSocket;
  const transport = openSocket
    ? Layer.succeed(Socket.WebSocketConstructor, (url) => openSocket(url))
    : undefined;
  return runApp(
    Effect.gen(function* () {
      const channels = yield* RemoteChannels;
      return yield* channels.open(options);
    }).pipe(Effect.map(adoptChannel), Effect.provide(RemoteChannels.layer), provideTransport(transport))
  );
}
