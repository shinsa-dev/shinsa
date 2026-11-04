import { Duration, Effect, Queue } from 'effect';
import { CodexRequestError } from '../client/schema.ts';
import { makeCodexClient } from '../client/service.ts';
import { readRecord } from '../params.ts';
import { FAST_TIER } from '../session/schema.ts';
import { type CodexCallDefinition, type CodexCallEvent, CodexCallFailed, TURN_FAILED } from './schema.ts';

export const requestAnswer = Effect.fn('CodexCompletion.request')(function* (
  definition: CodexCallDefinition
) {
  const { request, schema } = definition;
  const executable = yield* definition.executable;
  if (!executable.ok) return yield* new CodexCallFailed({ message: executable.message });
  const events = yield* Queue.unbounded<CodexCallEvent>();

  const readTurnError = (params: Record<string, unknown>) => {
    const message = readRecord(readRecord(params.turn).error).message;
    return typeof message === 'string' && message ? message : TURN_FAILED;
  };

  const awaitAnswer = Effect.fn('CodexCompletion.awaitAnswer')(function* (threadId: string) {
    let text: string | null = null;
    for (;;) {
      const event = yield* Queue.take(events);
      if (event.type === 'exit') return yield* new CodexCallFailed({ message: event.message });
      const { method, params } = event;
      if (params.threadId !== threadId) continue;
      const item = readRecord(params.item);
      if (method === 'item/completed' && item.type === 'agentMessage' && typeof item.text === 'string') {
        text = item.text;
      }
      if (method !== 'turn/completed') continue;
      if (readRecord(params.turn).status === 'completed') return text?.trim() || null;
      return yield* new CodexCallFailed({ message: readTurnError(params) });
    }
  });

  const ask = Effect.gen(function* () {
    const connection = yield* makeCodexClient(
      { path: executable.path, cwd: definition.cwd, env: definition.env },
      {
        notification: (method, params) => {
          Queue.offerUnsafe(events, { type: 'notification', method, params });
        },
        request: (method) =>
          Promise.reject(
            new CodexRequestError({ method, message: `A quick call does not answer ${method}.` })
          ),
        exit: (message) => {
          Queue.offerUnsafe(events, { type: 'exit', message });
        },
      }
    );
    yield* connection.initialize;
    const thread = yield* connection.request('thread/start', {
      model: request.model,
      cwd: definition.cwd,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      serviceTier: request.fastMode ? FAST_TIER : null,
      ephemeral: true,
      developerInstructions: request.system,
    });
    const threadId = String(readRecord(readRecord(thread).thread).id);
    yield* connection.request('turn/start', {
      threadId,
      input: [{ type: 'text', text: request.prompt, text_elements: [] }],
      effort: 'low',
      ...(schema ? { outputSchema: schema } : {}),
    });
    return yield* awaitAnswer(threadId);
  });

  return yield* ask.pipe(
    Effect.timeoutOrElse({
      duration: definition.timeout,
      orElse: () =>
        Effect.fail(
          new CodexCallFailed({
            message: `Codex did not answer within ${Duration.toMillis(definition.timeout)} ms.`,
          })
        ),
    }),
    Effect.scoped
  );
});
