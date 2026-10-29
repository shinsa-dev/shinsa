export interface ChartBox {
  width: number;
  height: number;
}

export interface ChartPoint {
  x: number;
  y: number;
}

export interface AreaGeometry {
  max: number;
  points: ChartPoint[];
  line: string;
  area: string;
}

const AXIS_LABELS = 5;

const NICE_MULTIPLES = [1.2, 1.6, 2, 3, 4, 5, 6, 8, 10];

export function resolveChartMax(values: number[]) {
  const top = Math.max(0, ...values);
  if (top <= 4) return 4;
  const unit = 10 ** Math.floor(Math.log10(top));
  const multiple = NICE_MULTIPLES.find((candidate) => candidate * unit >= top) ?? 10;
  return Math.round(multiple * unit);
}

export function listChartTicks(max: number) {
  return [max, max / 2, 0];
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function listSlopes(points: ChartPoint[]) {
  const secants = points.slice(1).map((point, index) => {
    const previous = points[index] as ChartPoint;
    return (point.y - previous.y) / (point.x - previous.x);
  });
  return points.map((_, index) => {
    const before = secants[index - 1];
    const after = secants[index];
    if (before === undefined) return after ?? 0;
    if (after === undefined) return before;
    return before * after <= 0 ? 0 : (2 * before * after) / (before + after);
  });
}

export function resolveSmoothLine(points: ChartPoint[]) {
  const first = points[0];
  if (!first) return '';
  const slopes = listSlopes(points);
  const segments = points.slice(1).map((point, index) => {
    const previous = points[index] as ChartPoint;
    const third = (point.x - previous.x) / 3;
    const start = { x: previous.x + third, y: previous.y + (slopes[index] ?? 0) * third };
    const end = { x: point.x - third, y: point.y - (slopes[index + 1] ?? 0) * third };
    return `C${round(start.x)} ${round(start.y)} ${round(end.x)} ${round(end.y)} ${point.x} ${point.y}`;
  });
  return [`M${first.x} ${first.y}`, ...segments].join(' ');
}

export function resolveAreaGeometry(values: number[], box: ChartBox): AreaGeometry {
  const max = resolveChartMax(values);
  const last = Math.max(1, values.length - 1);
  const points = values.map((value, index) => ({
    x: round(values.length === 1 ? box.width / 2 : (index / last) * box.width),
    y: round(box.height - (value / max) * box.height),
  }));
  const line = resolveSmoothLine(points);
  const first = points[0];
  const end = points.at(-1);
  const area = first && end ? `${line} L${end.x} ${box.height} L${first.x} ${box.height} Z` : '';
  return { max, points, line, area };
}

export function resolveNearestIndex(x: number, count: number, width: number) {
  if (count <= 1 || width <= 0) return 0;
  const index = Math.round((x / width) * (count - 1));
  return Math.min(count - 1, Math.max(0, index));
}

export function listAxisIndexes(count: number, labels = AXIS_LABELS) {
  if (count <= labels) return Array.from({ length: count }, (_, index) => index);
  return Array.from({ length: labels }, (_, index) => Math.round((index * (count - 1)) / (labels - 1)));
}

export function resolvePointShare(index: number, count: number) {
  return count <= 1 ? 0.5 : index / (count - 1);
}
