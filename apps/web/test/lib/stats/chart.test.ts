import { describe, expect, it } from 'bun:test';
import { resolveAreaGeometry, resolveChartMax, resolveNearestIndex } from '@/lib/stats/chart.ts';

describe('stats charts', () => {
  it('rounds the top of the scale up to a readable number', () => {
    expect(resolveChartMax([])).toBe(4);
    expect(resolveChartMax([0, 3])).toBe(4);
    expect(resolveChartMax([7])).toBe(7);
    expect(resolveChartMax([12])).toBe(20);
    expect(resolveChartMax([1_234_567])).toBe(2_000_000);
  });

  it('draws the line and the area under it across the box', () => {
    const geometry = resolveAreaGeometry([0, 2, 4], { width: 100, height: 40 });
    expect(geometry.max).toBe(4);
    expect(geometry.points).toEqual([
      { x: 0, y: 40 },
      { x: 50, y: 20 },
      { x: 100, y: 0 },
    ]);
    expect(geometry.line).toBe('M0 40 L50 20 L100 0');
    expect(geometry.area).toBe('M0 40 L50 20 L100 0 L100 40 L0 40 Z');
  });

  it('centres a single point, and draws nothing without one', () => {
    expect(resolveAreaGeometry([2], { width: 100, height: 40 }).points).toEqual([{ x: 50, y: 20 }]);
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
});
