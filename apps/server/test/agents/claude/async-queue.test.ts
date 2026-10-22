import { describe, expect, test } from 'bun:test';
import { AsyncQueue } from '../../../src/agents/claude/async-queue.ts';

describe('AsyncQueue', () => {
  test('hands items to a waiting reader or buffers them, and ends on close', async () => {
    const queue = new AsyncQueue<number>();
    const iterator = queue[Symbol.asyncIterator]();
    const waiting = iterator.next();
    queue.push(1);
    queue.push(2);
    expect(await waiting).toEqual({ value: 1, done: false });
    expect(await iterator.next()).toEqual({ value: 2, done: false });
    const pending = iterator.next();
    queue.close();
    queue.push(3);
    expect(await pending).toEqual({ value: undefined, done: true });
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });
});
