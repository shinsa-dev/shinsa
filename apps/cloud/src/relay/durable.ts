import { RELAY_PING, RELAY_PONG } from '@shinsa/core';
import { Effect } from 'effect';
import { createRelayHub } from './hub.ts';
import type { RelayPeer, RelayTag } from './schema.ts';

interface RelaySocket {
  readonly readyState: number;
  send(message: string | ArrayBufferLike | ArrayBufferView): void;
  close(code: number, reason: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

interface RelayState {
  acceptWebSocket(socket: RelaySocket, tags?: string[]): void;
  getWebSockets(tag?: string): RelaySocket[];
  setWebSocketAutoResponse(pair: unknown): void;
}

interface WorkerGlobals {
  WebSocketPair: new () => { 0: RelaySocket; 1: RelaySocket };
  WebSocketRequestResponsePair: new (request: string, response: string) => unknown;
}

const workers = globalThis as unknown as WorkerGlobals;

const SOCKET_OPEN = 1;

export class MachineRelay {
  private readonly peers = new WeakMap<RelaySocket, RelayPeer>();
  private readonly hub;

  constructor(private readonly state: RelayState) {
    state.setWebSocketAutoResponse(new workers.WebSocketRequestResponsePair(RELAY_PING, RELAY_PONG));
    this.hub = createRelayHub({
      listPeers: () => state.getWebSockets().map((socket) => this.resolvePeer(socket)),
      accept: (tag, protocol) => this.accept(tag, protocol),
    });
  }

  fetch(request: Request) {
    return Effect.runPromise(this.hub.fetch(request));
  }

  webSocketMessage(socket: RelaySocket, message: string | ArrayBuffer) {
    return Effect.runPromise(this.hub.receive(this.resolvePeer(socket), message));
  }

  webSocketClose(socket: RelaySocket, code: number, reason: string) {
    return Effect.runPromise(this.hub.closed(this.resolvePeer(socket), code, reason));
  }

  webSocketError(socket: RelaySocket) {
    return Effect.runPromise(this.hub.closed(this.resolvePeer(socket), 1011, 'The socket failed.'));
  }

  private resolvePeer(socket: RelaySocket) {
    const known = this.peers.get(socket);
    if (known) return known;
    const peer: RelayPeer = {
      tag: socket.deserializeAttachment() as RelayTag,
      isOpen: () => socket.readyState === SOCKET_OPEN,
      send: (message) => socket.send(message),
      close: (code, reason) => socket.close(code, reason),
    };
    this.peers.set(socket, peer);
    return peer;
  }

  private accept(tag: RelayTag, protocol: string | null) {
    const pair = new workers.WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.serializeAttachment(tag);
    this.state.acceptWebSocket(server, [tag.role]);
    return new Response(null, {
      status: 101,
      webSocket: client,
      ...(protocol ? { headers: { 'sec-websocket-protocol': protocol } } : {}),
    } as ResponseInit);
  }
}
