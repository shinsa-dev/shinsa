import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { CARD, CARD_HEADER } from '@/components/layout/surface/card.ts';
import { DisclosureHeader } from '@/components/layout/surface/disclosure-header.tsx';
import { IconSlot } from '@/components/layout/surface/icon-slot.tsx';

export function Panel({
  title,
  icon,
  meta,
  action,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: IconName;
  meta?: React.ReactNode;
  action?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <section className={cn(CARD, 'flex flex-col overflow-hidden')}>
      <DisclosureHeader
        as='h2'
        open={open}
        onToggle={() => setOpen((current) => !current)}
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
        {meta && <span className='ms-auto shrink-0 ps-3'>{meta}</span>}
      </DisclosureHeader>
      {open && <div className='flex flex-col gap-3 border-border border-t p-3'>{children}</div>}
    </section>
  );
}
