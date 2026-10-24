import { describe, expect, test } from 'bun:test';
import { SHINSA_TOOL_NAMES } from '@shinsa/core';
import {
  isSurfaceTool,
  listSurfaceToolSpecs,
  readSurfaceToolCall,
} from '../../../src/agents/manage/tools.ts';
import { TOOL_SPECS } from '../../../src/agents/tools/specs.ts';
import { listAgentSpecs, SURFACE } from '../../../src/surface/index.ts';

describe('the surface as agent tools', () => {
  test('lists every action but the ones only the human takes, with read and write hints', () => {
    const tools = listSurfaceToolSpecs();
    const names = tools.map((tool) => tool.name);
    expect(tools).toHaveLength(SURFACE.filter((spec) => !spec.humanOnly).length);
    expect(names).toContain('tasks_create');
    expect(names).toContain('questions_answer');
    for (const humanOnly of ['plans_approve', 'reviews_approve', 'merges_approve', 'gates_answer', 'command'])
      expect(names).not.toContain(humanOnly);
    expect(names).not.toContain('gates_secret');
    expect(names).not.toContain('accounts_sign_in');
    expect(names).not.toContain('accounts_import');
    expect(names).not.toContain('accounts_remove');
    expect(tools.find((tool) => tool.name === 'tasks_diff')?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(tools.find((tool) => tool.name === 'tasks_list')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === 'tasks_list')?.description).toContain('It only reads.');
    expect(tools.find((tool) => tool.name === 'tasks_cancel')?.annotations?.destructiveHint).toBe(true);
    expect(
      Object.keys(
        (tools.find((tool) => tool.name === 'tasks_cancel')?.inputSchema.properties ?? {}) as object
      )
    ).toEqual(['task']);
    expect(names.every(isSurfaceTool)).toBe(true);
    expect(isSurfaceTool('propose_plan')).toBe(false);
  });

  test('can never share a name with a hand-over or process tool', () => {
    const roleTools = new Set<string>([...SHINSA_TOOL_NAMES, ...Object.keys(TOOL_SPECS)]);
    const clashes = listSurfaceToolSpecs().filter((tool) => roleTools.has(tool.name));
    expect(clashes.map((tool) => tool.name)).toEqual([]);
    expect(new Set(listSurfaceToolSpecs().map((tool) => tool.name)).size).toBe(listAgentSpecs().length);
  });

  test('reads a call; unknown tools, human-only actions and unknown fields are refused', () => {
    expect(readSurfaceToolCall('tasks_show', { task: 'SW-1' })).toMatchObject({ values: { task: 'SW-1' } });
    expect(() => readSurfaceToolCall('nope', {})).toThrow('No tool nope.');
    expect(() => readSurfaceToolCall('merges_approve', { task: 'SW-1' })).toThrow('No tool merges_approve.');
    expect(() => readSurfaceToolCall('tasks_show', { task: 'x', extra: 1 })).toThrow('Unknown field extra.');
    expect(() => readSurfaceToolCall('tasks_show', {})).toThrow('task is required.');
  });
});
