import { HoverHighlight } from '@shinsa/ui/components/highlight-list';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { ICON_SLOT } from '@/components/layout/surface/card.ts';
import { DisclosureChevron, DisclosureHeader } from '@/components/layout/surface/disclosure-header.tsx';
import { type DisclosurePersistId, useDisclosure } from '@/lib/preferences/disclosure.ts';

export const COMPACT_POPOVER =
  'max-h-(--available-height) w-80 gap-0 p-0 [--glyph-ring:var(--color-popover)]';

export const COMPACT_POPOVER_INSET = 'pt-1.5';

const HEADER =
  'w-full gap-2 rounded-control ps-1.5 font-medium text-2xs text-fg-2 hover:text-fg-4 active:text-fg-4';

const REVEAL = 'opacity-0 group-hover/disclosure:opacity-100';

export function CompactSections({ className, children }: { className?: string; children: React.ReactNode }) {
  return <HoverHighlight className={cn('flex flex-col', className)}>{children}</HoverHighlight>;
}

export function CompactSection({
  persistId,
  defaultOpen = true,
  label,
  leading,
  title,
  count,
  action,
  children,
}: {
  persistId: DisclosurePersistId;
  defaultOpen?: boolean;
  label?: string;
  leading: React.ReactNode;
  title: string;
  count: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const disclosure = useDisclosure(persistId, defaultOpen);
  return (
    <section
      data-folded={disclosure.open ? undefined : ''}
      className='flex flex-col border-border border-t px-2 py-1.5 first-of-type:border-t-0'
    >
      <DisclosureHeader
        disclosure={disclosure}
        label={label}
        action={action}
        className={cn(HEADER, 'h-6 pe-1')}
      >
        <span className={ICON_SLOT}>{leading}</span>
        <span className='min-w-0 truncate'>{title}</span>
        <span className='flex min-w-0 items-center gap-1.5 font-normal tabular-nums'>
          {count}
          <DisclosureChevron className={REVEAL} />
        </span>
      </DisclosureHeader>
      {disclosure.open && <div className='flex flex-col pt-0.5'>{children}</div>}
    </section>
  );
}
