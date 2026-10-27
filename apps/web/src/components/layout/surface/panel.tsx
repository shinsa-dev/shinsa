import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { CARD, CARD_HEADER } from '@/components/layout/surface/card.ts';
import { DisclosureHeader } from '@/components/layout/surface/disclosure-header.tsx';
import { IconSlot } from '@/components/layout/surface/icon-slot.tsx';
import { type DisclosurePersistId, useDisclosure } from '@/lib/preferences/disclosure.ts';

export function Panel({
  persistId,
  title,
  icon,
  count,
  meta,
  action,
  defaultOpen = true,
  children,
}: {
  persistId: DisclosurePersistId;
  title: string;
  icon: IconName;
  count?: number;
  meta?: React.ReactNode;
  action?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const disclosure = useDisclosure(persistId, defaultOpen);
  return (
    <section className={cn(CARD, 'flex flex-col overflow-hidden')}>
      <DisclosureHeader
        as='h2'
        disclosure={disclosure}
        label={title.toLowerCase()}
        strip='band'
        chevron='box'
        action={action}
        className={CARD_HEADER}
      >
        <IconSlot>
          <Icon size='sm' name={icon} />
        </IconSlot>
        {title}
        {count !== undefined && <span className='shrink-0 font-normal text-fg-2 tabular-nums'>{count}</span>}
        {meta && <span className='ms-auto shrink-0 ps-3'>{meta}</span>}
      </DisclosureHeader>
      {disclosure.open && <div className='flex flex-col gap-3 border-border border-t p-3'>{children}</div>}
    </section>
  );
}
