import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { RunRole } from '@shinsa/core';
import { describeError } from '../../log/index.ts';
import { type ShinsaToolName, TOOL_SPECS, type ToolSpec } from './specs.ts';

export type ToolHandler = (
  name: string,
  input: Record<string, unknown>,
  signal: AbortSignal
) => Promise<string>;

const ROLE_TOOLS: Record<RunRole, ShinsaToolName[]> = {
  triage: [],
  planner: ['propose_plan', 'ask', 'find_tasks', 'note'],
  builder: ['complete_phase', 'ask', 'attach_evidence', 'find_tasks', 'note'],
  reviewer: ['report_review', 'attach_evidence', 'find_tasks', 'note'],
  fixer: ['complete_fix', 'ask', 'attach_evidence', 'find_tasks', 'note'],
  shipper: ['complete_fix', 'ask', 'find_tasks', 'note'],
};

function listRoleTools(role: RunRole): ToolSpec[] {
  return ROLE_TOOLS[role].map((name) => TOOL_SPECS[name]);
}

export function createShinsaToolServer(role: RunRole, handler: ToolHandler): McpSdkServerConfigWithInstance {
  const server = new Server({ name: 'shinsa', version: '1.0.0' }, { capabilities: { tools: {} } });
  const allowed = new Set<string>(ROLE_TOOLS[role]);
  server.setRequestHandler(ListToolsRequestSchema, () =>
    Promise.resolve({
      tools: listRoleTools(role).map((spec) => ({ ...spec, _meta: { 'anthropic/alwaysLoad': true } })),
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
    try {
      const text = await handler(name, call.params.arguments ?? {}, extra.signal);
      return { content: [{ type: 'text' as const, text }] };
    } catch (error) {
      const text = describeError(error);
      return { content: [{ type: 'text' as const, text }], isError: true };
    }
  });
  return {
    type: 'sdk',
    name: 'shinsa',
    instance: server as unknown as McpSdkServerConfigWithInstance['instance'],
  };
}
