import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import {
  type DisclosureChevron as ChevronKind,
  type DisclosureStrip,
  resolveDisclosureStrip,
  TRAILING_BOX,
} from '@/components/layout/surface/disclosure.ts';

type HeaderTag = 'div' | 'h2' | 'h3' | 'figcaption';

interface DisclosureTrigger {
  open: boolean;
  label: string | undefined;
  separate: boolean;
}

const TriggerContext = React.createContext<DisclosureTrigger | null>(null);

const CHEVRON_BOX =
  'corner-superellipse/1.125 grid shrink-0 place-items-center rounded-control-sm outline-none';

const CHEVRON_WASH = {
  box: 'text-fg-2 group-hover/disclosure:bg-bg-a2/70 group-hover/disclosure:text-fg-4 group-active/disclosure:bg-bg-a2/70 group-active/disclosure:text-fg-4',
  glyph: 'group-hover/disclosure:text-fg-4 group-active/disclosure:text-fg-4',
};

function describeToggle(open: boolean, label: string) {
  return `${open ? 'Collapse' : 'Expand'} ${label}`;
}

export function DisclosureChevron({ kind = 'glyph', className }: { kind?: ChevronKind; className?: string }) {
  const trigger = React.useContext(TriggerContext);
  const open = trigger?.open ?? false;
  const glyph = (
    <Icon
      size='sm'
      name='IconChevronDownSmall'
      className={cn('transition-[rotate] duration-150', !open && '-rotate-90')}
    />
  );
  const classes = cn(CHEVRON_BOX, kind === 'box' ? TRAILING_BOX : 'size-3.5', CHEVRON_WASH[kind], className);
  if (!trigger?.separate) {
    return (
      <span data-disclosure-chevron aria-hidden className={classes}>
        {glyph}
      </span>
    );
  }
  return (
    <button
      type='button'
      data-disclosure-chevron
      aria-expanded={open}
      aria-label={trigger.label ? describeToggle(open, trigger.label) : undefined}
      className={cn(classes, 'cursor-pointer')}
    >
      {glyph}
    </button>
  );
}

export function DisclosureAction({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keeps a header action's click from folding the header
    // biome-ignore lint/a11y/useKeyWithClickEvents: only stops a click from reaching the header
    <span
      data-disclosure-action
      className={cn('flex min-w-0 items-center', className)}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </span>
  );
}

export function DisclosureHeader({
  as: Tag = 'div',
  open,
  onToggle,
  label,
  strip,
  chevron,
  chevronClassName,
  action,
  interactive = false,
  className,
  children,
}: {
  as?: HeaderTag;
  open: boolean;
  onToggle: () => void;
  label?: string;
  strip?: DisclosureStrip;
  chevron?: ChevronKind;
  chevronClassName?: string;
  action?: React.ReactNode;
  interactive?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const separate = interactive || Boolean(action);
  const trigger = React.useMemo(() => ({ open, label, separate }), [open, label, separate]);
  const header = cn(
    'group/disclosure flex min-w-0 cursor-pointer select-none items-center text-left',
    className,
    strip && chevron && resolveDisclosureStrip(strip, chevron)
  );
  const content = (
    <TriggerContext.Provider value={trigger}>
      {children}
      {action && <DisclosureAction className='ms-auto shrink-0'>{action}</DisclosureAction>}
      {chevron && <DisclosureChevron kind={chevron} className={cn(!action && 'ms-auto', chevronClassName)} />}
    </TriggerContext.Provider>
  );
  if (separate) {
    return (
      <Tag data-disclosure-header={strip ?? ''} className={header} onClick={onToggle}>
        {content}
      </Tag>
    );
  }
  const button = (
    <button
      type='button'
      data-disclosure-header={strip ?? ''}
      aria-expanded={open}
      aria-label={label ? describeToggle(open, label) : undefined}
      onClick={onToggle}
      className={cn(header, 'outline-none', Tag !== 'div' && 'w-full')}
    >
      {content}
    </button>
  );
  if (Tag === 'div') return button;
  return <Tag className='flex min-w-0'>{button}</Tag>;
}
