import type { FileWrite, SearchLine } from '@shinsa/core';
import { ROUTE_NOT_FOUND_MESSAGE, RouteNotFound } from '@shinsa/core/engine-api/schema';
import { Effect, Schema, Stream } from 'effect';
import type { FileSave } from '@/lib/code/edits.ts';
import { runApp } from '@/lib/runtime/app.ts';
import { streamLines } from '@/lib/runtime/engine/lines.ts';
import { EngineRefused } from '@/lib/runtime/engine/schema.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';
import { CodeRead, SearchLineAnswer } from './schema.ts';

type CodeQuery = Readonly<Record<string, string>>;

const decodeRead = Schema.decodeUnknownEffect(CodeRead);

const readLines = streamLines(SearchLineAnswer);

const read = Effect.fn('Code.read')(function* (taskRef: string, name: string, query: CodeQuery) {
  const engine = yield* EngineClient;
  const known = yield* Effect.mapError(
    decodeRead(name),
    () =>
      new EngineRefused({
        status: RouteNotFound.status,
        code: RouteNotFound.code,
        message: ROUTE_NOT_FOUND_MESSAGE,
      })
  );
  const request = { params: { taskRef }, query };
  if (known === 'refs') return yield* engine.code.refs(request);
  if (known === 'paths') return yield* engine.code.paths(request);
  if (known === 'tree') return yield* engine.code.tree(request);
  if (known === 'blob') return yield* engine.code.blob(request);
  return yield* engine.code.diff(request);
});

const search = Effect.fn('Code.search')(function* (
  taskRef: string,
  query: CodeQuery,
  onLine: (line: SearchLine) => void
) {
  const engine = yield* EngineClient;
  const response = yield* engine.code.search({
    params: { taskRef },
    query,
    responseMode: 'response-only',
  });
  yield* Stream.runForEach(readLines(response), (line) => Effect.sync(() => onLine(line)));
}, Effect.provide(EngineClient.askingLines));

const write = Effect.fn('Code.write')(function* (taskRef: string, file: FileWrite) {
  const engine = yield* EngineClient;
  return yield* engine.tasks.writeFile({ params: { taskRef }, payload: { ...file } }).pipe(
    Effect.map((written): FileSave => ({ kind: 'saved', changed: written.changed })),
    Effect.catchTag('EditConflict', (conflict) =>
      Effect.succeed<FileSave>({ kind: 'changed', content: conflict.content })
    )
  );
});

export function requestCodeAnswer(taskRef: string, name: string, query: CodeQuery) {
  return runApp(read(taskRef, name, query));
}

export function requestCodeSearch(taskRef: string, query: CodeQuery, onLine: (line: SearchLine) => void) {
  return search(taskRef, query, onLine);
}

export function requestFileSave(taskRef: string, file: FileWrite) {
  return runApp(write(taskRef, file));
}
