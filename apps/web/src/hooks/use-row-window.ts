import * as React from 'react';
import { flushSync } from 'react-dom';
import {
  isCoveringWindows,
  isSameWindows,
  type RowWindow,
  resolveSectionWindows,
} from '@/lib/format/rows.ts';

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
    resolveSectionWindows([], resolveViewportHeight(), counts, rowHeight, false)
  );
  const measureRef = React.useRef(() => {});
  const aheadRef = React.useRef(false);
  const shownRef = React.useRef(windows);
  React.useLayoutEffect(() => {
    shownRef.current = windows;
  }, [windows]);
  React.useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    const scroller = findScroller(node);
    const listed = sizes ? sizes.split(',').map(Number) : [];
    const resolveView = () => {
      const origin = scroller?.getBoundingClientRect().top ?? 0;
      const tops: number[] = [];
      for (const rows of node.querySelectorAll<HTMLElement>(`[${WINDOW_ROWS_ATTRIBUTE}]`)) {
        tops[Number(rows.dataset.windowRows)] = rows.getBoundingClientRect().top - origin;
      }
      const height = scroller?.clientHeight ?? window.innerHeight;
      return {
        next: resolveSectionWindows(tops, height, listed, rowHeight, aheadRef.current),
        inView: resolveSectionWindows(tops, height, listed, rowHeight, false),
      };
    };
    const replace = (next: RowWindow[]) => {
      replaceWindows((current) => (isSameWindows(current, next) ? current : next));
    };
    const measure = () => replace(resolveView().next);
    const measureAhead = () => {
      aheadRef.current = true;
      const { next, inView } = resolveView();
      if (isSameWindows(shownRef.current, next)) return;
      if (isCoveringWindows(shownRef.current, inView)) React.startTransition(() => replace(next));
      else flushSync(() => replace(next));
    };
    measureRef.current = measure;
    measure();
    const frame = aheadRef.current
      ? 0
      : requestAnimationFrame(() => {
          aheadRef.current = true;
          React.startTransition(measure);
        });
    const target = scroller ?? window;
    const resize = new ResizeObserver(measure);
    resize.observe(node);
    if (scroller) resize.observe(scroller);
    target.addEventListener('scroll', measureAhead, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      measureRef.current = () => {};
      resize.disconnect();
      target.removeEventListener('scroll', measureAhead);
      window.removeEventListener('resize', measure);
    };
  }, [list, sizes, rowHeight]);
  const remeasure = React.useCallback(() => measureRef.current(), []);
  const current =
    windows.length === counts.length
      ? windows
      : resolveSectionWindows([], resolveViewportHeight(), counts, rowHeight, false);
  return { windows: current, remeasure };
}
