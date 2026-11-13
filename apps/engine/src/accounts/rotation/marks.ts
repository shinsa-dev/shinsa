import { isModelMarkFor, resolveModelFamily } from '@shinsa/core';
import { type SpentMark, UNKNOWN_RESET_MS } from '../schema.ts';

export interface SpentReading {
  until: number;
  model: string | null;
}

function resolveMarkFamily(mark: SpentMark) {
  return mark.model === undefined ? null : resolveModelFamily(mark.model).toLowerCase();
}

export function replaceMark(marks: readonly SpentMark[], marked: SpentMark) {
  const family = resolveMarkFamily(marked);
  return [...marks.filter((mark) => resolveMarkFamily(mark) !== family), marked];
}

function resolveMarkUntil(mark: SpentMark, knownResets: boolean) {
  if (mark.until !== null) return mark.until;
  return knownResets ? null : mark.at + UNKNOWN_RESET_MS;
}

export function resolveSpentReading(
  marks: readonly SpentMark[],
  model: string | null,
  knownResets: boolean
): SpentReading | null {
  let latest: SpentReading | null = null;
  for (const mark of marks) {
    if (!isModelMarkFor(mark.model, model)) continue;
    const until = resolveMarkUntil(mark, knownResets);
    if (until !== null && (latest === null || until > latest.until)) {
      latest = { until, model: mark.model ?? null };
    }
  }
  return latest;
}
