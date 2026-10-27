import { describe, expect, test } from 'bun:test';
import { ObjectCache } from '../../src/git/objects.ts';

function text(value: string) {
  return () => Promise.resolve(value);
}

describe('ObjectCache', () => {
  test('serves a second read of the same key from memory', async () => {
    const cache = new ObjectCache();
    let reads = 0;
    const create = () => {
      reads += 1;
      return Promise.resolve('value');
    };
    expect(await cache.read('a', create, (value) => value.length)).toBe('value');
    expect(await cache.read('a', create, (value) => value.length)).toBe('value');
    expect(reads).toBe(1);
  });

  test('drops the least recently used entries once over its byte budget, never the newest', async () => {
    const cache = new ObjectCache(10);
    await cache.read('a', text('aaaa'), (value) => value.length);
    await cache.read('b', text('bbbb'), (value) => value.length);
    await cache.read('a', text('unused'), (value) => value.length);
    await cache.read('c', text('cccc'), (value) => value.length);
    expect(cache.size).toBe(2);
    expect(await cache.read('a', text('again'), (value) => value.length)).toBe('aaaa');
    expect(await cache.read('b', text('fresh'), (value) => value.length)).toBe('fresh');
    await cache.read('huge', text('x'.repeat(50)), (value) => value.length);
    expect(cache.size).toBe(1);
  });

  test('forgets a failed read, so the next one tries again', async () => {
    const cache = new ObjectCache();
    await expect(
      cache.read(
        'a',
        () => Promise.reject(new Error('gone')),
        () => 0
      )
    ).rejects.toThrow('gone');
    expect(cache.size).toBe(0);
    expect(await cache.read('a', text('back'), (value) => value.length)).toBe('back');
  });

  test('an entry evicted while it loads is not counted when it lands', async () => {
    const cache = new ObjectCache(4);
    let finish: (value: string) => void = () => {};
    const slow = cache.read(
      'slow',
      () => new Promise<string>((resolve) => (finish = resolve)),
      (value) => value.length
    );
    await cache.read('a', text('aaaa'), (value) => value.length);
    await cache.read('b', text('bbbb'), (value) => value.length);
    finish('late');
    expect(await slow).toBe('late');
    expect(cache.size).toBe(1);
  });

  test('a failure for an entry another read replaced leaves that read alone', async () => {
    const cache = new ObjectCache(4);
    let fail: (error: Error) => void = () => {};
    const failing = cache.read(
      'x',
      () => new Promise<string>((_, reject) => (fail = reject)),
      () => 0
    );
    await cache.read('a', text('aaaa'), (value) => value.length);
    await cache.read('b', text('bbbb'), (value) => value.length);
    await cache.read('x', text('xx'), (value) => value.length);
    fail(new Error('late'));
    await expect(failing).rejects.toThrow('late');
    expect(await cache.read('x', text('other'), (value) => value.length)).toBe('xx');
  });
});
