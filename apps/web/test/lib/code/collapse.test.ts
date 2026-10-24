import { describe, expect, it } from 'bun:test';
import { listCollapsedRanges, selectRangeAt } from '@/lib/code/collapse.ts';

describe('listCollapsedRanges', () => {
  it('folds unchanged stretches, keeping three lines around each change and anything asked to stay', () => {
    expect(listCollapsedRanges(40, [{ from: 10, to: 11 }], new Set())).toEqual([
      { from: 1, to: 6 },
      { from: 15, to: 40 },
    ]);
    expect(
      listCollapsedRanges(
        40,
        [
          { from: 10, to: 11 },
          { from: 30, to: 30 },
        ],
        new Set([15])
      )
    ).toEqual([
      { from: 1, to: 6 },
      { from: 34, to: 40 },
    ]);
  });

  it('never folds fewer than four lines', () => {
    expect(listCollapsedRanges(15, [{ from: 5, to: 5 }], new Set())).toEqual([{ from: 9, to: 15 }]);
    expect(listCollapsedRanges(10, [{ from: 5, to: 5 }], new Set())).toEqual([]);
  });

  it('finds the fold a line is in', () => {
    const ranges = [{ from: 1, to: 6 }];
    expect(selectRangeAt(ranges, 3)).toEqual({ from: 1, to: 6 });
    expect(selectRangeAt(ranges, 8)).toBeNull();
  });
});
