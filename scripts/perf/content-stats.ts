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

export function summarizeBlankScroll(blank: readonly number[], deltas: readonly number[], viewport: number) {
  const blankFrames = blank.filter((pixels) => pixels > 0);
  return {
    frames: blank.length,
    blankFrames: blankFrames.length,
    blankPxMax: Math.max(0, ...blank),
    blankShareMax: viewport > 0 ? Math.round((Math.max(0, ...blank) / viewport) * 100) : 0,
    blankPxTotal: blankFrames.reduce((sum, pixels) => sum + pixels, 0),
    frameMax: Math.round(Math.max(0, ...deltas) * 10) / 10,
    framesOver20: deltas.filter((delta) => delta > 20).length,
  };
}

export function summarizeRowPushes(
  pushes: readonly { ms: number; components: number; rows: number }[],
  visibleRows: number
) {
  return {
    pushes: pushes.length,
    visibleRows,
    pushMs: median(pushes.map((push) => push.ms)),
    pushMaxMs: Math.round(Math.max(0, ...pushes.map((push) => push.ms)) * 10) / 10,
    pushComponents: median(pushes.map((push) => push.components)),
    pushRows: median(pushes.map((push) => push.rows)),
  };
}

export function summarizeReveal(counts: readonly number[]) {
  const settled = counts.at(-1) ?? 0;
  const first = counts.findIndex((count) => count > 0);
  const full = counts.findIndex((count) => count >= settled);
  return {
    revealRows: settled,
    revealFirstRowFrame: first,
    revealFullFrame: full,
    revealShortFrames: counts.filter((count) => count < settled).length,
  };
}
