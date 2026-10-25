export interface RowWindow {
  start: number;
  end: number;
}

const OVERSCAN_ROWS = 12;

const CHUNK_ROWS = 8;

export function resolveRowWindow(listTop: number, viewportHeight: number, count: number, rowHeight: number) {
  const first = Math.floor(-listTop / rowHeight) - OVERSCAN_ROWS;
  const last = Math.ceil((viewportHeight - listTop) / rowHeight) + OVERSCAN_ROWS;
  const start = Math.min(count, Math.max(0, Math.floor(first / CHUNK_ROWS) * CHUNK_ROWS));
  const end = Math.min(count, Math.max(start, Math.ceil(last / CHUNK_ROWS) * CHUNK_ROWS));
  return { start, end };
}

export function isSameRange(a: RowWindow, b: RowWindow) {
  return a.start === b.start && a.end === b.end;
}
