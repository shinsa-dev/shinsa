import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { listToolNames, type RunRole } from '@shinsa/core';
import { Effect } from 'effect';
import { callTool, refuseTool } from './call.ts';
import type { ShinsaTools, ToolHandler, ToolServerOptions, ToolSpec } from './schema.ts';
import { TOOL_SPECS } from './specs.ts';

export type { ShinsaTools, ToolHandler } from './schema.ts';

export const createToolSet = Effect.fn('Tools.createToolSet')(function* (
  role: RunRole,
  specs: ToolSpec[],
  handle: ToolHandler
) {
  const answer = Effect.runPromiseWith(yield* Effect.context<never>());
  const allowed = new Set<string>(specs.map((spec) => spec.name));
  const listed = { tools: specs.map((spec) => ({ ...spec, _meta: { 'anthropic/alwaysLoad': true } })) };
  const createServer = (options: ToolServerOptions = {}) => {
    const server = new Server({ name: 'shinsa', version: '1.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, () => answer(Effect.succeed(listed)));
    server.setRequestHandler(CallToolRequestSchema, (call, extra) => {
      const name = call.params.name;
      if (!allowed.has(name))
        return answer(Effect.succeed(refuseTool(`${name} is not available to the ${role}.`)));
      const requestId = options.scope ? `${options.scope()}.${extra.requestId}` : extra.requestId;
      return answer(callTool(handle, name, call.params.arguments ?? {}, extra.signal, requestId));
    });
    return server;
  };
  const tools: ShinsaTools = { name: 'shinsa', role, server: createServer(), handle, createServer };
  return tools;
});

export const createShinsaTools = (role: RunRole, handle: ToolHandler, depth = 0, extra: ToolSpec[] = []) =>
  createToolSet(role, [...listToolNames(role, depth).map((name) => TOOL_SPECS[name]), ...extra], handle);
