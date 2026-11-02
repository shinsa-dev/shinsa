import { Option, Schema } from 'effect';
import { DEFAULT_SIZE, type Rect, SavedBounds, VISIBLE_EDGE } from './schema.ts';

const decodeSavedBounds = Schema.decodeUnknownOption(SavedBounds);

function isVisibleOn(bounds: Rect, area: Rect) {
  const width = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
  const height = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
  return width >= VISIBLE_EDGE && height >= VISIBLE_EDGE;
}

export function resolveWindowBounds(saved: unknown, areas: readonly Rect[], primary: Rect): Rect {
  const bounds = decodeSavedBounds(saved);
  if (Option.isSome(bounds) && areas.some((area) => isVisibleOn(bounds.value, area))) return bounds.value;
  const width = Math.min(DEFAULT_SIZE.width, primary.width);
  const height = Math.min(DEFAULT_SIZE.height, primary.height);
  return {
    x: Math.round(primary.x + (primary.width - width) / 2),
    y: Math.round(primary.y + (primary.height - height) / 2),
    width,
    height,
  };
}
