import { Duration, Effect, Option, Stream } from 'effect';
import { describeError } from '../../../../log/index.ts';
import { STRUCTURED_TIMEOUT_MS } from '../../schema.ts';
import type { CompletionRequest, StructuredRequest } from '../../types.ts';
import { resolveClaudeLaunch } from '../sdk/launch.ts';
import type { ClaudeRuntime } from '../sdk/schema.ts';
import { readCompletionText, readStructuredOutput } from './output.ts';
import { ClaudeCallFailed, ClaudeTimedOut } from './schema.ts';

export const makeClaudeCompletions = Effect.fn('ClaudeComplete.make')(function* (runtime: ClaudeRuntime) {
  const launch = yield* resolveClaudeLaunch(runtime.resolveExecutable);
  const failed = (error: unknown) => new ClaudeCallFailed({ message: describeError(error) });

  const abortAfter = (controller: AbortController, timeout: Duration.Duration) =>
    Effect.sleep(timeout).pipe(Effect.andThen(Effect.sync(() => controller.abort())), Effect.forkScoped);

  const text = Effect.fn('ClaudeComplete.text')(function* (
    request: CompletionRequest,
    timeout: Duration.Duration
  ) {
    const controller = new AbortController();
    yield* abortAfter(controller, timeout);
    const session = yield* Effect.try({
      try: () =>
        runtime.runQuery({
          prompt: request.prompt,
          options: {
            model: request.model,
            maxTurns: 1,
            thinking: { type: 'disabled' },
            tools: [],
            settingSources: [],
            settings: { fastMode: request.fastMode === true },
            systemPrompt: request.system,
            abortController: controller,
            ...launch.options,
          },
        }),
      catch: failed,
    });
    const answer = yield* Stream.fromAsyncIterable(session, failed).pipe(
      Stream.map(readCompletionText),
      Stream.filter((value) => value !== null),
      Stream.runHead
    );
    return Option.getOrNull(answer);
  }, Effect.scoped);

  const structured = Effect.fn('ClaudeComplete.structured')(function* (request: StructuredRequest) {
    const timeoutMs = request.timeoutMs ?? STRUCTURED_TIMEOUT_MS;
    const controller = new AbortController();
    yield* abortAfter(controller, Duration.millis(timeoutMs));
    const session = yield* Effect.acquireRelease(
      Effect.try({
        try: () =>
          runtime.runQuery({
            prompt: request.prompt,
            options: {
              model: request.model,
              tools: [],
              settingSources: [],
              settings: { fastMode: request.fastMode === true },
              systemPrompt: request.system,
              effort: 'low',
              permissionMode: 'bypassPermissions',
              allowDangerouslySkipPermissions: true,
              outputFormat: {
                type: 'json_schema',
                schema: request.schema as unknown as Record<string, unknown>,
              },
              abortController: controller,
              ...launch.options,
            },
          }),
        catch: failed,
      }),
      (opened) => Effect.sync(() => opened.close())
    );
    const output = yield* Stream.fromAsyncIterable(session, (error) =>
      controller.signal.aborted
        ? new ClaudeTimedOut({ message: `Claude did not answer within ${timeoutMs} ms.` })
        : failed(error)
    ).pipe(
      Stream.map(readStructuredOutput),
      Stream.filter((value) => value !== null),
      Stream.runHead
    );
    return Option.getOrNull(output);
  }, Effect.scoped);

  return { text, structured };
});
