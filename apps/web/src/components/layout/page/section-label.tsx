import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { SECTION_LABEL } from '@/components/layout/page/heading.tsx';
import { DisclosureChevron, DisclosureHeader } from '@/components/layout/surface/disclosure-header.tsx';
import type { Disclosure } from '@/lib/preferences/disclosure.ts';

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
  disclosure,
  className,
}: {
  children: React.ReactNode;
  count?: number;
  action?: React.ReactNode;
  disclosure?: Disclosure;
  className?: string;
}) {
  const label = (
    <>
      {children}
      {count !== undefined && <span className='font-normal text-fg-2 tabular-nums'>{count}</span>}
    </>
  );
  if (disclosure) {
    return (
      <DisclosureHeader
        as='h2'
        disclosure={disclosure}
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
