import { describe, expect, it } from 'bun:test';
import { listFailures, serializeWaitTable, summarizeWaits } from './loading-stats.ts';

describe('summarizeWaits', () => {
  it('groups the waits by step and label and keeps the longest', () => {
    const rows = summarizeWaits(
      [
        { label: 'Reading the code…', step: 'Code', at: 4, duration: 30 },
        { label: 'Reading the code…', step: 'Code', at: 90, duration: 12 },
        { label: 'Searching', step: 'Search (cold)', at: 320, duration: 400, open: true },
        { label: 'blank: Reading the code…', step: 'Code', at: 0, duration: 20 },
      ],
      new Set(['Search (cold)'])
    );
    expect(rows).toEqual([
      { step: 'Code', label: 'Reading the code…', count: 2, longest: 30, allowed: false },
      { step: 'Search (cold)', label: 'Searching', count: 1, longest: 400, allowed: true },
      { step: 'Code', label: 'blank: Reading the code…', count: 1, longest: 20, allowed: true },
    ]);
    expect(listFailures(rows).map((row) => row.step)).toEqual(['Code']);
  });
});

describe('serializeWaitTable', () => {
  it('says when nothing was shown', () => {
    expect(serializeWaitTable([])).toBe('No loading state was shown.');
  });

  it('renders a row per wait', () => {
    const table = serializeWaitTable([
      { step: 'Code', label: 'Reading the code…', count: 2, longest: 30.4, allowed: false },
      { step: 'Search (cold)', label: 'Searching', count: 1, longest: 400, allowed: true },
      { step: 'Code', label: 'blank: Reading the code…', count: 1, longest: 20, allowed: true },
    ]);
    expect(table).toContain('| Code | Reading the code… | 2 | 30 ms | no |');
    expect(table).toContain('| Search (cold) | Searching | 1 | 400 ms | cold read |');
    expect(table).toContain('| Code | blank: Reading the code… | 1 | 20 ms | blank, under 300 ms |');
  });
});
