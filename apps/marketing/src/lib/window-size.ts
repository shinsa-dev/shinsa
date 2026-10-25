export interface WindowSize {
  width: number;
  height: number;
  narrow: number;
  reserve?: number;
  extra?: number;
}

export function resolveWindowStyle({ width, height, narrow, reserve, extra = 0 }: WindowSize) {
  const fitted = reserve === undefined ? `${height}px` : `clamp(420px, 100svh - ${reserve}px, ${height}px)`;
  return `--wide-w: ${width}px; --wide-h: ${fitted}; --narrow-h: ${narrow}px; --window-extra: ${extra}px;`;
}
