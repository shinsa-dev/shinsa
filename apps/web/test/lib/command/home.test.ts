import { describe, expect, it } from 'bun:test';
import { briefingKey, type Gate, type ShinsaState, type Task } from '@shinsa/core';
import { listHomeSections } from '@/lib/command/home.ts';
import { resolveTaskStatus } from '@/lib/tasks/status.ts';
import { createGate, createRepo, createShinsaState, createTask, NOW } from '../../support/state.ts';

function waiting(
  ids: string[],
  extra: { tasks?: Task[]; gates?: Gate[]; patch?: Partial<ShinsaState> } = {}
) {
  const tasks = ids.map((id) => createTask({ id, title: `Task ${id}` }));
  const gates = ids.map((id, index) => createGate({ id: `g-${id}`, taskId: id, openedAt: index }));
  return createShinsaState({
    tasks: [...tasks, ...(extra.tasks ?? [])],
    gates: [...gates, ...(extra.gates ?? [])],
    repos: [createRepo({ id: 'r1', name: 'web' })],
    patch: extra.patch,
  });
}

function listShownIds(state: ShinsaState) {
  return listHomeSections(state)[0]?.commands.map((command) => command.taskId) ?? [];
}

describe('listHomeSections', () => {
  it('lists nothing when no task needs you', () => {
    expect(listHomeSections(createShinsaState({ tasks: [createTask({ id: 'a' })] }))).toEqual([]);
  });

  it('lists the tasks that need you in queue order, each opening its task', () => {
    const state = waiting(['a', 'b']);
    const [section] = listHomeSections(state);
    expect(section).toMatchObject({ id: 'home.needs', heading: 'Needs you', rank: 0 });
    const task = state.tasks.a as Task;
    expect(section?.commands[0]).toEqual({
      kind: 'go',
      id: 'home.task.a',
      label: 'Task a',
      trailing: resolveTaskStatus(state, task).label,
      taskId: 'a',
      keywords: [resolveTaskStatus(state, task).label, '', 'needs you', 'decision', 'open'],
      to: '/tasks/a',
    });
    expect(listShownIds(state)).toEqual(['a', 'b']);
  });

  it('names the repository as the hint when the task has one', () => {
    const state = waiting([], {
      tasks: [createTask({ id: 'a', repoId: 'r1', branch: 'fix/a' })],
      gates: [createGate({ id: 'g', taskId: 'a' })],
    });
    expect(listHomeSections(state)[0]?.commands[0]).toMatchObject({ hint: 'web' });
    expect(listHomeSections(state)[0]?.commands[0]?.keywords).toContain('fix/a');
  });

  it('puts the briefing’s Now task first', () => {
    const state = waiting(['a', 'b', 'c'], {
      patch: {
        briefings: {
          [briefingKey(null)]: {
            text: '',
            at: NOW,
            briefing: {
              now: { taskId: 'c', why: 'Unblocks the release' },
              next: [],
              running: '',
              note: null,
            },
          },
        },
      },
    });
    expect(listShownIds(state)).toEqual(['c', 'a', 'b']);
  });

  it('lists a task with several open decisions once', () => {
    const state = waiting(['a', 'b'], {
      gates: [createGate({ id: 'g-a2', taskId: 'a', kind: 'merge', openedAt: 9 })],
    });
    expect(listShownIds(state)).toEqual(['a', 'b']);
  });

  it('lists at most eight', () => {
    const state = waiting(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
    expect(listShownIds(state)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });
});
