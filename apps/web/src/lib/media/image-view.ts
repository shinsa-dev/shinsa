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

export function resolveFit(natural: Size | null, viewport: Size, gutter: number) {
  if (!natural) return null;
  const room = { width: viewport.width - gutter * 2, height: viewport.height - CHROME_HEIGHT };
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
