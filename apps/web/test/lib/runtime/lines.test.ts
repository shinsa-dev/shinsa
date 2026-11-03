import { describe, expect, it } from 'bun:test';
import { Effect, Schema, Stream } from 'effect';
import { HttpClientRequest, HttpClientResponse } from 'effect/http';
import { streamLines } from '@/lib/runtime/engine/lines.ts';

const readLines = streamLines(Schema.Struct({ n: Schema.Number }));

function respond(body: BodyInit) {
  return HttpClientResponse.fromWeb(HttpClientRequest.get('/api/lines'), new Response(body));
}

function collect(body: BodyInit) {
  return Effect.runPromise(Stream.runCollect(readLines(respond(body))));
}

function fail(body: BodyInit) {
  return Effect.runPromise(Effect.flip(Stream.runCollect(readLines(respond(body)))));
}

describe('streamLines', () => {
  it('decodes each line, across chunks, and skips blank ones', async () => {
    const chunks = ['{"n":1}\n{"n"', ':2}\n\n  \n{"n":3}'];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    });
    expect(await collect(body)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it('fails as unreadable on a line that breaks its schema', async () => {
    expect(await fail('{"n":1}\nnot json\n')).toMatchObject({ _tag: 'EngineAnswerInvalid' });
  });

  it('says Shinsa stopped answering when the body breaks off', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"n":1}\n'));
        controller.error(new Error('reset'));
      },
    });
    expect(await fail(body)).toMatchObject({ _tag: 'EngineStopped', message: 'Shinsa stopped answering.' });
  });
});
