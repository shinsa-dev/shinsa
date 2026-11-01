import { describe, expect, it } from 'bun:test';
import { resolveShimmerDuration, SHIMMER_LONGEST, SHIMMER_STEP, SHIMMER_SWEEP } from '../../src/lib/shimmer';

describe('resolveShimmerDuration', () => {
  it('crosses a short line in one duration and rests a third of the cycle', () => {
    expect(resolveShimmerDuration(10, 1)).toBeCloseTo(1 / SHIMMER_SWEEP, 3);
  });

  it('crosses a long line at a steady pace per character', () => {
    expect(resolveShimmerDuration(60, 1)).toBeCloseTo((60 * SHIMMER_STEP) / SHIMMER_SWEEP, 3);
  });

  it('times a line longer than one screen line as the longest, since the ellipsis hides the rest', () => {
    expect(resolveShimmerDuration(500, 1)).toBe(resolveShimmerDuration(SHIMMER_LONGEST, 1));
  });

  it('times an empty line as a short one', () => {
    expect(resolveShimmerDuration(0, 1)).toBeCloseTo(1 / SHIMMER_SWEEP, 3);
  });
});
