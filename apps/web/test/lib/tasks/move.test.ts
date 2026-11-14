import { describe, expect, it } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { runTaskAction, TASK_ACTION, TASK_ACTION_COMMAND } from '@/lib/tasks/actions.ts';
import {
  closeMoveDialog,
  isTaskMovable,
  listMoveChoices,
  MOVE_TITLE,
  moveTask,
  openMoveDialog,
  resolveMoveChoiceValue,
  useMoveDialog,
} from '@/lib/tasks/move.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createProject, createRepo, createShinsaState, createTask } from '../../support/state.ts';

const PROJECTS = [
  createProject({ id: 'shinsa', name: 'Shinsa' }),
  createProject({ id: 'apps', name: 'Apps' }),
];

const REPOS = [
  createRepo({ id: 'engine', name: 'shinsa', projectId: 'shinsa' }),
  createRepo({ id: 'ios', name: 'Shinsa-iOS', projectId: 'shinsa' }),
  createRepo({ id: 'admin', name: 'admin', projectId: 'shinsa' }),
  createRepo({ id: 'islands', name: 'islands', projectId: 'apps' }),
  createRepo({ id: 'loose', name: 'scratch' }),
];

const TASK = createTask({ id: 't', repoId: 'engine', projectId: 'shinsa', stage: 'planning' });

function createState(task = TASK, patch = {}) {
  return createShinsaState({ tasks: [task], repos: REPOS, projects: PROJECTS, patch });
}

describe('the move dialog', () => {
  it('opens for one task from its action and closes again', () => {
    const { result } = renderHook(() => useMoveDialog());
    expect(result.current).toBeNull();
    act(() => openMoveDialog('t'));
    expect(result.current).toBe('t');
    act(() => closeMoveDialog());
    expect(result.current).toBeNull();
    act(() => runTaskAction(TASK, 'move'));
    expect(result.current).toBe('t');
    act(() => closeMoveDialog());
    expect(TASK_ACTION.move).toEqual({ label: MOVE_TITLE, icon: 'IconFolder1' });
    expect(TASK_ACTION_COMMAND.move).toBe('task.move_to_repository');
  });
});

describe('listMoveChoices', () => {
  it('lists the project’s other repositories first by name, then the rest by project, never its own', () => {
    const choices = listMoveChoices(createState(), TASK);
    expect(choices.map((choice) => [choice.repo.id, choice.hint])).toEqual([
      ['admin', 'This project'],
      ['ios', 'This project'],
      ['islands', 'Moves to Apps'],
      ['loose', 'Moves to No project'],
    ]);
  });

  it('leaves out a teammate’s repository', () => {
    const state = createState(TASK, { teammateRepos: { islands: 'k3x9' } });
    expect(listMoveChoices(state, TASK).map((choice) => choice.repo.id)).not.toContain('islands');
  });

  it('searches by the repository, its project and its id', () => {
    const state = createState();
    expect(resolveMoveChoiceValue(state, REPOS[3]!)).toBe('islands Apps islands');
    expect(resolveMoveChoiceValue(state, REPOS[4]!)).toBe('scratch No project loose');
  });
});

describe('isTaskMovable', () => {
  it('allows a task with a repository that has not started real work', () => {
    expect(isTaskMovable(createState(), TASK)).toBe(true);
  });

  it('refuses once a phase reported, a result is handed over, it is settled or it has no repository', () => {
    const cases = [
      { ...TASK, phaseReports: [{} as never] },
      { ...TASK, result: {} as never },
      { ...TASK, stage: 'merged' as const },
      { ...TASK, repoId: null },
      { ...TASK, movingTo: 'ios' },
      { ...TASK, stacksOn: ['other'] },
    ];
    for (const task of cases) expect(isTaskMovable(createState(task), task)).toBe(false);
  });

  it('refuses when there is no other repository to go to', () => {
    const state = createShinsaState({ tasks: [TASK], repos: [REPOS[0]!], projects: PROJECTS });
    expect(isTaskMovable(state, TASK)).toBe(false);
  });
});

describe('moveTask', () => {
  it('sends the move with a toast naming the repository', () => {
    const spies = spyOnCommands();
    void moveTask(TASK, REPOS[3]!);
    expect(spies.sent).toHaveBeenCalledWith(
      { type: 'task.move_to_repository', taskId: 't', repoId: 'islands' },
      'Moving to islands.'
    );
  });
});
