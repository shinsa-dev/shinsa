/** Seconds the band takes to move from one character to the next on a long line. */
export const SHIMMER_STEP = 0.05;

/**
 * How one pass of the shimmer is timed over the `visible` characters. A short
 * line is crossed in `duration`; a long one at `SHIMMER_STEP` a character, so
 * the band keeps moving until it reaches the last visible character and the
 * next pass starts as it fades, instead of crossing in `duration` and then
 * sitting still while the rest of the cycle runs out.
 */
export function resolveShimmerTiming(visible: number, duration: number) {
  if (visible === 0) return { stagger: 0, rest: 0 };
  return { stagger: Math.max(duration / visible, SHIMMER_STEP), rest: visible * SHIMMER_STEP };
}
