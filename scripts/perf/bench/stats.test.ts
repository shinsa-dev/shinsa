import { describe, expect, it } from 'bun:test';
import { round, summarize } from './stats.ts';

describe('summarize', () => {
  it('reports the median, the 95th percentile, the largest value and the count', () => {
    expect(summarize([5, 1, 3, 2, 4])).toEqual({ p50: 3, p95: 5, max: 5, n: 5 });
  });

  it('reports zeros for no values', () => {
    expect(summarize([])).toEqual({ p50: 0, p95: 0, max: 0, n: 0 });
  });
});

describe('round', () => {
  it('keeps two decimals', () => {
    expect(round(1.23456)).toBe(1.23);
  });
});
