import { tmpdir } from 'node:os';
import { Duration, Effect, Option, Schema } from 'effect';
import { edgeRuntime } from '../../../runtime/edge.ts';
import { COMPLETION_TIMEOUT_MS, STRUCTURED_TIMEOUT_MS } from '../schema.ts';
import type { CompletionRequest, JsonSchema, StructuredRequest } from '../types.ts';
import { requestAnswer } from './complete/service.ts';
import { CODEX_RUNTIME } from './session.ts';
import type { CodexRuntime } from './session/schema.ts';

const decodeObject = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

function runAnswer(
  runtime: CodexRuntime,
  request: CompletionRequest,
  schema: JsonSchema | null,
  timeoutMs: number
) {
  return requestAnswer({
    executable: Effect.promise(() => runtime.resolveExecutable()),
    env: runtime.env,
    cwd: tmpdir(),
    request,
    schema,
    timeout: Duration.millis(timeoutMs),
  });
}

export function requestCodexCompletion(request: CompletionRequest, runtime: CodexRuntime = CODEX_RUNTIME) {
  return edgeRuntime.runPromise(runAnswer(runtime, request, null, COMPLETION_TIMEOUT_MS));
}

export function requestCodexStructured(request: StructuredRequest, runtime: CodexRuntime = CODEX_RUNTIME) {
  return edgeRuntime.runPromise(
    runAnswer(runtime, request, request.schema, request.timeoutMs ?? STRUCTURED_TIMEOUT_MS).pipe(
      Effect.map((text) => (text ? Option.getOrNull(decodeObject(text)) : null))
    )
  );
}
