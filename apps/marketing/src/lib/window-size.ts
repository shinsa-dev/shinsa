export interface WindowSize {
  width: number;
  height: number;
  reserve?: number;
  extra?: number;
}

export function resolveWindowStyle({ width, height, reserve, extra = 0 }: WindowSize) {
  const fitted = reserve === undefined ? `${height}px` : `clamp(420px, 100svh - ${reserve}px, ${height}px)`;
  return `--window-w: ${width}px; --window-h: ${fitted}; --window-extra: ${extra}px;`;
}
