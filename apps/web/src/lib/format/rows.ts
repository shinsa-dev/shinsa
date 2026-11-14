export interface RowWindow {
  start: number;
  end: number;
}

const MIN_OVERSCAN_ROWS = 12;

const CHUNK_ROWS = 8;

export function resolveOverscanRows(viewportHeight: number, rowHeight: number) {
  return Math.max(MIN_OVERSCAN_ROWS, Math.ceil(viewportHeight / rowHeight));
}

export function resolveRowWindow(
  listTop: number,
  viewportHeight: number,
  count: number,
  rowHeight: number,
  ahead = true
) {
  const overscan = ahead ? resolveOverscanRows(viewportHeight, rowHeight) : 0;
  const first = Math.floor(-listTop / rowHeight) - overscan;
  const last = Math.ceil((viewportHeight - listTop) / rowHeight) + overscan;
  const start = Math.min(count, Math.max(0, Math.floor(first / CHUNK_ROWS) * CHUNK_ROWS));
  const end = Math.min(count, Math.max(start, Math.ceil(last / CHUNK_ROWS) * CHUNK_ROWS));
  return { start, end };
}

export function resolveSectionWindows(
  tops: readonly (number | undefined)[],
  viewportHeight: number,
  counts: readonly number[],
  rowHeight: number,
  ahead = true
) {
  return counts.map((count, index) =>
    resolveRowWindow(tops[index] ?? 0, viewportHeight, count, rowHeight, ahead)
  );
}

export function isSameWindows(a: readonly RowWindow[], b: readonly RowWindow[]) {
  return a.length === b.length && a.every((range, index) => isSameRange(range, b[index] as RowWindow));
}

export function isSameRange(a: RowWindow, b: RowWindow) {
  return a.start === b.start && a.end === b.end;
}

export function isCoveringWindows(shown: readonly RowWindow[], inView: readonly RowWindow[]) {
  return (
    shown.length === inView.length &&
    inView.every((range, index) => {
      const drawn = shown[index] as RowWindow;
      return range.start === range.end || (drawn.start <= range.start && drawn.end >= range.end);
    })
  );
}
