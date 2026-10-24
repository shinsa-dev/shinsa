import { describe, expect, test } from 'bun:test';
import type { RunRole } from '../../src/index.ts';
import { describeTaskLink } from '../../src/prompts/context.ts';
import { MANAGE_RULES } from '../../src/prompts/index.ts';
import { resolveHouseRules } from '../../src/prompts/rules.ts';
import { createHarness, createTask } from '../harness.ts';

const ROLES: RunRole[] = [
  'planner',
  'builder',
  'reviewer',
  'fixer',
  'answerer',
  'investigator',
  'researcher',
  'operator',
];

describe('the management rules', () => {
  test('give the agent every command-line action as a tool and leave the human’s decisions at their gates', () => {
    expect(MANAGE_RULES).toContain(
      'Every action of the `shinsa` command line but the human’s own decisions is one of your tools'
    );
    expect(MANAGE_RULES).toContain('mark it done with `tasks_done`');
    expect(MANAGE_RULES).toContain('recorded as done on the human’s behalf from this task');
    expect(MANAGE_RULES).toContain('You have no tool and no command for them.');
    expect(MANAGE_RULES).toContain(
      'reply that they do it at its gate in Shinsa and link the task where it waits'
    );
  });

  test('are part of every role’s house rules', () => {
    for (const role of ROLES) expect(resolveHouseRules(role)).toContain(MANAGE_RULES);
  });
});

describe('the link to the task itself', () => {
  test('names the handle before the title once the task has one', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { request: 'Ship the API' });
    expect(describeTaskLink(harness.task(taskId))).toBe(
      `This task: SUP-1, [Ship the API](shinsa://task/${taskId}).`
    );
    expect(describeTaskLink({ ...harness.task(taskId), handle: null })).toBe(
      `This task: [Ship the API](shinsa://task/${taskId}).`
    );
  });
});
