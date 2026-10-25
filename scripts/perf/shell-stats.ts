export interface Summary {
  count: number;
  median: number;
  p95: number;
  min: number;
  max: number;
}

export interface StepSample {
  label: string;
  clickToPaint: number;
  rendered: number;
  longTasks: number;
  longTaskTotal: number;
}

export interface StepSummary {
  label: string;
  clickToPaint: Summary;
  rendered: number;
  longTasks: number;
  longTaskTotal: number;
}

function resolvePercentile(sorted: readonly number[], fraction: number) {
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

export function summarize(samples: readonly number[]): Summary {
  if (samples.length === 0) return { count: 0, median: 0, p95: 0, min: 0, max: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    median: resolvePercentile(sorted, 0.5),
    p95: resolvePercentile(sorted, 0.95),
    min: sorted[0] ?? 0,
    max: sorted.at(-1) ?? 0,
  };
}

function resolveMedianOf(samples: readonly StepSample[], pick: (sample: StepSample) => number) {
  return summarize(samples.map(pick)).median;
}

export function summarizeSteps(samples: readonly StepSample[]): StepSummary[] {
  const labels = [...new Set(samples.map((sample) => sample.label))];
  return labels.map((label) => {
    const mine = samples.filter((sample) => sample.label === label);
    return {
      label,
      clickToPaint: summarize(mine.map((sample) => sample.clickToPaint)),
      rendered: resolveMedianOf(mine, (sample) => sample.rendered),
      longTasks: resolveMedianOf(mine, (sample) => sample.longTasks),
      longTaskTotal: resolveMedianOf(mine, (sample) => sample.longTaskTotal),
    };
  });
}

function formatMs(value: number) {
  return `${value.toFixed(1)} ms`;
}

export function serializeStepTable(steps: readonly StepSummary[]) {
  const header = '| Step | Median | p95 | Components rendered | Long tasks (total ms) |';
  const rule = '|---|---|---|---|---|';
  const rows = steps.map(
    (step) =>
      `| ${step.label} | ${formatMs(step.clickToPaint.median)} | ${formatMs(step.clickToPaint.p95)} | ${step.rendered} | ${step.longTasks} (${step.longTaskTotal.toFixed(0)}) |`
  );
  return [header, rule, ...rows].join('\n');
}
