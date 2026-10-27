import type { UpdateStreamLine } from '@shinsa/core';
import { readJsonObject } from '../http/body.ts';
import type { ApiRoute } from '../http/routes.ts';
import { describeError, log } from '../log/index.ts';
import type { Versions } from './index.ts';

export const UPDATE_STREAM_TYPE = 'application/x-ndjson';

function respondStream(run: ReturnType<Versions['startUpdate']>) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: UpdateStreamLine) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      try {
        send({ type: 'done', ...(await run((line) => send({ type: 'output', line }))) });
      } catch (error) {
        log.warn('[Versions] The update stream failed', { error: describeError(error) });
        controller.error(error);
        return;
      }
      controller.close();
    },
  });
  return new Response(body, { headers: { 'content-type': UPDATE_STREAM_TYPE, 'cache-control': 'no-store' } });
}

async function respondUpdate(versions: Versions, request: Request) {
  const run = versions.startUpdate((await readJsonObject(request)).program);
  if (request.headers.get('accept')?.includes(UPDATE_STREAM_TYPE)) return respondStream(run);
  return Response.json(await run(() => undefined));
}

export function createVersionRoutes(versions: Versions): ApiRoute[] {
  return [
    {
      method: 'GET',
      pattern: /^\/api\/versions$/,
      respond: async () => Response.json(await versions.snapshot()),
    },
    {
      method: 'POST',
      pattern: /^\/api\/versions\/refresh$/,
      respond: async () => Response.json(await versions.refresh()),
    },
    {
      method: 'POST',
      pattern: /^\/api\/versions\/update$/,
      respond: (_match, request) => respondUpdate(versions, request),
    },
  ];
}
