import { describe, expect, test } from 'bun:test';
import { sortAdmissionQueue, type Task } from '../../src/index.ts';
import { createHarness, createTask } from '../harness.ts';

function queueOf(order: string[]) {
  const harness = createHarness();
  harness.send({ type: 'settings.change', patch: { projectOrder: order } });
  const base = harness.task(createTask(harness));
  const make = (id: string, patch: Partial<Task>): Task => ({ ...base, id, waitsOn: [], ...patch });
  return { harness, make };
}

describe('the admission queue', () => {
  test('puts urgent first, then the project rank, then priority, then what it unblocks, then age', () => {
    const { harness, make } = queueOf(['p-main', 'p-side']);
    const tasks = [
      make('old-low-side', { projectId: 'p-side', priority: 'low', createdAt: 1 }),
      make('unranked-high', { projectId: 'p-other', priority: 'high', createdAt: 1 }),
      make('main-normal-new', { projectId: 'p-main', priority: 'normal', createdAt: 9 }),
      make('main-normal-old', { projectId: 'p-main', priority: 'normal', createdAt: 5 }),
      make('main-high', { projectId: 'p-main', priority: 'high', createdAt: 9 }),
      make('side-urgent', { projectId: 'p-side', priority: 'urgent', createdAt: 9 }),
      make('no-project', { projectId: null, priority: 'high', createdAt: 0 }),
    ];
    expect(sortAdmissionQueue(harness.state, tasks).map((task) => task.id)).toEqual([
      'side-urgent',
      'main-high',
      'main-normal-old',
      'main-normal-new',
      'old-low-side',
      'no-project',
      'unranked-high',
    ]);
  });

  test('within the same rank, a task others wait on goes first, then the id breaks a tie', () => {
    const { harness, make } = queueOf([]);
    const blocker = make('b-blocker', { createdAt: 5 });
    const plain = make('a-plain', { createdAt: 5 });
    const twin = make('c-twin', { createdAt: 5 });
    harness.state.tasks.waiter = make('waiter', { waitsOn: ['b-blocker'] });
    expect(sortAdmissionQueue(harness.state, [twin, plain, blocker]).map((task) => task.id)).toEqual([
      'b-blocker',
      'a-plain',
      'c-twin',
    ]);
  });
});
