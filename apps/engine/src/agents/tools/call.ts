import type { RequestId } from '@modelcontextprotocol/sdk/types.js';
import { Cause, Effect } from 'effect';
import { describeError } from '../../log/index.ts';
import type { ToolHandler, ToolReply } from './schema.ts';

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
  return yield* handle(name, input, signal, requestId).pipe(
    Effect.map(replyWith),
    Effect.catchCause((cause) => Effect.succeed(refuseTool(describeError(Cause.squash(cause)))))
  );
});
