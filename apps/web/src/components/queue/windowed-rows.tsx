import * as React from 'react';
import { useRowWindow } from '@/hooks/use-row-window.ts';

export function WindowedRows<Item>({
  items,
  rowHeight,
  gap = 0,
  children,
}: {
  items: Item[];
  rowHeight: number;
  gap?: number;
  children: (item: Item) => React.ReactNode;
}) {
  const list = React.useRef<HTMLDivElement>(null);
  const step = rowHeight + gap;
  const { start, end } = useRowWindow(list, items.length, step);
  return (
    <div ref={list} className='flex flex-col' style={gap > 0 ? { gap } : undefined}>
      {start > 0 && <div aria-hidden style={{ height: start * step - gap }} />}
      {items.slice(start, end).map(children)}
      {end < items.length && <div aria-hidden style={{ height: (items.length - end) * step - gap }} />}
    </div>
  );
}
