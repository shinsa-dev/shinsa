import type { MeasuredCoverage } from '@shinsa/core';

export function createPartialCoverage(): MeasuredCoverage {
  return {
    status: 'measured',
    command: 'bun test --coverage',
    covered: 36,
    executable: 42,
    files: [
      {
        path: 'src/billing/proration.ts',
        covered: 10,
        executable: 14,
        uncovered: [
          [40, 42],
          [57, 57],
        ],
      },
      { path: 'src/billing/invoice.ts', covered: 6, executable: 8, uncovered: [[12, 13]] },
      { path: 'src/billing/plans.ts', covered: 20, executable: 20, uncovered: [] },
    ],
  };
}

export function createFullCoverage(): MeasuredCoverage {
  return {
    status: 'measured',
    command: 'bun test --coverage',
    covered: 42,
    executable: 42,
    files: [{ path: 'src/billing/plans.ts', covered: 42, executable: 42, uncovered: [] }],
  };
}
