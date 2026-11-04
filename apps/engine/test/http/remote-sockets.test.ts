import { describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import { Effect } from 'effect';
import { makeRemoteSockets, type RemoteSocketData } from '../../src/http/server/sockets.ts';
import type { ChannelPeer, RemoteChannelHandle } from '../../src/remote/channel/schema.ts';
import type { ChannelParts } from '../../src/remote/machine/schema.ts';

function createFakeChannel() {
  const calls: string[] = [];
  const channel = {
    receive: (raw: string) => Effect.sync(() => calls.push(`receive ${raw}`)),
    drain: Effect.sync(() => calls.push('drain')),
  } as unknown as RemoteChannelHandle;
  return { channel, calls };
}

describe('the remote sockets', () => {
  test('open a channel whose peer is the socket, and pass messages, drains and closes to it', () => {
    const { channel, calls } = createFakeChannel();
    const peers: ChannelPeer[] = [];
    const closed: RemoteChannelHandle[] = [];
    const parts: ChannelParts = {
      hub: { open: () => undefined, close: () => undefined, message: () => undefined },
      terminals: null,
      respond: () => Effect.succeed(new Response()),
    };
    const sockets = Effect.runSync(
      makeRemoteSockets(
        {
          openChannel: (peer, given, userId) =>
            Effect.sync(() => {
              peers.push(peer);
              expect([given, userId]).toEqual([parts, 'u-mona']);
              return channel;
            }),
          closeChannel: (each) => Effect.sync(() => void closed.push(each)),
        },
        parts
      )
    );
    const sent: unknown[] = [];
    const socket = {
      data: { kind: 'remote', channel: null, userId: 'u-mona' },
      send: (data: unknown) => sent.push(data),
      close: (code: number, reason: string) => sent.push([code, reason]),
      getBufferedAmount: () => 42,
    } as unknown as ServerWebSocket<RemoteSocketData>;
    sockets.drain(socket);
    sockets.message(socket, 'early');
    sockets.close(socket);
    sockets.open(socket);
    expect(socket.data.channel).toBe(channel);
    const [peer] = peers;
    peer?.send('hello');
    peer?.close(1008, 'bye');
    expect(sent).toEqual(['hello', [1008, 'bye']]);
    expect(peer?.buffered?.()).toBe(42);
    sockets.message(socket, 'frame');
    sockets.drain(socket);
    sockets.close(socket);
    expect(calls).toEqual(['receive frame', 'drain']);
    expect(closed).toEqual([channel]);
  });
});
