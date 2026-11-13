import { describe, expect, test } from 'bun:test';
import { describePhaseProgress, NO_PHASE_NAME, resolveInitiativeTotals } from '../../src/index.ts';

const DOCK = { id: 'p1', name: 'Dock' };

describe('initiative progress', () => {
  test('counts shipped out of the tasks still planned, beside the dropped ones', () => {
    expect(describePhaseProgress({ phase: DOCK, total: 2, shipped: 0, dropped: 1 })).toEqual({
      name: 'Dock',
      detail: '0 of 1 shipped · 1 dropped',
    });
    expect(describePhaseProgress({ phase: null, total: 3, shipped: 1, dropped: 0 })).toEqual({
      name: NO_PHASE_NAME,
      detail: '1 of 3 shipped',
    });
    expect(describePhaseProgress({ phase: DOCK, total: 1, shipped: 0, dropped: 1 }).detail).toBe('1 dropped');
    expect(describePhaseProgress({ phase: DOCK, total: 0, shipped: 0, dropped: 0 }).detail).toBe(
      'No tasks yet'
    );
  });

  test('adds the phases up', () => {
    expect(
      resolveInitiativeTotals([
        { phase: DOCK, total: 3, shipped: 1, dropped: 1 },
        { phase: null, total: 2, shipped: 0, dropped: 0 },
      ])
    ).toEqual({ total: 5, shipped: 1, dropped: 1, open: 3 });
  });
});
