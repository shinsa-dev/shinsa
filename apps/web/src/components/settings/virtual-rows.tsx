import * as React from 'react';
import { resolveVisibleRange, type VisibleRange } from '@/lib/extensions.ts';

const VIEWPORT = '[data-slot=scroll-area-viewport]';

function isSameRange(a: VisibleRange, b: VisibleRange) {
  return a.start === b.start && a.end === b.end;
}

export function VirtualRows<Item>({
  items,
  rowHeight,
  keyOf,
  children,
}: {
  items: Item[];
  rowHeight: number;
  keyOf: (item: Item) => string;
  children: (item: Item, index: number) => React.ReactNode;
}) {
  const list = React.useRef<HTMLDivElement>(null);
  const [range, setRange] = React.useState<VisibleRange>(() =>
    resolveVisibleRange(0, 0, items.length, rowHeight)
  );
  React.useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    const viewport = node.closest<HTMLElement>(VIEWPORT);
    const measure = () => {
      const top = node.getBoundingClientRect().top - (viewport?.getBoundingClientRect().top ?? 0);
      const height = viewport?.clientHeight ?? window.innerHeight;
      const next = resolveVisibleRange(top, height, items.length, rowHeight);
      setRange((current) => (isSameRange(current, next) ? current : next));
    };
    measure();
    const target = viewport ?? window;
    const content = new ResizeObserver(measure);
    content.observe(viewport?.firstElementChild ?? node);
    target.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      content.disconnect();
      target.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [items.length, rowHeight]);
  return (
    <div ref={list} className='relative' style={{ height: items.length * rowHeight }}>
      {items.slice(range.start, range.end).map((item, index) => (
        <div
          key={keyOf(item)}
          className='absolute inset-x-0'
          style={{ top: (range.start + index) * rowHeight, height: rowHeight }}
        >
          {children(item, range.start + index)}
        </div>
      ))}
    </div>
  );
}
