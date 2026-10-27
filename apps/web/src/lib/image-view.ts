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

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type Corners = [number, number, number, number];

export interface Landing {
  view: View;
  clip: Insets;
  corners: Corners;
}

export interface Clip {
  box: Box;
  radius: number;
}

export interface Thumbnail {
  box: Box;
  objectFit: string;
  radius: number;
  clips: Clip[];
}

const SNAP = 0.5;

function centreBox(box: Box, size: Size): Box {
  return {
    left: box.left + (box.width - size.width) / 2,
    top: box.top + (box.height - size.height) / 2,
    width: size.width,
    height: size.height,
  };
}

function scaleSize(size: Size, ratio: number): Size {
  return { width: size.width * ratio, height: size.height * ratio };
}

export function resolveObjectBox(box: Box, natural: Size, objectFit: string): Box {
  const contain = Math.min(box.width / natural.width, box.height / natural.height);
  const cover = Math.max(box.width / natural.width, box.height / natural.height);
  if (objectFit === 'fill') return box;
  if (objectFit === 'cover') return centreBox(box, scaleSize(natural, cover));
  if (objectFit === 'none') return centreBox(box, natural);
  if (objectFit === 'scale-down') return centreBox(box, scaleSize(natural, Math.min(1, contain)));
  return centreBox(box, scaleSize(natural, contain));
}

export function intersectBoxes(first: Box, second: Box): Box | null {
  const left = Math.max(first.left, second.left);
  const top = Math.max(first.top, second.top);
  const right = Math.min(first.left + first.width, second.left + second.width);
  const bottom = Math.min(first.top + first.height, second.top + second.height);
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
}

function isSamePoint(first: Point, second: Point) {
  return Math.abs(first.x - second.x) < SNAP && Math.abs(first.y - second.y) < SNAP;
}

function listCorners(box: Box): [Point, Point, Point, Point] {
  const right = box.left + box.width;
  const bottom = box.top + box.height;
  return [
    { x: box.left, y: box.top },
    { x: right, y: box.top },
    { x: right, y: bottom },
    { x: box.left, y: bottom },
  ];
}

export function resolveCorners(visible: Box, clips: Clip[]): Corners {
  const corners = listCorners(visible);
  const radius = (at: 0 | 1 | 2 | 3) =>
    Math.max(
      0,
      ...clips
        .filter((clip) => isSamePoint(listCorners(clip.box)[at], corners[at]))
        .map((clip) => clip.radius)
    );
  return [radius(0), radius(1), radius(2), radius(3)];
}

export function resolveViewLanding(view: View, radius: number): Landing {
  return { view, clip: { top: 0, right: 0, bottom: 0, left: 0 }, corners: [radius, radius, radius, radius] };
}

export function resolveLanding(
  thumbnail: Thumbnail,
  natural: Size,
  fitted: Size,
  viewport: Size
): Landing | null {
  if (thumbnail.box.width <= 0 || thumbnail.box.height <= 0) return null;
  const drawn = resolveObjectBox(thumbnail.box, natural, thumbnail.objectFit);
  const clips = [
    { box: thumbnail.box, radius: thumbnail.radius },
    ...thumbnail.clips,
    { box: { left: 0, top: 0, ...viewport }, radius: 0 },
  ];
  let visible: Box | null = drawn;
  for (const clip of clips) visible = visible && intersectBoxes(visible, clip.box);
  if (!visible) return null;
  const scale = drawn.width / fitted.width;
  return {
    view: {
      scale,
      x: drawn.left + drawn.width / 2 - viewport.width / 2,
      y: drawn.top + drawn.height / 2 - viewport.height / 2,
    },
    clip: {
      top: (visible.top - drawn.top) / scale,
      right: (drawn.left + drawn.width - visible.left - visible.width) / scale,
      bottom: (drawn.top + drawn.height - visible.top - visible.height) / scale,
      left: (visible.left - drawn.left) / scale,
    },
    corners: resolveCorners(visible, clips).map((radius) => radius / scale) as Corners,
  };
}

export function serializeLanding({ view, clip, corners }: Landing) {
  const round = corners.map((radius) => `${radius}px`).join(' ');
  return {
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
    clipPath: `inset(${clip.top}px ${clip.right}px ${clip.bottom}px ${clip.left}px round ${round})`,
  };
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

export interface ViewerSwap {
  kind: 'part' | 'step';
  direction: 1 | -1;
}

export function resolveSwap(
  images: readonly { item?: string }[],
  from: number,
  to: number,
  offset: number
): ViewerSwap {
  const item = images[from]?.item;
  return {
    kind: item && images[to]?.item === item ? 'part' : 'step',
    direction: offset < 0 ? -1 : 1,
  };
}

const SWAP_SLIDE = 10;

export function resolveSwapMotion(swap: ViewerSwap, reduced: boolean) {
  const slides = swap.kind === 'step' && !reduced;
  const slide = slides ? SWAP_SLIDE * swap.direction : 0;
  return { duration: slides ? 200 : 150, enter: slide, leave: 0 - slide };
}

export function isLeavingHeld(swap: ViewerSwap, leaving: Size | null, entering: Size | null) {
  if (swap.kind !== 'part' || !leaving || !entering) return false;
  return Math.abs(leaving.width - entering.width) < SNAP && Math.abs(leaving.height - entering.height) < SNAP;
}

export function describeZoom(scale: number, actual: number) {
  return `${Math.round((scale / actual) * 100)}%`;
}

interface ViewerPart {
  index: number;
  name: string;
}

export interface ViewerItem {
  position: number;
  count: number;
  parts: ViewerPart[];
}

export function resolveViewerItem(
  images: readonly { item?: string; part?: string }[],
  index: number
): ViewerItem {
  const starts: number[] = [];
  images.forEach((image, at) => {
    if (at === 0 || !image.item || images[at - 1]?.item !== image.item) starts.push(at);
  });
  const position = starts.filter((at) => at <= index).length - 1;
  const start = starts[position] ?? 0;
  const end = starts[position + 1] ?? images.length;
  const parts = images
    .slice(start, end)
    .map((image, offset) => ({ index: start + offset, name: image.part ?? '' }))
    .filter((part) => part.name !== '');
  return { position: position + 1, count: starts.length, parts: parts.length > 1 ? parts : [] };
}
