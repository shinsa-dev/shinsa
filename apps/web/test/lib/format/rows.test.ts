import { describe, expect, it } from 'bun:test';
import { isSameRange, resolveRowWindow } from '@/lib/format/rows.ts';

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
  });
});
