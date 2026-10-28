import { describe, expect, it } from 'bun:test';
import {
  findTaskTarget,
  IDLE_PREFETCH_TASKS,
  listIdleTasks,
  resolveSelectedTask,
} from '@/lib/tasks/prefetch.ts';
import { createGate, createRun, createShinsaState, createTask } from '../../support/state.ts';

describe('findTaskTarget', () => {
  it('finds the task of the row under the pointer', () => {
    document.body.innerHTML = `
      <button id="row"><span data-task="t-1">SW-1 · </span><span id="title">Fix it</span></button>
      <a id="link" data-task="t-2">SW-2</a>
      <div id="plain"><span id="inside">Nothing</span></div>
      <button id="bare"><span id="label">No task</span></button>`;
    try {
      expect(findTaskTarget(document.getElementById('title'))).toBe('t-1');
      expect(findTaskTarget(document.getElementById('link'))).toBe('t-2');
      expect(findTaskTarget(document.getElementById('inside'))).toBeNull();
      expect(findTaskTarget(document.getElementById('label'))).toBeNull();
      expect(findTaskTarget(null)).toBeNull();
      expect(findTaskTarget(window)).toBeNull();
    } finally {
      document.body.replaceChildren();
    }
  });
});

describe('listIdleTasks', () => {
  it('lists the tasks waiting for you first, then the ones agents work on, a few at most', () => {
    const tasks = Array.from({ length: 6 }, (_, index) =>
      createTask({ id: `t-${index}`, stage: index < 2 ? 'awaiting_review' : 'building' })
    );
    const gates = [
      createGate({ id: 'g-0', taskId: 't-0', type: 'review' }),
      createGate({ id: 'g-1', taskId: 't-1', type: 'review' }),
    ];
    const runs = tasks.slice(2).map((task) => createRun({ id: `r-${task.id}`, taskId: task.id }));
    const ids = listIdleTasks(createShinsaState({ tasks, gates, runs }), Date.now());
    expect(ids).toHaveLength(IDLE_PREFETCH_TASKS);
    expect(new Set(ids).size).toBe(ids.length);
    expect(['t-0', 't-1']).toContain(ids[0] ?? '');
    expect(ids.at(-1)?.startsWith('t-')).toBe(true);
  });
});

describe('resolveSelectedTask', () => {
  it('reads the task of a highlighted ⌘K row', () => {
    expect(resolveSelectedTask('task:t-1')).toBe('t-1');
    expect(resolveSelectedTask('recent:t-2')).toBe('t-2');
    expect(resolveSelectedTask('jump:t-3')).toBe('t-3');
    expect(resolveSelectedTask('command:theme')).toBeNull();
  });
});
