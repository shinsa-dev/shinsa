export function round(value: number) {
  return Math.round(value * 100) / 100;
}

export function summarize(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return { p50: round(at(0.5)), p95: round(at(0.95)), max: round(at(1)), n: sorted.length };
}
