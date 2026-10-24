import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';

const SECTION_LABEL = 'flex shrink-0 items-center gap-1.5 font-medium text-2xs text-fg-2 leading-4';

export function SectionChevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <Icon
      name='IconChevronDownSmall'
      size='sm'
      className={cn('transition-[opacity,rotate,color] duration-150', !open && '-rotate-90', className)}
    />
  );
}

export function SectionLabel({
  children,
  count,
  action,
  open = true,
  onToggle,
  className,
}: {
  children: React.ReactNode;
  count?: number;
  action?: React.ReactNode;
  open?: boolean;
  onToggle?: () => void;
  className?: string;
}) {
  const label = (
    <>
      {children}
      {count !== undefined && <span className='font-normal text-fg-2 tabular-nums'>{count}</span>}
    </>
  );
  return (
    <h2 className={cn(SECTION_LABEL, 'h-6', className)}>
      {onToggle ? (
        <button
          type='button'
          aria-expanded={open}
          onClick={onToggle}
          className='flex h-6 cursor-pointer items-center gap-1.5 rounded-control-sm outline-none transition-colors duration-150 hover:text-fg-4 active:text-fg-4'
        >
          {label}
          <SectionChevron open={open} />
        </button>
      ) : (
        label
      )}
      {action && (
        <>
          <span className='flex-1' />
          <span className='flex shrink-0 items-center gap-0.5'>{action}</span>
        </>
      )}
    </h2>
  );
}
