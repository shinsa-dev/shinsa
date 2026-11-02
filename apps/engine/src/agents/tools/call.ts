import type { RequestId } from '@modelcontextprotocol/sdk/types.js';
import { Effect } from 'effect';
import { describeError } from '../../log/index.ts';
import { ToolCallFailed, type ToolHandler, type ToolReply } from './schema.ts';

function replyWith(text: string): ToolReply {
  return { content: [{ type: 'text', text }] };
}

export function refuseTool(text: string): ToolReply {
  return { content: [{ type: 'text', text }], isError: true };
}

export const callTool = Effect.fn('Tools.call')(function* (
  handle: ToolHandler,
  name: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
  requestId: RequestId
) {
  return yield* Effect.tryPromise({
    try: () => handle(name, input, signal, requestId),
    catch: (error) => new ToolCallFailed({ message: describeError(error) }),
  }).pipe(
    Effect.map(replyWith),
    Effect.catch((failure) => Effect.succeed(refuseTool(failure.message)))
  );
});
