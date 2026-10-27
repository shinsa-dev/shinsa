import { describe, expect, test } from 'bun:test';
import { WorkspaceLock } from '../../src/workspaces/lock.ts';

describe('the workspace lock', () => {
  test('one owner at a time per key; the same owner may take it again; others wait their turn', async () => {
    const lock = new WorkspaceLock();
    const first = await lock.acquire('repo-1', 'task-1');
    const nested = await lock.acquire('repo-1', 'task-1');
    const elsewhere = await lock.acquire('repo-2', 'task-2');
    const order: string[] = [];
    const second = lock.acquire('repo-1', 'task-2').then((release) => {
      order.push('task-2');
      return release;
    });
    nested();
    nested();
    await Bun.sleep(0);
    expect(order).toEqual([]);
    expect(lock.selectOwner('repo-1')).toBe('task-1');
    first();
    (await second)();
    elsewhere();
    expect(order).toEqual(['task-2']);
    expect(lock.selectOwner('repo-1')).toBeNull();
  });

  test('a waiter that is cancelled stops waiting, and one cancelled before it starts never takes it', async () => {
    const lock = new WorkspaceLock();
    const held = await lock.acquire('repo-1', 'task-1');
    const cancel = new AbortController();
    const waiting = lock.acquire('repo-1', 'task-2', cancel.signal);
    cancel.abort(new Error('stopped'));
    await expect(waiting).rejects.toThrow('stopped');
    await expect(lock.acquire('repo-1', 'task-3', cancel.signal)).rejects.toThrow('stopped');
    held();
    const open = new AbortController();
    const next = await lock.acquire('repo-1', 'task-2', open.signal);
    next();
  });
});
