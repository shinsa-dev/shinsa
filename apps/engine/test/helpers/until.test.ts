import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { until } from './index.ts';

afterEach(() => {
  setSystemTime();
});

describe('until', () => {
  test('gives up at its deadline while the system time is frozen', async () => {
    setSystemTime(new Date(Date.now() + 60_000));
    await expect(until('a condition that never holds', () => false, 50)).rejects.toThrow(
      'Timed out waiting for a condition that never holds.'
    );
  });
});
