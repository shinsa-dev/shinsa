import * as React from 'react';
import { isSameWindows, type RowWindow, resolveSectionWindows } from '@/lib/format/rows.ts';

export const WINDOW_ROWS_ATTRIBUTE = 'data-window-rows';

function findScroller(node: HTMLElement) {
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return null;
}

function resolveViewportHeight() {
  return typeof window === 'undefined' ? 0 : window.innerHeight;
}

export function useSectionWindows(
  list: React.RefObject<HTMLElement | null>,
  counts: readonly number[],
  rowHeight: number
) {
  const sizes = counts.join(',');
  const [windows, replaceWindows] = React.useState<RowWindow[]>(() =>
    resolveSectionWindows([], resolveViewportHeight(), counts, rowHeight)
  );
  const measureRef = React.useRef(() => {});
  React.useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    const scroller = findScroller(node);
    const listed = sizes ? sizes.split(',').map(Number) : [];
    const measure = () => {
      const origin = scroller?.getBoundingClientRect().top ?? 0;
      const tops: number[] = [];
      for (const rows of node.querySelectorAll<HTMLElement>(`[${WINDOW_ROWS_ATTRIBUTE}]`)) {
        tops[Number(rows.dataset.windowRows)] = rows.getBoundingClientRect().top - origin;
      }
      const height = scroller?.clientHeight ?? window.innerHeight;
      const next = resolveSectionWindows(tops, height, listed, rowHeight);
      replaceWindows((current) => (isSameWindows(current, next) ? current : next));
    };
    measureRef.current = measure;
    measure();
    const target = scroller ?? window;
    const resize = new ResizeObserver(measure);
    resize.observe(node);
    if (scroller) resize.observe(scroller);
    target.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      measureRef.current = () => {};
      resize.disconnect();
      target.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [list, sizes, rowHeight]);
  const remeasure = React.useCallback(() => measureRef.current(), []);
  const current =
    windows.length === counts.length
      ? windows
      : resolveSectionWindows([], resolveViewportHeight(), counts, rowHeight);
  return { windows: current, remeasure };
}
