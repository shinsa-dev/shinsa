import type { RequestId } from '@modelcontextprotocol/sdk/types.js';
import type { RunRole } from '@shinsa/core';
import { Effect } from 'effect';
import { createShinsaTools, createToolSet } from '../../src/agents/tools/index.ts';
import { ToolCallFailed, type ToolSpec } from '../../src/agents/tools/schema.ts';
import { describeError } from '../../src/log/index.ts';

export type PromisedToolHandler = (
  name: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
  requestId?: RequestId
) => Promise<string>;

function adaptHandler(handle: PromisedToolHandler) {
  return (name: string, input: Record<string, unknown>, signal: AbortSignal, requestId?: RequestId) =>
    Effect.tryPromise({
      try: () => handle(name, input, signal, requestId),
      catch: (error) => new ToolCallFailed({ message: describeError(error) }),
    });
}

export function createTestTools(
  role: RunRole,
  handle: PromisedToolHandler,
  depth = 0,
  extra: ToolSpec[] = []
) {
  return Effect.runSync(createShinsaTools(role, adaptHandler(handle), depth, extra));
}

export function createTestToolSet(role: RunRole, specs: ToolSpec[], handle: PromisedToolHandler) {
  return Effect.runSync(createToolSet(role, specs, adaptHandler(handle)));
}
