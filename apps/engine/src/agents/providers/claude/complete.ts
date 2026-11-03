import { Duration, Effect } from 'effect';
import { edgeRuntime } from '../../../runtime/edge.ts';
import { COMPLETION_TIMEOUT_MS } from '../schema.ts';
import type { CompletionRequest, StructuredRequest } from '../types.ts';
import { makeClaudeCompletions } from './complete/service.ts';
import { CLAUDE_RUNTIME, type ClaudeRuntime } from './sdk.ts';

export { readStructuredOutput } from './complete/output.ts';

export function requestClaudeCompletion(
  request: CompletionRequest,
  runtime: ClaudeRuntime = CLAUDE_RUNTIME,
  timeoutMs = COMPLETION_TIMEOUT_MS
): Promise<string | null> {
  return edgeRuntime.runPromise(
    Effect.flatMap(makeClaudeCompletions(runtime), (completions) =>
      completions.text(request, Duration.millis(timeoutMs))
    )
  );
}

export function requestClaudeStructured(
  request: StructuredRequest,
  runtime: ClaudeRuntime = CLAUDE_RUNTIME
): Promise<unknown> {
  return edgeRuntime.runPromise(
    Effect.flatMap(makeClaudeCompletions(runtime), (completions) => completions.structured(request))
  );
}
