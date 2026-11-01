/** Seconds the band takes to move from one character to the next on a long line. */
export const SHIMMER_STEP = 0.05;

/** The most characters a sweep is timed for: about as many as one line shows. */
export const SHIMMER_LONGEST = 80;

/** The share of a cycle the band spends crossing the line; the rest is still. */
export const SHIMMER_SWEEP = 0.66;

/**
 * Seconds one cycle of the shimmer takes over a line of `length` characters.
 * A short line is crossed in `duration`; a long one at `SHIMMER_STEP` a
 * character, up to `SHIMMER_LONGEST`, since the characters behind the ellipsis
 * are not crossed. The cycle adds the rest between sweeps.
 */
export function resolveShimmerDuration(length: number, duration: number): number {
  const sweep = Math.max(duration, Math.min(length, SHIMMER_LONGEST) * SHIMMER_STEP);
  return Math.round((sweep / SHIMMER_SWEEP) * 1000) / 1000;
}
