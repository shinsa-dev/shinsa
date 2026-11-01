import { describe, expect, it } from 'bun:test';
import { type SoakSample, serializeSoakTable } from './soak-stats.ts';

const SAMPLE: SoakSample = {
  lap: 10,
  minutes: 12.34,
  nodes: 9000,
  heapMb: 140.06,
  idleBusy: 0.2312,
  scriptBusy: 0.051,
  recalcsPerSecond: 61.04,
  layoutsPerSecond: 0,
  transition: [
    { clickToPaint: 20, longest: 40, over34: 2, frames: 70 },
    { clickToPaint: -1, longest: 16, over34: 0, frames: 72 },
    { clickToPaint: 12, longest: 17, over34: 1, frames: 71 },
  ],
};

describe('serializeSoakTable', () => {
  it('prints one row per sample, the lower median of the tab switches that painted and every slow frame', () => {
    expect(serializeSoakTable([SAMPLE]).split('\n').slice(1)).toEqual([
      '|---|---|---|---|---|---|---|---|---|---|---|',
      '| 10 | 12.3 | 9000 | 140.1 MB | 23.1% | 5.1% | 61.0 | 0.0 | 12.0 ms | 17.0 ms | 3 |',
    ]);
  });

  it('prints zeros for a sample whose tab switches never painted', () => {
    const row = serializeSoakTable([{ ...SAMPLE, transition: [] }]).split('\n')[2];
    expect(row).toEndWith('| 0.0 ms | 0.0 ms | 0 |');
  });
});
