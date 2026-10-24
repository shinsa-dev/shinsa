export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEFAULT_SIZE = { width: 900, height: 1100 };

export const MIN_SIZE = { width: 480, height: 480 };

const VISIBLE_EDGE = 64;

function isRect(value: unknown): value is Rect {
  if (typeof value !== 'object' || value === null) return false;
  const { x, y, width, height } = value as Record<string, unknown>;
  return [x, y, width, height].every((part) => typeof part === 'number' && Number.isFinite(part));
}

function isVisibleOn(bounds: Rect, area: Rect) {
  const width = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
  const height = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
  return width >= VISIBLE_EDGE && height >= VISIBLE_EDGE;
}

export function resolveWindowBounds(saved: unknown, areas: readonly Rect[], primary: Rect): Rect {
  if (
    isRect(saved) &&
    saved.width >= MIN_SIZE.width &&
    saved.height >= MIN_SIZE.height &&
    areas.some((area) => isVisibleOn(saved, area))
  ) {
    return { x: saved.x, y: saved.y, width: saved.width, height: saved.height };
  }
  const width = Math.min(DEFAULT_SIZE.width, primary.width);
  const height = Math.min(DEFAULT_SIZE.height, primary.height);
  return {
    x: Math.round(primary.x + (primary.width - width) / 2),
    y: Math.round(primary.y + (primary.height - height) / 2),
    width,
    height,
  };
}
