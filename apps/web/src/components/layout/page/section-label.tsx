import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { DisclosureChevron, DisclosureHeader } from '@/components/layout/surface/disclosure-header.tsx';

const SECTION_LABEL = 'flex shrink-0 items-center gap-1.5 font-medium text-2xs text-fg-2 leading-4';

const ACTIONS = 'flex shrink-0 items-center gap-0.5';

export function SectionChevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <Icon
      name='IconChevronDownSmall'
      size='sm'
      className={cn('transition-[rotate] duration-150', !open && '-rotate-90', className)}
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
  if (onToggle) {
    return (
      <DisclosureHeader
        as='h2'
        open={open}
        onToggle={onToggle}
        action={action && <span className={ACTIONS}>{action}</span>}
        className={cn(SECTION_LABEL, 'h-6 gap-1.5 hover:text-fg-4 active:text-fg-4', className)}
      >
        {label}
        <DisclosureChevron />
      </DisclosureHeader>
    );
  }
  return (
    <h2 className={cn(SECTION_LABEL, 'h-6', className)}>
      {label}
      {action && (
        <>
          <span className='flex-1' />
          <span className={ACTIONS}>{action}</span>
        </>
      )}
    </h2>
  );
}
