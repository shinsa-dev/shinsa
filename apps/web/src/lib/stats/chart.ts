export interface ChartBox {
  width: number;
  height: number;
}

export interface AreaGeometry {
  max: number;
  points: { x: number; y: number }[];
  line: string;
  area: string;
}

export function resolveChartMax(values: number[]) {
  const top = Math.max(0, ...values);
  if (top <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(top));
  return Math.ceil(top / step) * step;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

export function resolveAreaGeometry(values: number[], box: ChartBox): AreaGeometry {
  const max = resolveChartMax(values);
  const last = Math.max(1, values.length - 1);
  const points = values.map((value, index) => ({
    x: round(values.length === 1 ? box.width / 2 : (index / last) * box.width),
    y: round(box.height - (value / max) * box.height),
  }));
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ');
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
