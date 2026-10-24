import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { SectionChevron } from '@/components/layout/page/section-label.tsx';

const INDENT = 12;

export function TreeRow({
  depth,
  selected = false,
  expanded,
  lead,
  children,
  end,
  label,
  onOpen,
  onPin,
}: {
  depth: number;
  selected?: boolean;
  expanded?: boolean;
  lead?: React.ReactNode;
  children: React.ReactNode;
  end?: React.ReactNode;
  label?: string;
  onOpen: () => void;
  onPin?: () => void;
}) {
  return (
    <div
      role='treeitem'
      aria-selected={selected}
      aria-expanded={expanded}
      aria-label={label}
      tabIndex={-1}
      onClick={onOpen}
      onDoubleClick={onPin}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onOpen();
      }}
      style={{ paddingInlineStart: 6 + depth * INDENT }}
      className={cn(
        'corner-superellipse/1.125 flex h-6 w-full cursor-pointer select-none items-center gap-1.5 rounded-control-sm pe-1.5 text-2xs outline-none transition-colors duration-150',
        selected ? 'bg-bg-a3 text-fg-4' : 'text-fg-3 hover:bg-bg-a2 active:bg-bg-a2'
      )}
    >
      <span className='flex size-3.5 shrink-0 items-center justify-center'>
        {expanded === undefined ? lead : <SectionChevron open={expanded} />}
      </span>
      {children}
      {end}
    </div>
  );
}
