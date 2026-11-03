import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { listToolNames, type RunRole } from '@shinsa/core';
import { edgeRuntime } from '../../runtime/edge.ts';
import { callTool, refuseTool } from './call.ts';
import type { ShinsaTools, ToolHandler, ToolServerOptions, ToolSpec } from './schema.ts';
import { TOOL_SPECS } from './specs.ts';

export type { ShinsaTools, ToolHandler } from './schema.ts';

export function createToolSet(role: RunRole, specs: ToolSpec[], handle: ToolHandler): ShinsaTools {
  const allowed = new Set<string>(specs.map((spec) => spec.name));
  const createServer = (options: ToolServerOptions = {}) => {
    const server = new Server({ name: 'shinsa', version: '1.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, () =>
      Promise.resolve({
        tools: specs.map((spec) => ({ ...spec, _meta: { 'anthropic/alwaysLoad': true } })),
      })
    );
    server.setRequestHandler(CallToolRequestSchema, (call, extra) => {
      const name = call.params.name;
      if (!allowed.has(name)) return Promise.resolve(refuseTool(`${name} is not available to the ${role}.`));
      const requestId = options.scope ? `${options.scope()}.${extra.requestId}` : extra.requestId;
      return edgeRuntime.runPromise(
        callTool(handle, name, call.params.arguments ?? {}, extra.signal, requestId)
      );
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
