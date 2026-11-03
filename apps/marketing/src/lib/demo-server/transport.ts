import { Effect, Layer, Schema } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { Socket } from 'effect/socket';
import type { AppTransportServices } from '@/lib/runtime/schema.ts';
import { answerCodeRead, recordFileWrite } from '../demo-repo.ts';
import {
  CODE_READ_PATH,
  DEMO_API_PREFIX,
  DEMO_REFUSAL,
  DEMO_REFUSAL_STATUS,
  DEMO_SOCKET_PATH,
  FILE_WRITE_PATH,
  FileWriteText,
} from './schema.ts';
import { createDemoSocket } from './sockets.ts';

const decodeFileWrite = Schema.decodeUnknownEffect(FileWriteText);

const answerDemoRequest = Effect.fn('DemoServer.answer')(function* (request: Request, url: URL) {
  const write = FILE_WRITE_PATH.exec(url.pathname);
  if (request.method === 'POST' && write?.[1]) {
    const text = yield* Effect.promise(() => request.text());
    const change = yield* Effect.orDie(decodeFileWrite(text));
    return Response.json(recordFileWrite(decodeURIComponent(write[1]), change));
  }
  const read = CODE_READ_PATH.exec(url.pathname);
  const answer =
    read?.[1] && read[2] ? answerCodeRead(decodeURIComponent(read[1]), read[2], url.searchParams) : null;
  if (answer === null) return Response.json(DEMO_REFUSAL, { status: DEMO_REFUSAL_STATUS });
  return Response.json(answer);
});

function sendDemoRequest(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith(DEMO_API_PREFIX)) {
    return globalThis.fetch(input, init);
  }
  return Effect.runPromise(answerDemoRequest(new Request(url, init), url));
}

function openSocket(url: string) {
  const target = new URL(url, location.href);
  return target.pathname === DEMO_SOCKET_PATH ? createDemoSocket() : new globalThis.WebSocket(target);
}

export const DemoTransport: Layer.Layer<AppTransportServices> = Layer.mergeAll(
  Layer.succeed(
    FetchHttpClient.Fetch,
    Object.assign(sendDemoRequest, { preconnect: globalThis.fetch.preconnect })
  ),
  Layer.succeed(Socket.WebSocketConstructor, openSocket)
);
