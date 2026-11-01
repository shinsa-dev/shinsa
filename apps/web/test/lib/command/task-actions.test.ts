import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { listTaskActionCommands } from '@/lib/command/task-actions.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { spyOnEngine } from '../../support/engine.ts';
import { createShinsaState, createTask } from '../../support/state.ts';

let spies: ReturnType<typeof spyOnCommands>;
let engine: ReturnType<typeof spyOnEngine>;

beforeEach(() => {
  spies = spyOnCommands();
  engine = spyOnEngine();
});

afterEach(() => {
  spies.restore();
  engine.mockRestore();
});

describe('task action commands', () => {
  it('lists priority, messaging and every action the task menu has, in its order', () => {
    const task = createTask({
      id: 't',
      branch: 'feat/x',
      worktreePath: '/tmp/t',
      pullRequest: { number: 7, url: 'https://github.com/a/b/pull/7' } as never,
    });
    const state = createShinsaState({ tasks: [task] });
    expect(
      listTaskActionCommands(state, task).map((command) => [command.kind, command.label, command.hint])
    ).toEqual([
      ['choice', 'Set priority', 'Normal'],
      ['page', 'Message the agent', undefined],
      ['link', 'Open the pull request on GitHub', '#7'],
      ['run', 'Copy branch name', 'feat/x'],
      ['run', 'Open in editor', undefined],
      ['run', 'Open a terminal', undefined],
      ['run', 'Show in Finder', undefined],
      ['run', 'Fork into a new task', undefined],
      ['run', 'Share task', undefined],
      ['run', 'Snooze', undefined],
      ['run', 'Restart the current step', undefined],
      ['run', 'Mark as done', undefined],
      ['run', 'Close as a duplicate', undefined],
      ['page', 'Cancel task', undefined],
    ]);
  });

  it('keeps only the priority for a closed task without links', () => {
    const task = createTask({ id: 't', stage: 'done', closedAt: 1 });
    expect(
      listTaskActionCommands(createShinsaState({ tasks: [task] }), task).map((command) => command.label)
    ).toEqual(['Set priority', 'Fork into a new task', 'Share task']);
  });

  it('leaves out Share task when the task’s engine does not speak it', () => {
    engine.mockReturnValue(null);
    const task = createTask({ id: 't', stage: 'done', closedAt: 1 });
    expect(
      listTaskActionCommands(createShinsaState({ tasks: [task] }), task).map((command) => command.label)
    ).toEqual(['Set priority', 'Fork into a new task']);
  });
});
