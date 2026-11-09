import type { ServerWebSocket } from 'bun';

export interface FakeCdp {
  readonly url: string;
  readonly port: number;
  readonly received: string[];
  readonly cookies: Record<string, unknown>[];
  dropAll(): void;
  stop(): void;
}

export interface FakeCdpOptions {
  readonly onBrowserClose?: () => void;
}

function answerCdp(
  method: string,
  params: { cookies?: Record<string, unknown>[] },
  cookies: Record<string, unknown>[],
  text: string
) {
  if (method === 'Storage.setCookies') {
    cookies.push(...(params.cookies ?? []));
    return {};
  }
  if (method === 'Storage.getCookies') {
    return {
      cookies: cookies.map((cookie) => ({
        domain: cookie.domain ?? new URL(String(cookie.url)).hostname,
        name: cookie.name,
        httpOnly: cookie.httpOnly,
      })),
    };
  }
  return { echoed: text };
}

export function startFakeCdp(options: FakeCdpOptions = {}): FakeCdp {
  const received: string[] = [];
  const cookies: Record<string, unknown>[] = [];
  const open = new Set<ServerWebSocket<undefined>>();
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, bunServer) {
      if (bunServer.upgrade(request)) return undefined;
      return new Response('not a socket', { status: 400 });
    },
    websocket: {
      open: (socket) => {
        open.add(socket);
      },
      close: (socket) => {
        open.delete(socket);
      },
      message: (socket, message) => {
        const text = String(message);
        received.push(text);
        const { id, method, params } = JSON.parse(text) as {
          id: number;
          method: string;
          params?: { cookies?: Record<string, unknown>[] };
        };
        socket.send(JSON.stringify({ id, result: answerCdp(method, params ?? {}, cookies, text) }));
        if (method === 'Browser.close') options.onBrowserClose?.();
      },
    },
  });
  return {
    url: `ws://127.0.0.1:${server.port}/devtools/browser/fake`,
    port: server.port ?? 0,
    received,
    cookies,
    dropAll: () => {
      for (const socket of open) socket.close(1000, 'gone');
    },
    stop: () => {
      void server.stop(true);
    },
  };
}

export interface FakePeer {
  readonly messages: string[];
  readonly closed: { code: number; reason: string }[];
  send(data: string | Uint8Array): void;
  close(code: number, reason: string): void;
}

export function createFakePeer(): FakePeer {
  const messages: string[] = [];
  const closed: { code: number; reason: string }[] = [];
  return {
    messages,
    closed,
    send: (data) => messages.push(typeof data === 'string' ? data : new TextDecoder().decode(data)),
    close: (code, reason) => closed.push({ code, reason }),
  };
}
