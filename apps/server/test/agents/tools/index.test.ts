import { describe, expect, test } from 'bun:test';
import type { RunRole } from '@shinsa/core';
import { createShinsaToolServer, type ToolHandler } from '../../../src/agents/tools/index.ts';
import { TOOL_SPECS } from '../../../src/agents/tools/specs.ts';

type Handler = (request: unknown, extra: unknown) => Promise<unknown>;

function readHandlers(role: RunRole, handler: ToolHandler) {
  const config = createShinsaToolServer(role, handler);
  const handlers = (config.instance as unknown as { _requestHandlers: Map<string, Handler> })
    ._requestHandlers;
  const list = handlers.get('tools/list');
  const call = handlers.get('tools/call');
  if (!list || !call) throw new Error('handlers missing');
  return { config, list, call };
}

const extra = { signal: new AbortController().signal };

describe('the shinsa tool server', () => {
  test('lists only the tools of the role, always loaded', async () => {
    const { config, list } = readHandlers('reviewer', () => Promise.resolve(''));
    expect(config).toMatchObject({ type: 'sdk', name: 'shinsa' });
    const result = (await list({ method: 'tools/list' }, extra)) as {
      tools: { name: string; _meta: unknown }[];
    };
    expect(result.tools.map((tool) => tool.name)).toEqual([
      'report_review',
      'attach_evidence',
      'find_tasks',
      'note',
    ]);
    expect(result.tools[0]?._meta).toEqual({ 'anthropic/alwaysLoad': true });
  });

  test('a call reaches the handler, errors come back as tool errors, and other roles’ tools are refused', async () => {
    const seen: unknown[] = [];
    const { call } = readHandlers('planner', (name, input) => {
      seen.push([name, input]);
      if (name === 'note') return Promise.reject(new Error('note is required.'));
      return Promise.resolve('Handed over.');
    });
    const request = (name: string, args?: Record<string, unknown>) => ({
      method: 'tools/call',
      params: { name, arguments: args },
    });
    expect(await call(request('propose_plan', { goal: 'x' }), extra)).toEqual({
      content: [{ type: 'text', text: 'Handed over.' }],
    });
    expect(await call(request('note'), extra)).toEqual({
      content: [{ type: 'text', text: 'note is required.' }],
      isError: true,
    });
    expect(await call(request('complete_phase'), extra)).toEqual({
      content: [{ type: 'text', text: 'complete_phase is not available to the planner.' }],
      isError: true,
    });
    expect(seen).toEqual([
      ['propose_plan', { goal: 'x' }],
      ['note', {}],
    ]);
  });

  test('every tool a role can call has a published schema', () => {
    for (const spec of Object.values(TOOL_SPECS)) expect(spec.inputSchema.type).toBe('object');
  });
});
