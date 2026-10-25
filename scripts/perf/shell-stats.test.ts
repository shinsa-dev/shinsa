import { describe, expect, it } from 'bun:test';
import { serializeStepTable, summarize, summarizeSteps } from './shell-stats.ts';

describe('summarize', () => {
  it('gives the median, p95 and range of a sample', () => {
    expect(summarize([30, 10, 20, 40, 50])).toEqual({ count: 5, median: 30, p95: 50, min: 10, max: 50 });
  });

  it('gives zeros for no samples', () => {
    expect(summarize([])).toEqual({ count: 0, median: 0, p95: 0, min: 0, max: 0 });
  });
});

describe('summarizeSteps', () => {
  it('groups the samples by step, in the order the steps first ran, and prints them as a table', () => {
    const steps = summarizeSteps([
      { label: 'Home → task', clickToPaint: 20, rendered: 100, longTasks: 0, longTaskTotal: 0 },
      { label: 'Task → Home', clickToPaint: 12, rendered: 40, longTasks: 1, longTaskTotal: 55 },
      { label: 'Home → task', clickToPaint: 18, rendered: 90, longTasks: 0, longTaskTotal: 0 },
    ]);
    expect(steps.map((step) => [step.label, step.clickToPaint.median, step.rendered])).toEqual([
      ['Home → task', 18, 90],
      ['Task → Home', 12, 40],
    ]);
    expect(serializeStepTable(steps).split('\n')).toEqual([
      '| Step | Median | p95 | Components rendered | Long tasks (total ms) |',
      '|---|---|---|---|---|',
      '| Home → task | 18.0 ms | 20.0 ms | 90 | 0 (0) |',
      '| Task → Home | 12.0 ms | 12.0 ms | 40 | 1 (55) |',
    ]);
  });
});
