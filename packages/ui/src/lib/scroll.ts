export type ScrollMetrics = { scrollTop: number; scrollHeight: number; clientHeight: number };

export type ScrollThumb = { size: number; offset: number; travel: number; scrollable: number };

export const THUMB_EDGE = 4;
export const THUMB_MIN_SIZE = 24;

/**
 * Which ends of a scroller still hide content: the start once anything has
 * scrolled past, the end while the far edge is out of view. `Math.ceil`
 * absorbs the fractional scroll positions zoomed pages report, so a scroller
 * resting at its end never keeps a fade there.
 */
export function resolveOverflowEdges(position: number, viewport: number, content: number) {
  return { start: position > 0, end: Math.ceil(position + viewport) < content };
}

/**
 * The overlay thumb for a vertical scroller: its length follows the visible
 * share of the content (never under `THUMB_MIN_SIZE`) and it travels the
 * track inset by `THUMB_EDGE` at both ends. `null` while nothing scrolls.
 */
export function resolveThumb({ scrollTop, scrollHeight, clientHeight }: ScrollMetrics): ScrollThumb | null {
  const scrollable = scrollHeight - clientHeight;
  if (scrollable <= 1) return null;
  const room = clientHeight - THUMB_EDGE * 2;
  const size = Math.max(THUMB_MIN_SIZE, (clientHeight / scrollHeight) * room);
  const travel = Math.max(0, room - size);
  const progress = Math.min(1, Math.max(0, scrollTop / scrollable));
  return { size, offset: progress * travel, travel, scrollable };
}

/** Where a thumb dragged `delta` pixels from `startTop` puts the content. */
export function resolveDragScrollTop(metrics: ScrollMetrics, startTop: number, delta: number): number {
  const thumb = resolveThumb(metrics);
  if (!thumb) return startTop;
  return startTop + delta * (thumb.scrollable / Math.max(1, thumb.travel));
}

/**
 * Where a press on the bare track scrolls to: the thumb centres on the
 * pointer (`pointer` is measured from the track's top edge), clamped to the
 * ends, so a press near the bottom lands on the end rather than past it.
 */
export function resolveTrackScrollTop(metrics: ScrollMetrics, pointer: number): number {
  const thumb = resolveThumb(metrics);
  if (!thumb) return metrics.scrollTop;
  if (thumb.travel === 0) return 0;
  const offset = Math.min(thumb.travel, Math.max(0, pointer - THUMB_EDGE - thumb.size / 2));
  return (offset / thumb.travel) * thumb.scrollable;
}
