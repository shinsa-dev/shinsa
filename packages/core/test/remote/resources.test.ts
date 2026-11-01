import { describe, expect, test } from 'bun:test';
import {
  describeGigabytes,
  describeResourceSummary,
  parseResourceSummary,
  type ResourceSummary,
  resolveMemoryPercent,
  resolveResourceHeadroom,
  resolveResourceSummary,
} from '../../src/remote/resources.ts';

const GB = 1024 ** 3;

const summary: ResourceSummary = {
  cores: 4,
  cpuPercent: 30,
  memoryUsedBytes: 6 * GB,
  memoryTotalBytes: 8 * GB,
  diskFreeBytes: 5.25 * GB,
};

describe('headroom', () => {
  test('is the smaller of free CPU and free memory, rounded down to 5% steps', () => {
    expect(resolveResourceHeadroom(summary)).toBe(25);
    expect(resolveResourceHeadroom({ ...summary, memoryUsedBytes: GB })).toBe(70);
    expect(resolveResourceHeadroom({ ...summary, cpuPercent: 140 })).toBe(0);
    expect(resolveResourceHeadroom({ ...summary, cpuPercent: -5, memoryUsedBytes: 0 })).toBe(100);
  });

  test('a machine that reports no memory counts as full', () => {
    expect(resolveMemoryPercent({ memoryUsedBytes: 0, memoryTotalBytes: 0 })).toBe(100);
    expect(resolveMemoryPercent(summary)).toBe(75);
  });
});

describe('describing use', () => {
  test('in whole gigabytes from 10, tenths below', () => {
    expect(describeGigabytes(120.4 * GB)).toBe('120');
    expect(describeGigabytes(5.25 * GB)).toBe('5.3');
  });

  test('names CPU, memory and free disk, leaving out a disk it could not read', () => {
    expect(describeResourceSummary(summary)).toBe(
      'CPU 30% of 4 cores, memory 6 of 8 GB used, 5.3 GB disk free'
    );
    expect(describeResourceSummary({ ...summary, diskFreeBytes: null })).toBe(
      'CPU 30% of 4 cores, memory 6 of 8 GB used'
    );
  });

  test('a summary keeps only the fields placement reads', () => {
    expect(
      resolveResourceSummary({
        ...summary,
        sampledAt: 1,
        diskTotalBytes: 10 * GB,
        tasks: [],
      } as ResourceSummary)
    ).toEqual(summary);
  });
});

describe('parsing a summary', () => {
  test('accepts a well-formed one and refuses any field out of shape', () => {
    expect(parseResourceSummary(summary)).toEqual(summary);
    expect(parseResourceSummary({ ...summary, diskFreeBytes: null })?.diskFreeBytes).toBeNull();
    const broken: unknown[] = [
      null,
      'summary',
      { ...summary, cores: 0 },
      { ...summary, cores: 1.5 },
      { ...summary, cpuPercent: 101 },
      { ...summary, cpuPercent: -1 },
      { ...summary, memoryUsedBytes: 'a lot' },
      { ...summary, memoryTotalBytes: Number.POSITIVE_INFINITY },
      { ...summary, memoryUsedBytes: 9 * GB },
      { ...summary, diskFreeBytes: -1 },
    ];
    for (const value of broken) expect(parseResourceSummary(value)).toBeNull();
  });
});
