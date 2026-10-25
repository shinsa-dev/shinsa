import { Button } from '@shinsa/ui/components/button';
import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { CARD, CARD_HEADER } from '@/components/layout/surface/card.ts';
import { IconSlot } from '@/components/layout/surface/icon-slot.tsx';
import { Hint } from '@/components/overlays/hint.tsx';

export function CollapseToggle({
  open,
  onToggle,
  label,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
}) {
  const action = `${open ? 'Collapse' : 'Expand'} ${label.toLowerCase()}`;
  return (
    <Hint label={action}>
      <Button
        variant='secondary'
        size='icon-xs'
        aria-expanded={open}
        aria-label={action}
        icon={{
          name: 'IconChevronDownSmall',
          className: cn('transition-[rotate] duration-150', !open && '-rotate-90'),
        }}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      />
    </Hint>
  );
}

export function Panel({
  title,
  icon,
  action,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: IconName;
  action?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const toggle = () => setOpen((current) => !current);
  return (
    <section className={cn(CARD, 'flex flex-col overflow-hidden')}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the collapse button inside is the keyboard path */}
      <h2
        className={cn(CARD_HEADER, 'cursor-pointer select-none', open && 'border-border border-b')}
        onClick={toggle}
      >
        <IconSlot>
          <Icon size='sm' name={icon} />
        </IconSlot>
        {title}
        <span className='flex-1' />
        {action && (
          // biome-ignore lint/a11y/noStaticElementInteractions: stops the header toggle under the action
          // biome-ignore lint/a11y/useKeyWithClickEvents: only stops a click from reaching the header
          <span className='flex items-center' onClick={(event) => event.stopPropagation()}>
            {action}
          </span>
        )}
        <CollapseToggle open={open} onToggle={toggle} label={title} />
      </h2>
      {open && <div className='flex flex-col gap-3 p-3'>{children}</div>}
    </section>
  );
}
