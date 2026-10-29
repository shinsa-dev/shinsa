import { describe, expect, it } from 'bun:test';
import {
  listAxisIndexes,
  listChartTicks,
  resolveAreaGeometry,
  resolveChartMax,
  resolveNearestIndex,
  resolvePointShare,
  resolveSmoothLine,
} from '@/lib/stats/chart.ts';

describe('stats charts', () => {
  it('rounds the top of the scale up to a close, readable number with a whole middle tick', () => {
    expect(resolveChartMax([])).toBe(4);
    expect(resolveChartMax([0, 3])).toBe(4);
    expect(resolveChartMax([7])).toBe(8);
    expect(resolveChartMax([8])).toBe(8);
    expect(resolveChartMax([11])).toBe(12);
    expect(resolveChartMax([13])).toBe(16);
    expect(resolveChartMax([15_400_000])).toBe(16_000_000);
    expect(resolveChartMax([95])).toBe(100);
    expect(listChartTicks(8)).toEqual([8, 4, 0]);
  });

  it('draws a smooth line through every point and the area under it', () => {
    const geometry = resolveAreaGeometry([0, 2, 4], { width: 100, height: 40 });
    expect(geometry.max).toBe(4);
    expect(geometry.points).toEqual([
      { x: 0, y: 40 },
      { x: 50, y: 20 },
      { x: 100, y: 0 },
    ]);
    expect(geometry.line).toBe('M0 40 C16.67 33.33 33.33 26.67 50 20 C66.67 13.33 83.33 6.67 100 0');
    expect(geometry.area).toBe(`${geometry.line} L100 40 L0 40 Z`);
  });

  it('keeps a peak or a dip flat, so the curve never overshoots the data', () => {
    const line = resolveSmoothLine([
      { x: 0, y: 40 },
      { x: 10, y: 0 },
      { x: 20, y: 40 },
    ]);
    expect(line).toBe('M0 40 C3.33 26.67 6.67 0 10 0 C13.33 0 16.67 26.67 20 40');
  });

  it('centres a single point, and draws nothing without one', () => {
    expect(resolveAreaGeometry([2], { width: 100, height: 40 }).points).toEqual([{ x: 50, y: 20 }]);
    expect(resolveAreaGeometry([2], { width: 100, height: 40 }).line).toBe('M50 20');
    expect(resolveAreaGeometry([], { width: 100, height: 40 })).toEqual({
      max: 4,
      points: [],
      line: '',
      area: '',
    });
  });

  it('finds the point nearest the pointer, kept inside the chart', () => {
    expect(resolveNearestIndex(48, 3, 100)).toBe(1);
    expect(resolveNearestIndex(-10, 3, 100)).toBe(0);
    expect(resolveNearestIndex(500, 3, 100)).toBe(2);
    expect(resolveNearestIndex(30, 1, 100)).toBe(0);
    expect(resolveNearestIndex(30, 3, 0)).toBe(0);
  });

  it('labels at most five points along the axis, the first and the last among them', () => {
    expect(listAxisIndexes(3)).toEqual([0, 1, 2]);
    expect(listAxisIndexes(30)).toEqual([0, 7, 15, 22, 29]);
    expect(resolvePointShare(0, 1)).toBe(0.5);
    expect(resolvePointShare(1, 3)).toBe(0.5);
  });
});
