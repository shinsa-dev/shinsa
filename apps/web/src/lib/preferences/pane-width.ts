import * as React from 'react';

export interface PaneBounds {
  min: number;
  max: number;
  initial: number;
}

function clampWidth(width: number, bounds: PaneBounds) {
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(width)));
}

function readWidth(key: string, bounds: PaneBounds) {
  const stored = Number(localStorage.getItem(key));
  return Number.isFinite(stored) && stored > 0 ? clampWidth(stored, bounds) : bounds.initial;
}

export function usePaneWidth(key: string, bounds: PaneBounds) {
  const [width, setWidth] = React.useState(() => readWidth(key, bounds));
  const endDrag = React.useRef<(() => void) | null>(null);

  const startResize = (event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    let latest = startWidth;
    const onMove = (move: PointerEvent) => {
      latest = clampWidth(startWidth + move.clientX - startX, bounds);
      setWidth(latest);
    };
    const onEnd = () => {
      localStorage.setItem(key, String(latest));
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', onEnd);
      removeEventListener('pointercancel', onEnd);
      endDrag.current = null;
    };
    endDrag.current?.();
    endDrag.current = onEnd;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    addEventListener('pointermove', onMove);
    addEventListener('pointerup', onEnd);
    addEventListener('pointercancel', onEnd);
  };

  const resetWidth = () => {
    localStorage.removeItem(key);
    setWidth(bounds.initial);
  };

  React.useEffect(() => () => endDrag.current?.(), []);

  return { width, startResize, resetWidth };
}
