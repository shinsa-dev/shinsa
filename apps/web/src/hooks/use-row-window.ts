import * as React from 'react';
import { isSameRange, type RowWindow, resolveRowWindow } from '@/lib/format/rows.ts';

function findScroller(node: HTMLElement) {
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return null;
}

export function useRowWindow(list: React.RefObject<HTMLElement | null>, count: number, rowHeight: number) {
  const [range, setRange] = React.useState<RowWindow>(() =>
    resolveRowWindow(0, typeof window === 'undefined' ? 0 : window.innerHeight, count, rowHeight)
  );
  React.useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    const scroller = findScroller(node);
    const measure = () => {
      const top = node.getBoundingClientRect().top - (scroller?.getBoundingClientRect().top ?? 0);
      const height = scroller?.clientHeight ?? window.innerHeight;
      const next = resolveRowWindow(top, height, count, rowHeight);
      setRange((current) => (isSameRange(current, next) ? current : next));
    };
    measure();
    const target = scroller ?? window;
    const resize = new ResizeObserver(measure);
    for (const child of scroller?.children ?? []) resize.observe(child);
    if (scroller) resize.observe(scroller);
    target.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      resize.disconnect();
      target.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [list, count, rowHeight]);
  return range;
}
