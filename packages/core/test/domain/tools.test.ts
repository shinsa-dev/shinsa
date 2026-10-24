import { describe, expect, test } from 'bun:test';
import {
  isHandOverTool,
  isShinsaToolName,
  listToolNames,
  PURPOSE_HAND_OVERS,
  SHINSA_TOOL_NAMES,
} from '../../src/index.ts';

describe('the tools each agent gets', () => {
  test('a delegated agent gets the delegate’s tools, and loses delegate_task at the depth limit', () => {
    expect(listToolNames('reviewer', 1)).toEqual([
      'ask',
      'attach_evidence',
      'find_tasks',
      'read_task',
      'note',
      'delegate_task',
      'delegation_status',
      'delegation_cancel',
      'delegation_answer',
    ]);
    expect(listToolNames('builder', 3)).toEqual([
      'ask',
      'attach_evidence',
      'find_tasks',
      'read_task',
      'note',
    ]);
  });

  test('the round agent can split its plan; every step agent can file a task', () => {
    expect(listToolNames('agent')).toContain('split_task');
    expect(listToolNames('answerer')).toContain('create_task');
    expect(listToolNames('answerer')).not.toContain('split_task');
    expect(listToolNames('reviewer')).toContain('create_task');
    expect(listToolNames('reviewer')).not.toContain('split_task');
  });

  test('each shape’s agent hands over with its own tool, and only the round agent can reshape a task', () => {
    expect(listToolNames('investigator')).toContain('report_diagnosis');
    expect(listToolNames('researcher')).toContain('submit_report');
    expect(listToolNames('researcher')).not.toContain('wait_for');
    expect(listToolNames('agent')).toContain('report_outcome');
    expect(listToolNames('agent')).toContain('reshape_task');
    expect(listToolNames('investigator')).not.toContain('reshape_task');
  });

  test('the round agent has one set of tools for every step, and each step names its hand-overs', () => {
    const tools = listToolNames('agent');
    for (const [purpose, handOvers] of Object.entries(PURPOSE_HAND_OVERS)) {
      expect(handOvers.length, purpose).toBeGreaterThan(0);
      for (const tool of handOvers) {
        expect(tools).toContain(tool);
        expect(isHandOverTool(tool)).toBe(true);
      }
    }
    expect(tools.filter(isHandOverTool).sort()).toEqual(Object.values(PURPOSE_HAND_OVERS).flat().sort());
  });

  test('a delegated planner or builder never gets a step agent’s tools', () => {
    expect(listToolNames('planner')).toEqual(listToolNames('planner', 1));
    expect(listToolNames('builder')).not.toContain('complete_phase');
  });

  test('every step agent can schedule work; every one but the reviewer can ask for a secret', () => {
    for (const role of ['agent', 'answerer', 'investigator', 'researcher'] as const) {
      expect(listToolNames(role)).toContain('set_schedule');
      expect(listToolNames(role)).toContain('request_secret');
    }
    for (const tool of ['set_schedule', 'list_schedules', 'delete_schedule'] as const) {
      expect(listToolNames('reviewer')).toContain(tool);
    }
    expect(listToolNames('reviewer')).not.toContain('request_secret');
  });

  test('every step agent and every delegated agent can read another task', () => {
    for (const role of ['agent', 'reviewer', 'answerer'] as const) {
      expect(listToolNames(role)).toContain('read_task');
      expect(listToolNames(role, 2)).toContain('read_task');
    }
  });

  test('names every tool the agents can be given, schedules and secrets included', () => {
    const offered = new Set(
      (['agent', 'reviewer', 'answerer', 'investigator', 'researcher'] as const).flatMap((role) =>
        listToolNames(role)
      )
    );
    expect([...SHINSA_TOOL_NAMES].sort()).toEqual([...offered].sort());
    for (const name of ['set_schedule', 'list_schedules', 'delete_schedule', 'request_secret']) {
      expect(isShinsaToolName(name)).toBe(true);
    }
    expect(isShinsaToolName('Bash')).toBe(false);
  });
});
