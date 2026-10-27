import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type RequestId,
} from '@modelcontextprotocol/sdk/types.js';
import { listToolNames, type RunRole } from '@shinsa/core';
import { describeError } from '../../log/index.ts';
import type { ToolSpec } from './schema.ts';
import { TOOL_SPECS } from './specs.ts';

export type ToolHandler = (
  name: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
  requestId?: RequestId
) => Promise<string>;

interface ToolServerOptions {
  scope?: () => string;
}

export interface ShinsaTools {
  name: 'shinsa';
  role: RunRole;
  server: Server;
  handle: ToolHandler;
  createServer: (options?: ToolServerOptions) => Server;
}

export function createToolSet(role: RunRole, specs: ToolSpec[], handle: ToolHandler): ShinsaTools {
  const allowed = new Set<string>(specs.map((spec) => spec.name));
  const createServer = (options: ToolServerOptions = {}) => {
    const server = new Server({ name: 'shinsa', version: '1.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, () =>
      Promise.resolve({
        tools: specs.map((spec) => ({ ...spec, _meta: { 'anthropic/alwaysLoad': true } })),
      })
    );
    server.setRequestHandler(CallToolRequestSchema, async (call, extra) => {
      const name = call.params.name;
      if (!allowed.has(name)) {
        return {
          content: [{ type: 'text' as const, text: `${name} is not available to the ${role}.` }],
          isError: true,
        };
      }
      const requestId = options.scope ? `${options.scope()}.${extra.requestId}` : extra.requestId;
      try {
        const text = await handle(name, call.params.arguments ?? {}, extra.signal, requestId);
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        const text = describeError(error);
        return { content: [{ type: 'text' as const, text }], isError: true };
      }
    });
    return server;
  };
  return { name: 'shinsa', role, server: createServer(), handle, createServer };
}

export function createShinsaTools(
  role: RunRole,
  handle: ToolHandler,
  depth = 0,
  extra: ToolSpec[] = []
): ShinsaTools {
  return createToolSet(
    role,
    [...listToolNames(role, depth).map((name) => TOOL_SPECS[name]), ...extra],
    handle
  );
}
