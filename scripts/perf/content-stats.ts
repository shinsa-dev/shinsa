export function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : (sorted[middle] ?? 0);
  return Math.round(value * 10) / 10;
}

export function summarize(samples: Record<string, number>[]) {
  const keys = [...new Set(samples.flatMap((sample) => Object.keys(sample)))];
  return Object.fromEntries(
    keys.map((key) => [key, median(samples.flatMap((sample) => (key in sample ? [sample[key] ?? 0] : [])))])
  );
}
