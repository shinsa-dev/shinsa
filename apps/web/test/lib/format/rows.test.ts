import { describe, expect, it } from 'bun:test';
import {
  isCoveringWindows,
  isSameRange,
  isSameWindows,
  resolveOverscanRows,
  resolveRowWindow,
  resolveSectionWindows,
} from '@/lib/format/rows.ts';

describe('resolveRowWindow', () => {
  it('covers the rows in view with some to spare, in whole chunks', () => {
    expect(resolveRowWindow(0, 360, 300, 36)).toEqual({ start: 0, end: 24 });
    expect(resolveRowWindow(-3600, 360, 300, 36)).toEqual({ start: 88, end: 128 });
    expect(resolveRowWindow(-3600, 360, 100, 36)).toEqual({ start: 88, end: 100 });
    expect(resolveRowWindow(2000, 360, 300, 36)).toEqual({ start: 0, end: 0 });
    expect(resolveRowWindow(0, 0, 0, 36)).toEqual({ start: 0, end: 0 });
  });

  it('tells two windows apart', () => {
    expect(isSameRange({ start: 0, end: 8 }, { start: 0, end: 8 })).toBe(true);
    expect(isSameRange({ start: 0, end: 8 }, { start: 8, end: 16 })).toBe(false);
    expect(isSameWindows([{ start: 0, end: 8 }], [{ start: 0, end: 8 }])).toBe(true);
    expect(isSameWindows([{ start: 0, end: 8 }], [{ start: 0, end: 16 }])).toBe(false);
    expect(isSameWindows([{ start: 0, end: 8 }], [])).toBe(false);
  });

  it('keeps a viewport of rows on each side once the viewport is taller than 12 rows', () => {
    expect(resolveOverscanRows(360, 36)).toBe(12);
    expect(resolveOverscanRows(900, 36)).toBe(25);
    expect(resolveRowWindow(-3600, 900, 300, 36)).toEqual({ start: 72, end: 152 });
  });

  it('tells whether the rows drawn still cover the rows in view', () => {
    expect(isCoveringWindows([{ start: 0, end: 40 }], [{ start: 8, end: 24 }])).toBe(true);
    expect(isCoveringWindows([{ start: 0, end: 40 }], [{ start: 32, end: 48 }])).toBe(false);
    expect(isCoveringWindows([{ start: 16, end: 40 }], [{ start: 8, end: 24 }])).toBe(false);
    expect(isCoveringWindows([{ start: 16, end: 40 }], [{ start: 0, end: 0 }])).toBe(true);
    expect(isCoveringWindows([], [{ start: 0, end: 8 }])).toBe(false);
  });

  it('windows each section from its own top, an unmeasured one from its first row', () => {
    expect(resolveSectionWindows([-3600, 2000], 360, [300, 40], 36)).toEqual([
      { start: 88, end: 128 },
      { start: 0, end: 0 },
    ]);
    expect(resolveSectionWindows([], 360, [30], 36)).toEqual([{ start: 0, end: 24 }]);
  });
});
