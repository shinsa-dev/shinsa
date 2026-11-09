import { describe, expect, test } from 'bun:test';
import {
  DAY_MS,
  ENGAGEMENT_LIMITS,
  type Gate,
  HOUR_MS,
  resolveProjectResponses,
  sortAdmissionQueue,
  type Task,
} from '../../src/index.ts';
import { createHarness, createTask } from '../harness.ts';

const NOW = 100 * DAY_MS;

function queueOf() {
  const harness = createHarness();
  const base = harness.task(createTask(harness));
  const make = (id: string, patch: Partial<Task>): Task => ({ ...base, id, waitsOn: [], ...patch });
  const answer = (
    projectId: string,
    waitMs: number,
    answeredAt = NOW - HOUR_MS,
    count: number = ENGAGEMENT_LIMITS.minAnswers
  ) => {
    const owner = make(`owner-${projectId}-${waitMs}-${answeredAt}`, { projectId });
    harness.state.tasks[owner.id] = owner;
    for (let index = 0; index < count; index += 1) {
      const id = `${owner.id}-${index}`;
      const gate = { id, taskId: owner.id, openedAt: answeredAt - waitMs, answeredAt };
      harness.state.gates[id] = gate as Gate;
    }
  };
  return { harness, make, answer };
}

function idsOf(tasks: Task[]) {
  return tasks.map((task) => task.id);
}

describe('the admission queue', () => {
  test('ranks by priority, then the focus project, then the projects you answer fastest, then what it unblocks, then age', () => {
    const { harness, make, answer } = queueOf();
    answer('p-fast', HOUR_MS);
    answer('p-slow', 10 * HOUR_MS);
    harness.state.focus = { projectIds: ['p-focus'], except: false, teamId: null, until: null };
    const tasks = [
      make('slow-high', { projectId: 'p-slow', priority: 'high', createdAt: 1 }),
      make('fast-high', { projectId: 'p-fast', priority: 'high', createdAt: 9 }),
      make('focus-high', { projectId: 'p-focus', priority: 'high', createdAt: 9 }),
      make('unknown-high', { projectId: 'p-unknown', priority: 'high', createdAt: 0 }),
      make('fast-normal', { projectId: 'p-fast', priority: 'normal', createdAt: 0 }),
      make('slow-urgent', { projectId: 'p-slow', priority: 'urgent', createdAt: 9 }),
      make('no-project-low', { projectId: null, priority: 'low', createdAt: 0 }),
    ];
    expect(idsOf(sortAdmissionQueue(harness.state, tasks, NOW))).toEqual([
      'slow-urgent',
      'focus-high',
      'fast-high',
      'slow-high',
      'unknown-high',
      'fast-normal',
      'no-project-low',
    ]);
  });

  test('learns a project only from enough recent answers', () => {
    const { harness, answer } = queueOf();
    answer('p-few', HOUR_MS, NOW - HOUR_MS, ENGAGEMENT_LIMITS.minAnswers - 1);
    answer('p-old', HOUR_MS, NOW - ENGAGEMENT_LIMITS.windowMs - HOUR_MS);
    answer('p-known', 2 * HOUR_MS);
    const responses = resolveProjectResponses(harness.state, NOW);
    expect([...responses.keys()]).toEqual(['p-known']);
    expect(responses.get('p-known')).toBe(2 * HOUR_MS);
    expect(resolveProjectResponses(harness.state, NOW)).toBe(responses);
  });

  test('forgets answers once they leave the window, and reads the tasks again when they change', () => {
    const { harness, answer } = queueOf();
    answer('p-known', 2 * HOUR_MS, NOW - HOUR_MS);
    expect([...resolveProjectResponses(harness.state, NOW).keys()]).toEqual(['p-known']);
    expect(resolveProjectResponses(harness.state, NOW + 30 * DAY_MS).size).toBe(0);
    expect(resolveProjectResponses(harness.state, NOW - HOUR_MS).size).toBe(1);
    const moved = Object.fromEntries(
      Object.entries(harness.state.tasks).map(([id, task]) => [id, { ...task, projectId: 'p-other' }])
    );
    expect([...resolveProjectResponses({ ...harness.state, tasks: moved }, NOW).keys()]).toEqual(['p-other']);
  });

  test('within the same rank, a task others wait on goes first, then the id breaks a tie', () => {
    const { harness, make } = queueOf();
    const blocker = make('b-blocker', { createdAt: 5 });
    const plain = make('a-plain', { createdAt: 5 });
    const twin = make('c-twin', { createdAt: 5 });
    harness.state.tasks.waiter = make('waiter', { waitsOn: ['b-blocker'] });
    expect(idsOf(sortAdmissionQueue(harness.state, [twin, plain, blocker], NOW))).toEqual([
      'b-blocker',
      'a-plain',
      'c-twin',
    ]);
  });
});
