import type { TimingSpan } from '../domain/types.ts';

export function sumSpans(spans: readonly TimingSpan[]) {
  return spans.reduce((total, span) => total + (span.to - span.from), 0);
}

export function clipSpans(spans: readonly TimingSpan[], window: TimingSpan): TimingSpan[] {
  return spans
    .map((span) => ({ from: Math.max(span.from, window.from), to: Math.min(span.to, window.to) }))
    .filter((span) => span.to > span.from);
}

export function subtractSpans(span: TimingSpan, cuts: readonly TimingSpan[]): TimingSpan[] {
  const parts: TimingSpan[] = [];
  let from = span.from;
  for (const cut of [...cuts].sort((a, b) => a.from - b.from)) {
    if (cut.to <= from || cut.from >= span.to) continue;
    if (cut.from > from) parts.push({ from, to: cut.from });
    from = Math.max(from, cut.to);
  }
  if (from < span.to) parts.push({ from, to: span.to });
  return parts;
}

export function mergeSpans(spans: readonly TimingSpan[]): TimingSpan[] {
  const merged: TimingSpan[] = [];
  for (const span of [...spans].sort((a, b) => a.from - b.from)) {
    const last = merged.at(-1);
    if (last && span.from <= last.to) last.to = Math.max(last.to, span.to);
    else merged.push({ ...span });
  }
  return merged;
}

export function isWithin(at: number, span: TimingSpan) {
  return at > span.from && at <= span.to;
}
