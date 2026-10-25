import { describe, expect, it, mock } from 'bun:test';
import { createCache, createScopedCache } from '@/lib/format/cache.ts';

describe('createCache', () => {
  it('creates a value once, keeps the most recently read ones and drops the oldest past its limit', () => {
    const cache = createCache<number>(2);
    const create = mock(() => 1);
    expect(cache.read('a', create)).toBe(1);
    expect(cache.read('a', create)).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
    cache.read('b', () => 2);
    cache.read('a', create);
    cache.read('c', () => 3);
    expect(cache.peek('a')).toBe(1);
    expect(cache.peek('b')).toBeUndefined();
    expect(cache.size()).toBe(2);
  });
});

describe('createScopedCache', () => {
  it('keeps one cache per scope object', () => {
    const scoped = createScopedCache<object, string>(4);
    const one = {};
    const two = {};
    scoped(one).read('k', () => 'one');
    expect(scoped(one).peek('k')).toBe('one');
    expect(scoped(two).peek('k')).toBeUndefined();
  });
});
