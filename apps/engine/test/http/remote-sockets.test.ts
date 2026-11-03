import { describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import { createRemoteSockets, type RemoteSocketData } from '../../src/http/server.ts';
import type { ChannelPeer, RemoteChannel } from '../../src/remote/index.ts';

function createFakeChannel() {
  const calls: string[] = [];
  const channel = {
    receive: (raw: string) => {
      calls.push(`receive ${raw}`);
      return Promise.resolve();
    },
    drain: () => calls.push('drain'),
  } as unknown as RemoteChannel;
  return { channel, calls };
}

describe('the remote sockets', () => {
  test('open a channel whose peer is the socket, and pass messages, drains and closes to it', () => {
    const { channel, calls } = createFakeChannel();
    const peers: ChannelPeer[] = [];
    const closed: RemoteChannel[] = [];
    const parts = {
      hub: { open: () => undefined, close: () => undefined, message: () => undefined },
      terminals: null,
      respond: () => Promise.resolve(new Response()),
    };
    const sockets = createRemoteSockets(
      {
        openChannel: (peer, given, userId) => {
          peers.push(peer);
          expect([given, userId]).toEqual([parts, 'u-mona']);
          return channel;
        },
        closeChannel: (each) => closed.push(each),
      },
      parts
    );
    const sent: unknown[] = [];
    const socket = {
      data: { kind: 'remote', channel: null, userId: 'u-mona' },
      send: (data: unknown) => sent.push(data),
      close: (code: number, reason: string) => sent.push([code, reason]),
      getBufferedAmount: () => 42,
    } as unknown as ServerWebSocket<RemoteSocketData>;
    sockets.drain(socket);
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
