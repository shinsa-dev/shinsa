import * as React from 'react';

const STORAGE_KEY = 'shinsa.rail-width';

export const RAIL_WIDTH = { min: 200, max: 420, initial: 240 } as const;

export function clampRailWidth(width: number) {
  return Math.min(RAIL_WIDTH.max, Math.max(RAIL_WIDTH.min, Math.round(width)));
}

export function readRailWidth() {
  const stored = Number(localStorage.getItem(STORAGE_KEY));
  return Number.isFinite(stored) && stored > 0 ? clampRailWidth(stored) : RAIL_WIDTH.initial;
}

export function useRailWidth() {
  const [width, setWidth] = React.useState(readRailWidth);

  const startResize = (event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    let latest = startWidth;
    const onMove = (move: PointerEvent) => {
      latest = clampRailWidth(startWidth + move.clientX - startX);
      setWidth(latest);
    };
    const onEnd = () => {
      localStorage.setItem(STORAGE_KEY, String(latest));
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', onEnd);
      removeEventListener('pointercancel', onEnd);
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    addEventListener('pointermove', onMove);
    addEventListener('pointerup', onEnd);
    addEventListener('pointercancel', onEnd);
  };

  const resetWidth = () => {
    localStorage.removeItem(STORAGE_KEY);
    setWidth(RAIL_WIDTH.initial);
  };

  return { width, startResize, resetWidth };
}
