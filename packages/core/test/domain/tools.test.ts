import { describe, expect, test } from 'bun:test';
import { isShinsaToolName, listToolNames, SHINSA_TOOL_NAMES } from '../../src/index.ts';

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

  test('a step agent that builds can split its plan; every step agent can file a task', () => {
    expect(listToolNames('builder')).toContain('split_task');
    expect(listToolNames('planner')).toContain('create_task');
    expect(listToolNames('planner')).not.toContain('split_task');
    expect(listToolNames('reviewer')).toContain('create_task');
    expect(listToolNames('reviewer')).not.toContain('split_task');
    expect(listToolNames('triage')).toEqual([]);
  });

  test('each shape’s agent hands over with its own tool, and only the planner can reshape a task', () => {
    expect(listToolNames('investigator')).toContain('report_diagnosis');
    expect(listToolNames('researcher')).toContain('submit_report');
    expect(listToolNames('researcher')).not.toContain('wait_for');
    expect(listToolNames('operator')).toContain('report_outcome');
    expect(listToolNames('planner')).toContain('reshape_task');
    expect(listToolNames('builder')).not.toContain('reshape_task');
  });

  test('every step agent can schedule work; every one but the reviewer can ask for a secret', () => {
    for (const role of ['planner', 'builder', 'fixer', 'shipper', 'answerer'] as const) {
      expect(listToolNames(role)).toContain('set_schedule');
      expect(listToolNames(role)).toContain('request_secret');
    }
    for (const tool of ['set_schedule', 'list_schedules', 'delete_schedule'] as const) {
      expect(listToolNames('reviewer')).toContain(tool);
    }
    expect(listToolNames('reviewer')).not.toContain('request_secret');
  });

  test('every step agent and every delegated agent can read another task', () => {
    for (const role of ['planner', 'builder', 'reviewer', 'fixer', 'shipper', 'answerer'] as const) {
      expect(listToolNames(role)).toContain('read_task');
      expect(listToolNames(role, 2)).toContain('read_task');
    }
    expect(listToolNames('triage')).not.toContain('read_task');
  });

  test('names every tool the agents can be given, schedules and secrets included', () => {
    const offered = new Set(
      (
        [
          'planner',
          'builder',
          'reviewer',
          'fixer',
          'shipper',
          'answerer',
          'investigator',
          'researcher',
          'operator',
        ] as const
      ).flatMap((role) => listToolNames(role))
    );
    expect([...SHINSA_TOOL_NAMES].sort()).toEqual([...offered].sort());
    for (const name of ['set_schedule', 'list_schedules', 'delete_schedule', 'request_secret']) {
      expect(isShinsaToolName(name)).toBe(true);
    }
    expect(isShinsaToolName('Bash')).toBe(false);
  });
});
