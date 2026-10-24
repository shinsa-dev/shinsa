export interface View {
  scale: number;
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export const FIT: View = { scale: 1, x: 0, y: 0 };

const CHROME_HEIGHT = 128;

const PAN_MARGIN = 32;

const MIN_ROOM = 48;

export function resolveImageName(src: string) {
  if (src.startsWith('data:') || src.startsWith('blob:')) return 'Image';
  const path = src.split(/[?#]/)[0] ?? src;
  const last = path.split('/').filter(Boolean).pop();
  if (!last) return 'Image';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

export function describeOpenImage(image: { src: string; caption?: string | null }) {
  return `Open ${image.caption || resolveImageName(image.src)}`;
}

export function resolveFit(natural: Size | null, viewport: Size, gutter: number) {
  if (!natural) return null;
  const room = {
    width: Math.max(MIN_ROOM, viewport.width - gutter * 2),
    height: Math.max(MIN_ROOM, viewport.height - CHROME_HEIGHT),
  };
  const ratio = Math.min(1, room.width / natural.width, room.height / natural.height);
  return { width: natural.width * ratio, height: natural.height * ratio, actual: 1 / ratio };
}

export function clampView(view: View, fitted: Size, viewport: Size): View {
  if (view.scale <= 1) return FIT;
  const reachX = Math.max(0, (fitted.width * view.scale - viewport.width) / 2 + PAN_MARGIN);
  const reachY = Math.max(0, (fitted.height * view.scale - viewport.height) / 2 + PAN_MARGIN);
  return {
    scale: view.scale,
    x: Math.min(reachX, Math.max(-reachX, view.x)),
    y: Math.min(reachY, Math.max(-reachY, view.y)),
  };
}

export function zoomAround(view: View, scale: number, point: Point): View {
  const ratio = scale / view.scale;
  return { scale, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio };
}

export function resolveOriginTransform(rect: DOMRect, fitted: Size, viewport: Size) {
  const dx = rect.left + rect.width / 2 - viewport.width / 2;
  const dy = rect.top + rect.height / 2 - viewport.height / 2;
  const ratio = Math.min(rect.width / fitted.width, rect.height / fitted.height);
  return `translate(${dx}px, ${dy}px) scale(${ratio})`;
}

const TAP_SLOP = 4;

const ZOOM_STEP = 1.5;

function clampScale(scale: number, max: number) {
  return Math.min(max, Math.max(1, scale));
}

function measureDistance(first: Point, second: Point) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

export function resolveStagePoint(client: Point, viewport: Size): Point {
  return { x: client.x - viewport.width / 2, y: client.y - viewport.height / 2 };
}

export function resolveZoomRange(fit: { actual: number } | null) {
  const target = Math.max(fit?.actual ?? 2, 2);
  return { target, max: Math.max(4, target * 2) };
}

export function resolveWheelView(
  view: View,
  wheel: { deltaY: number; ctrlKey: boolean },
  point: Point,
  max: number
): View {
  const speed = wheel.ctrlKey ? 0.01 : 0.002;
  return zoomAround(view, clampScale(view.scale * Math.exp(-wheel.deltaY * speed), max), point);
}

export function resolveKeyView(key: string, view: View, max: number): View | null {
  if (key === '+' || key === '=') return { ...view, scale: Math.min(max, view.scale * ZOOM_STEP) };
  if (key === '-') return { ...view, scale: view.scale / ZOOM_STEP };
  return key === '0' ? FIT : null;
}

export function resolveTapView(view: View, target: number, point: Point): View {
  if (view.scale > 1) return FIT;
  return zoomAround(view, target, point);
}

export function resolvePinch(points: Point[], viewport: Size) {
  const [first, second] = points;
  if (!first || !second) return null;
  const mid = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  return { distance: measureDistance(first, second), mid: resolveStagePoint(mid, viewport) };
}

export function resolvePinchView(
  start: View,
  pinch: { distance: number; mid: Point },
  points: Point[],
  max: number
): View | null {
  const [first, second] = points;
  if (!first || !second) return null;
  const scale = clampScale((start.scale * measureDistance(first, second)) / pinch.distance, max);
  return zoomAround(start, scale, pinch.mid);
}

export function isPastTapSlop(start: Point, point: Point) {
  return measureDistance(start, point) > TAP_SLOP;
}

export function resolvePanView(start: View, from: Point, to: Point): View {
  return { ...start, x: start.x + to.x - from.x, y: start.y + to.y - from.y };
}

export function resolveStepIndex(index: number, offset: number, count: number) {
  return (index + offset + count) % count;
}

export function describeZoom(scale: number, actual: number) {
  return `${Math.round((scale / actual) * 100)}%`;
}
