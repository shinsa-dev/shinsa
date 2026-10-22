export const ELLIPSIS = '…';

/**
 * The longest middle-cut of `text` that fits `available` pixels: as many
 * characters as fit, split evenly around one ellipsis (the extra one goes to
 * the head), so both ends of an identifier stay readable. `measure` returns a
 * candidate's rendered width. Falls back to the bare ellipsis when not even
 * one character fits.
 */
export function resolveMiddleTruncation(
  text: string,
  available: number,
  measure: (candidate: string) => number
): string {
  let low = 0;
  let high = text.length - 1;
  let best = '';
  while (low <= high) {
    const kept = Math.floor((low + high) / 2);
    const head = Math.ceil(kept / 2);
    const candidate = `${text.slice(0, head)}${ELLIPSIS}${text.slice(text.length - (kept - head))}`;
    if (measure(candidate) <= available) {
      best = candidate;
      low = kept + 1;
    } else {
      high = kept - 1;
    }
  }
  return best || ELLIPSIS;
}

/** Whether an element's content overflows its box on the axis it clamps. */
export function isClipped(
  box: { scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number },
  axis: 'inline' | 'block'
): boolean {
  if (axis === 'block') return box.scrollHeight > box.clientHeight + 1;
  return box.scrollWidth > box.clientWidth;
}
