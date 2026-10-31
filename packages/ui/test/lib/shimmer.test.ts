import { describe, expect, it } from 'bun:test';
import { resolveShimmerTiming, SHIMMER_STEP } from '../../src/lib/shimmer';

describe('resolveShimmerTiming', () => {
  it('crosses a short line in one duration, as it always has', () => {
    expect(resolveShimmerTiming(10, 1)).toEqual({ stagger: 0.1, rest: 10 * SHIMMER_STEP });
  });

  it('keeps the band moving across a long line instead of crossing it in one duration and resting', () => {
    const { stagger, rest } = resolveShimmerTiming(80, 1);
    expect(stagger).toBe(SHIMMER_STEP);
    expect(80 * stagger).toBe(rest);
  });

  it('times a line with nothing visible as still', () => {
    expect(resolveShimmerTiming(0, 1)).toEqual({ stagger: 0, rest: 0 });
  });
});
