import { describe, expect, test } from 'bun:test';
import {
  isHandOverTool,
  isShinsaToolName,
  isTaskSessionRole,
  listCallableToolNames,
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
    expect(listCallableToolNames('agent')).toContain('split_task');
    expect(listCallableToolNames('answerer')).toContain('create_task');
    expect(listCallableToolNames('answerer')).not.toContain('split_task');
    expect(listCallableToolNames('reviewer')).toContain('create_task');
    expect(listCallableToolNames('reviewer')).not.toContain('split_task');
  });

  test('each shape’s agent hands over with its own tool, and only the round agent can reshape a task', () => {
    expect(listCallableToolNames('investigator')).toContain('report_diagnosis');
    expect(listCallableToolNames('researcher')).toContain('submit_report');
    expect(listCallableToolNames('researcher')).not.toContain('wait_for');
    expect(listCallableToolNames('agent')).toContain('report_outcome');
    expect(listCallableToolNames('agent')).toContain('reshape_task');
    expect(listCallableToolNames('investigator')).not.toContain('reshape_task');
  });

  test('the round agent has one set of tools for every step, and each step names its hand-overs', () => {
    const tools = listCallableToolNames('agent');
    for (const [purpose, handOvers] of Object.entries(PURPOSE_HAND_OVERS)) {
      expect(handOvers.length, purpose).toBeGreaterThan(0);
      for (const tool of handOvers) {
        expect(tools).toContain(tool);
        expect(isHandOverTool(tool)).toBe(true);
      }
    }
    expect(tools.filter(isHandOverTool).sort()).toEqual(Object.values(PURPOSE_HAND_OVERS).flat().sort());
  });

  test('every role of the task’s session is served one tool list, so a role switch keeps the cached prefix', () => {
    const served = listToolNames('agent');
    for (const role of ['answerer', 'investigator', 'researcher'] as const) {
      expect(isTaskSessionRole(role)).toBe(true);
      expect(listToolNames(role)).toEqual(served);
      for (const tool of listCallableToolNames(role)) expect(served).toContain(tool);
    }
    expect(served).toContain('answer');
    expect(served).toContain('complete_phase');
    expect(listCallableToolNames('answerer')).not.toContain('complete_phase');
    expect(isTaskSessionRole('reviewer')).toBe(false);
    expect(listToolNames('reviewer')).toEqual(listCallableToolNames('reviewer'));
    expect(listToolNames('agent', 1)).toEqual(listCallableToolNames('agent', 1));
  });

  test('a delegated planner or builder never gets a step agent’s tools', () => {
    expect(listCallableToolNames('planner')).toEqual(listCallableToolNames('planner', 1));
    expect(listCallableToolNames('builder')).not.toContain('complete_phase');
  });

  test('every step agent can schedule work; every one but the reviewer can ask for a secret', () => {
    for (const role of ['agent', 'answerer', 'investigator', 'researcher'] as const) {
      expect(listCallableToolNames(role)).toContain('set_schedule');
      expect(listCallableToolNames(role)).toContain('request_secret');
    }
    for (const tool of ['set_schedule', 'list_schedules', 'delete_schedule'] as const) {
      expect(listCallableToolNames('reviewer')).toContain(tool);
    }
    expect(listCallableToolNames('reviewer')).not.toContain('request_secret');
  });

  test('every step agent and every delegated agent can read another task', () => {
    for (const role of ['agent', 'reviewer', 'answerer'] as const) {
      expect(listCallableToolNames(role)).toContain('read_task');
      expect(listCallableToolNames(role, 2)).toContain('read_task');
    }
  });

  test('every step agent sees the other work in its repository; a delegated agent does not', () => {
    for (const role of ['agent', 'reviewer', 'answerer', 'investigator', 'researcher'] as const) {
      expect(listCallableToolNames(role)).toContain('list_repository_work');
    }
    expect(listCallableToolNames('builder', 1)).not.toContain('list_repository_work');
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
