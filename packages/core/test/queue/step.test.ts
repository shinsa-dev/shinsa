import { describe, expect, test } from 'bun:test';
import { listDecisionOrder, type Queue, type QueuedGate, resolveQueueStep } from '../../src/index.ts';

function entry(taskId: string, gateId: string) {
  return { gate: { id: gateId }, task: { id: taskId } } as unknown as QueuedGate;
}

describe('listDecisionOrder', () => {
  test('keeps the ready order and lists a task once', () => {
    const queue = {
      ready: [entry('a', 'g1'), entry('b', 'g2'), entry('a', 'g3'), entry('c', 'g4')],
    } as Queue;
    expect(listDecisionOrder(queue)).toEqual(['a', 'b', 'c']);
  });
});

describe('resolveQueueStep', () => {
  test('places a task that needs you among the others', () => {
    expect(resolveQueueStep(['a', 'b', 'c'], 'b')).toEqual({
      position: 2,
      total: 3,
      previousId: 'a',
      nextId: 'c',
    });
    expect(resolveQueueStep(['a', 'b', 'c'], 'c')).toEqual({
      position: 3,
      total: 3,
      previousId: 'b',
      nextId: null,
    });
  });

  test('from a task outside the queue, next is the first that needs you', () => {
    expect(resolveQueueStep(['a', 'b'], 'x')).toEqual({
      position: null,
      total: 2,
      previousId: null,
      nextId: 'a',
    });
    expect(resolveQueueStep([], 'x')).toEqual({ position: null, total: 0, previousId: null, nextId: null });
  });
});
