import { describe, expect, it } from 'bun:test';
import { DAY_MS, HOUR_MS, MINUTE_MS, type Turnaround } from '@shinsa/core';
import { formatTurnaround, listTurnaroundTiles } from '@/lib/stats/turnaround.ts';

const EMPTY: Turnaround = {
  startToFinish: { median: null, count: 0 },
  agentTime: { median: null, count: 0 },
  yourTurnaround: { median: null, count: 0 },
  waitingShare: null,
};

describe('turnaround', () => {
  it('reads minutes, hours with minutes, then days to one decimal', () => {
    expect(formatTurnaround(10_000)).toBe('1m');
    expect(formatTurnaround(45 * MINUTE_MS)).toBe('45m');
    expect(formatTurnaround(5 * HOUR_MS)).toBe('5h');
    expect(formatTurnaround(5 * HOUR_MS + 20 * MINUTE_MS)).toBe('5h 20m');
    expect(formatTurnaround(3.2 * DAY_MS)).toBe('3.2d');
    expect(formatTurnaround(2 * DAY_MS)).toBe('2d');
  });

  it('shows each median with what it is drawn from', () => {
    const tiles = listTurnaroundTiles({
      startToFinish: { median: 5 * HOUR_MS + 20 * MINUTE_MS, count: 12 },
      agentTime: { median: 3 * HOUR_MS, count: 12 },
      yourTurnaround: { median: 45 * MINUTE_MS, count: 1 },
      waitingShare: 0.3,
    });
    expect(tiles.map((tile) => [tile.label, tile.value, tile.detail])).toEqual([
      ['Start to finish', '5h 20m', 'Over 12 rounds'],
      ['Your turnaround', '45m', 'Over 1 wait'],
      ['Agent time', '3h', 'Over 12 rounds'],
      ['Waiting on you', '30%', 'Of round time'],
    ]);
  });

  it('says None when nothing in the range finished or was answered', () => {
    const tiles = listTurnaroundTiles(EMPTY);
    expect(tiles.map((tile) => [tile.value, tile.detail])).toEqual([
      ['None', 'No finished rounds'],
      ['None', 'No answered waits'],
      ['None', 'No finished rounds'],
      ['None', 'No finished rounds'],
    ]);
  });
});
