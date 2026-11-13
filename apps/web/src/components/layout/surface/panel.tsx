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
  action,
  defaultOpen = true,
  flush = false,
  children,
}: {
  persistId: DisclosurePersistId;
  title: string;
  icon: IconName;
  count?: number;
  action?: React.ReactNode;
  defaultOpen?: boolean;
  flush?: boolean;
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
      </DisclosureHeader>
      {disclosure.open && (
        <div className={cn('flex flex-col border-t border-border', !flush && 'gap-3 p-3')}>{children}</div>
      )}
    </section>
  );
}
