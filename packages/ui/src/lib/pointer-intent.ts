export type PointerSample = { x: number; y: number; t: number };

export type Box = { left: number; right: number; top: number; bottom: number };

export const SAMPLE_WINDOW_MS = 80;
export const MIN_TRAVEL_PX = 3;

/** The recent pointer path: samples older than `SAMPLE_WINDOW_MS` drop off. */
export function appendSample(samples: readonly PointerSample[], sample: PointerSample): PointerSample[] {
  return [...samples.filter((previous) => sample.t - previous.t <= SAMPLE_WINDOW_MS), sample];
}

function solveAxis(low: number, high: number, origin: number, delta: number): [number, number] | null {
  if (delta === 0) return origin >= low && origin <= high ? [0, Number.POSITIVE_INFINITY] : null;
  const a = (low - origin) / delta;
  const b = (high - origin) / delta;
  return [Math.min(a, b), Math.max(a, b)];
}

/**
 * Whether the pointer is inside `box`, or moving toward it: the ray from the
 * latest sample along the recent direction of travel enters the box ahead of
 * the pointer. Under `MIN_TRAVEL_PX` of movement there is no direction yet,
 * so it reads as not heading anywhere.
 */
export function isHeadingInto(samples: readonly PointerSample[], box: Box): boolean {
  const last = samples.at(-1);
  const first = samples[0];
  if (!(last && first)) return false;
  if (last.x >= box.left && last.x <= box.right && last.y >= box.top && last.y <= box.bottom) return true;
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  if (Math.hypot(dx, dy) < MIN_TRAVEL_PX) return false;
  const horizontal = solveAxis(box.left, box.right, last.x, dx);
  const vertical = solveAxis(box.top, box.bottom, last.y, dy);
  if (!(horizontal && vertical)) return false;
  const from = Math.max(horizontal[0], vertical[0]);
  const to = Math.min(horizontal[1], vertical[1]);
  return from <= to && to >= 0;
}
