import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { CallToolResult, RequestId } from '@modelcontextprotocol/sdk/types.js';
import type { DomainError, RunRole } from '@shinsa/core';
import { type Effect, Schema } from 'effect';

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
}

export type ToolHandler = (
  name: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
  requestId?: RequestId
) => Effect.Effect<string, ToolCallFailed | DomainError>;

export interface ToolServerOptions {
  scope?: () => string;
}

export interface ShinsaTools {
  name: 'shinsa';
  role: RunRole;
  server: Server;
  handle: ToolHandler;
  createServer: (options?: ToolServerOptions) => Server;
}

export type ToolReply = CallToolResult;

export class ToolCallFailed extends Schema.TaggedError<ToolCallFailed, { readonly brand: unique symbol }>()(
  'ToolCallFailed',
  { message: Schema.String }
) {}
